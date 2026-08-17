mod db;

use std::collections::HashMap;
use std::env;
use std::io;
use std::sync::Arc;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State as AxumState};
use axum::http::header::CONTENT_TYPE;
use axum::http::{HeaderValue, Method, StatusCode};
use axum::response::Response;
use axum::routing::{get, post};
use axum::{Json, Router};
use game_core::{
    Action, ActionError, Card, LegalActions, NextHandError, Rank, State, Street, Suit,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::net::TcpListener;
use tokio::sync::{Mutex, broadcast};
use tower_http::cors::CorsLayer;
use uuid::Uuid;

use crate::db::{Db, NewAction, NewHand, ReadyUpdate, StoredAction, StoredHand, StoredRoom};

type HttpError = (StatusCode, &'static str);
type TokenHash = [u8; 32];
type Rooms = Arc<Mutex<HashMap<Uuid, Arc<Mutex<Room>>>>>;

#[derive(Clone)]
struct AppState {
    db: Db,
    rooms: Rooms,
}

impl AppState {
    fn new(db: Db, rooms: HashMap<Uuid, Arc<Mutex<Room>>>) -> Self {
        Self {
            db,
            rooms: Arc::new(Mutex::new(rooms)),
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
struct RoomConfig {
    players: usize,
    stack: u32,
    small_blind: u32,
    big_blind: u32,
}

impl RoomConfig {
    fn validate(self) -> Result<(), &'static str> {
        if !(2..=6).contains(&self.players) {
            return Err("players must be 2 through 6");
        }

        if self.small_blind == 0 {
            return Err("small blind must be positive");
        }

        if self.big_blind < self.small_blind {
            return Err("big blind must cover small blind");
        }

        if self.stack < self.big_blind {
            return Err("stack must cover big blind");
        }

        let total = self.players as u64 * u64::from(self.stack);

        if total > u64::from(u32::MAX) {
            return Err("total stacks exceed chip limit");
        }

        Ok(())
    }
}

struct Room {
    config: RoomConfig,
    seats: Vec<Seat>,
    hand: Option<LiveHand>,
    rev: u64,
    notify: broadcast::Sender<u64>,
}

impl Room {
    fn new(config: RoomConfig, token_hash: TokenHash) -> Result<Self, &'static str> {
        config.validate()?;
        let (notify, _) = broadcast::channel(16);

        Ok(Self {
            config,
            seats: vec![Seat {
                token_hash,
                ready_hand: None,
            }],
            hand: None,
            rev: 0,
            notify,
        })
    }

    fn next_seat(&self) -> Result<usize, JoinError> {
        if self.hand.is_some() || self.seats.len() >= self.config.players {
            return Err(JoinError::Full);
        }

        Ok(self.seats.len())
    }

    fn commit_join(&mut self, token_hash: TokenHash, hand: Option<LiveHand>, rev: u64) {
        self.seats.push(Seat {
            token_hash,
            ready_hand: None,
        });
        self.hand = hand;
        self.changed(rev);
    }

    fn stage_ready(&self, seat: usize) -> Result<PendingReady, &'static str> {
        let hand = self.hand.as_ref().ok_or("game not started")?;
        let player = self.seats.get(seat).ok_or("invalid player")?;

        if !hand.game.settled {
            return Err("hand not settled");
        }

        if player.ready_hand == Some(hand.id) {
            return Err("already ready");
        }

        let all = self
            .seats
            .iter()
            .enumerate()
            .all(|(i, player)| i == seat || player.ready_hand == Some(hand.id));

        Ok(PendingReady {
            hand: hand.id,
            rev: self.rev.checked_add(1).ok_or("revision limit reached")?,
            all,
        })
    }

    fn commit_ready(&mut self, seat: usize, hand: Option<LiveHand>, rev: u64) {
        if let Some(hand) = hand {
            for player in &mut self.seats {
                player.ready_hand = None;
            }

            self.hand = Some(hand);
        } else {
            let hand = self.hand.as_ref().expect("staged hand").id;

            self.seats[seat].ready_hand = Some(hand);
        }

        self.changed(rev);
    }

    fn stage_action(&self, seat: usize, action: Action) -> Result<PendingAction, &'static str> {
        let hand = self.hand.as_ref().ok_or("game not started")?;

        // action staged on state clone
        let mut game = hand.game.clone();

        game.apply(seat, action).map_err(action_error)?;
        advance(&mut game)?;

        Ok(PendingAction {
            hand: hand.id,
            seq: hand.next_seq,
            next_seq: hand.next_seq.checked_add(1).ok_or("action limit reached")?,
            rev: self.rev.checked_add(1).ok_or("revision limit reached")?,
            player: seat,
            action,
            game,
        })
    }

    fn commit_action(&mut self, action: PendingAction) {
        let hand = self.hand.as_mut().expect("staged hand");

        hand.game = action.game;
        hand.next_seq = action.next_seq;
        self.changed(action.rev);
    }

    fn changed(&mut self, rev: u64) {
        self.rev = rev;
        let _ = self.notify.send(self.rev);
    }
}

struct Seat {
    token_hash: TokenHash,
    ready_hand: Option<Uuid>,
}

struct LiveHand {
    id: Uuid,
    no: u64,
    game: State,
    next_seq: u64,
}

struct PendingReady {
    hand: Uuid,
    rev: u64,
    all: bool,
}

struct PendingAction {
    hand: Uuid,
    seq: u64,
    next_seq: u64,
    rev: u64,
    player: usize,
    action: Action,
    game: State,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum JoinError {
    Full,
}

#[derive(Serialize)]
struct SeatResponse {
    room: Uuid,
    seat: usize,
    token: Uuid,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ClientMessage {
    Auth { token: Uuid },
    Fold,
    Check,
    Call,
    RaiseTo { to: u32 },
    Ready,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ServerMessage {
    Waiting { joined: usize, players: usize },
    Snapshot { rev: u64, view: SeatView },
    Error { message: &'static str },
}

#[derive(Debug, Eq, PartialEq, Serialize)]
struct SeatView {
    players: Vec<PlayerView>,
    hole: [CardView; 2],
    board: Vec<CardView>,
    pot: u32,
    dealer: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    turn: Option<usize>,
    street: &'static str,
    round_complete: bool,
    settled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    actions: Option<ActionView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    ready: Option<ReadyView>,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
struct ReadyView {
    mine: bool,
    count: usize,
    players: usize,
    complete: bool,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
struct PlayerView {
    stack: u32,
    bet: u32,
    folded: bool,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
struct CardView {
    value: String,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
struct ActionView {
    fold: bool,
    check: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    call: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    raise: Option<RaiseView>,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
struct RaiseView {
    min_to: u32,
    max_to: u32,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let port: u16 = env::var("PORT")
        .unwrap_or_else(|_| "3001".to_owned())
        .parse()?;
    let origin: HeaderValue = env::var("WEB_ORIGIN")
        .unwrap_or_else(|_| "http://localhost:3000".to_owned())
        .parse()?;
    let database_url =
        env::var("DATABASE_URL").map_err(|_| io::Error::other("DATABASE_URL missing"))?;
    let db = Db::connect(&database_url).await?;
    let rooms = restore_rooms(db.load_rooms().await?)?;
    let listener = TcpListener::bind(("0.0.0.0", port)).await?;

    axum::serve(listener, app(AppState::new(db, rooms), origin)).await?;
    Ok(())
}

fn app(state: AppState, origin: HeaderValue) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/rooms", post(create_room))
        .route("/rooms/{room}/join", post(join_room))
        .route("/rooms/{room}/ws", get(room_ws))
        .with_state(state)
        .layer(
            CorsLayer::new()
                .allow_origin(origin)
                .allow_methods([Method::POST])
                .allow_headers([CONTENT_TYPE]),
        )
}

async fn health() -> &'static str {
    "ok"
}

async fn create_room(
    AxumState(state): AxumState<AppState>,
    Json(config): Json<RoomConfig>,
) -> Result<(StatusCode, Json<SeatResponse>), HttpError> {
    let token = Uuid::new_v4();
    let token_hash = hash_token(token);
    let room = Room::new(config, token_hash).map_err(|err| (StatusCode::BAD_REQUEST, err))?;
    let id = Uuid::new_v4();

    state
        .db
        .create_room(
            id,
            config.players,
            config.stack,
            config.small_blind,
            config.big_blind,
            &token_hash,
        )
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "cannot create room"))?;
    state
        .rooms
        .lock()
        .await
        .insert(id, Arc::new(Mutex::new(room)));

    Ok((
        StatusCode::CREATED,
        Json(SeatResponse {
            room: id,
            seat: 0,
            token,
        }),
    ))
}

async fn join_room(
    AxumState(state): AxumState<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<SeatResponse>, HttpError> {
    let room = find_room(&state, id)
        .await
        .ok_or((StatusCode::NOT_FOUND, "room not found"))?;
    let mut room = room.lock().await;
    let seat = room.next_seat().map_err(|err| match err {
        JoinError::Full => (StatusCode::CONFLICT, "room full"),
    })?;
    let (token, token_hash) = room_token(&room);
    let next_rev = room
        .rev
        .checked_add(1)
        .ok_or((StatusCode::INTERNAL_SERVER_ERROR, "revision limit reached"))?;
    let final_join = seat + 1 == room.config.players;
    let seed = if final_join {
        Some(secure_seed().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "cannot start room"))?)
    } else {
        None
    };
    let hand_id = seed.map(|_| Uuid::new_v4());
    let stacks = seed.map(|_| vec![room.config.stack; room.config.players]);
    let hand = seed.as_ref().map(|seed| NewHand {
        id: hand_id.expect("hand id"),
        no: 0,
        seed,
        dealer: 0,
        stacks: stacks.as_deref().expect("starting stacks"),
    });
    let game = seed.map(|seed| LiveHand {
        id: hand_id.expect("hand id"),
        no: 0,
        game: start_game(room.config, seed),
        next_seq: 0,
    });

    state
        .db
        .join_room(id, seat, &token_hash, room.rev, next_rev, hand)
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "cannot join room"))?;
    room.commit_join(token_hash, game, next_rev);

    Ok(Json(SeatResponse {
        room: id,
        seat,
        token,
    }))
}

async fn room_ws(
    Path(id): Path<Uuid>,
    AxumState(state): AxumState<AppState>,
    ws: WebSocketUpgrade,
) -> Response {
    ws.on_upgrade(move |socket| socket_loop(socket, state, id))
}

async fn socket_loop(mut socket: WebSocket, state: AppState, id: Uuid) {
    let token = match auth_token(&mut socket).await {
        Ok(token) => token,
        Err(err) => {
            send_error(&mut socket, err).await;
            return;
        }
    };
    let session = match find_room(&state, id).await {
        Some(room) => {
            let room = room.lock().await;

            match seat_for_token(&room, token) {
                Some(seat) => Ok((seat, room.notify.subscribe(), room_message(&room, seat))),
                None => Err("unknown token"),
            }
        }
        None => Err("room not found"),
    };
    let (seat, mut changes, message) = match session {
        Ok(session) => session,
        Err(err) => {
            send_error(&mut socket, err).await;
            return;
        }
    };

    if !send_message(&mut socket, &message).await {
        return;
    }

    loop {
        tokio::select! {
            message = socket.recv() => {
                let Some(Ok(message)) = message else {
                    return;
                };

                let message = match message {
                    Message::Text(text) => match serde_json::from_str(text.as_str()) {
                        Ok(message) => message,
                        Err(_) => {
                            send_error(&mut socket, "invalid message").await;
                            continue;
                        }
                    },
                    Message::Close(_) => return,
                    Message::Binary(_) => {
                        send_error(&mut socket, "text messages only").await;
                        continue;
                    }
                    Message::Ping(_) | Message::Pong(_) => continue,
                };
                let result = match message {
                    ClientMessage::Fold => apply_action(&state, id, seat, Action::Fold).await,
                    ClientMessage::Check => apply_action(&state, id, seat, Action::Check).await,
                    ClientMessage::Call => apply_action(&state, id, seat, Action::Call).await,
                    ClientMessage::RaiseTo { to } => {
                        apply_action(&state, id, seat, Action::RaiseTo(to)).await
                    }
                    ClientMessage::Ready => ready_room(&state, id, seat).await,
                    ClientMessage::Auth { .. } => {
                        send_error(&mut socket, "already authenticated").await;
                        continue;
                    }
                };

                if let Err(err) = result {
                    send_error(&mut socket, err).await;
                }
            }
            change = changes.recv() => {
                match change {
                    Ok(_) | Err(broadcast::error::RecvError::Lagged(_)) => {
                        let Some(message) = current_message(&state, id, seat).await else {
                            return;
                        };

                        if !send_message(&mut socket, &message).await {
                            return;
                        }
                    }
                    Err(broadcast::error::RecvError::Closed) => return,
                }
            }
        }
    }
}

async fn auth_token(socket: &mut WebSocket) -> Result<Uuid, &'static str> {
    loop {
        let message = socket
            .recv()
            .await
            .ok_or("authentication required")?
            .map_err(|_| "authentication failed")?;

        match message {
            Message::Text(text) => {
                let message: ClientMessage =
                    serde_json::from_str(text.as_str()).map_err(|_| "invalid authentication")?;

                return match message {
                    ClientMessage::Auth { token } => Ok(token),
                    _ => Err("authentication required"),
                };
            }
            Message::Ping(_) | Message::Pong(_) => {}
            Message::Binary(_) | Message::Close(_) => return Err("authentication required"),
        }
    }
}

async fn find_room(state: &AppState, id: Uuid) -> Option<Arc<Mutex<Room>>> {
    state.rooms.lock().await.get(&id).cloned()
}

async fn apply_action(
    state: &AppState,
    id: Uuid,
    seat: usize,
    action: Action,
) -> Result<(), &'static str> {
    let room = find_room(state, id).await.ok_or("room not found")?;
    let mut room = room.lock().await;
    let next = room.stage_action(seat, action)?;

    // command commit before state swap
    state
        .db
        .append_action(NewAction {
            room: id,
            hand: next.hand,
            seq: next.seq,
            player: next.player,
            action: next.action,
            rev: room.rev,
            next_rev: next.rev,
        })
        .await
        .map_err(|_| "cannot persist action")?;
    room.commit_action(next);
    Ok(())
}

async fn ready_room(state: &AppState, id: Uuid, seat: usize) -> Result<(), &'static str> {
    let room = find_room(state, id).await.ok_or("room not found")?;
    let mut room = room.lock().await;
    let ready = room.stage_ready(seat)?;

    if !ready.all {
        state
            .db
            .ready(ReadyUpdate {
                room: id,
                hand: ready.hand,
                seat,
                rev: room.rev,
                next_rev: ready.rev,
                next_hand: None,
            })
            .await
            .map_err(|_| "cannot persist ready")?;
        room.commit_ready(seat, None, ready.rev);
        return Ok(());
    }

    let seed = secure_seed().map_err(|_| "cannot start hand")?;
    let hand = room.hand.as_ref().expect("staged hand");
    let stacks: Vec<_> = hand
        .game
        .players
        .iter()
        .map(|player| player.stack)
        .collect();
    let next_no = hand.no.checked_add(1).ok_or("hand limit reached")?;
    let next = match hand.game.next_hand(seed) {
        Ok(game) => Some(LiveHand {
            id: Uuid::new_v4(),
            no: next_no,
            game,
            next_seq: 0,
        }),
        Err(NextHandError::CannotStart) => None,
        Err(NextHandError::NotSettled) => return Err("hand not settled"),
    };
    let new_hand = next.as_ref().map(|hand| NewHand {
        id: hand.id,
        no: hand.no,
        seed: &seed,
        dealer: hand.game.dealer,
        stacks: &stacks,
    });

    state
        .db
        .ready(ReadyUpdate {
            room: id,
            hand: ready.hand,
            seat,
            rev: room.rev,
            next_rev: ready.rev,
            next_hand: new_hand,
        })
        .await
        .map_err(|_| "cannot persist ready")?;
    room.commit_ready(seat, next, ready.rev);
    Ok(())
}

async fn current_message(state: &AppState, id: Uuid, seat: usize) -> Option<ServerMessage> {
    let room = find_room(state, id).await?;
    let room = room.lock().await;

    Some(room_message(&room, seat))
}

fn room_message(room: &Room, seat: usize) -> ServerMessage {
    match &room.hand {
        Some(hand) => ServerMessage::Snapshot {
            rev: room.rev,
            view: room_view(room, hand, seat),
        },
        None => ServerMessage::Waiting {
            joined: room.seats.len(),
            players: room.config.players,
        },
    }
}

fn room_view(room: &Room, hand: &LiveHand, seat: usize) -> SeatView {
    let mut view = seat_view(&hand.game, seat);

    if hand.game.settled {
        let count = room
            .seats
            .iter()
            .filter(|seat| seat.ready_hand == Some(hand.id))
            .count();

        view.ready = Some(ReadyView {
            mine: room.seats[seat].ready_hand == Some(hand.id),
            count,
            players: room.seats.len(),
            complete: count == room.seats.len(),
        });
    }

    view
}

async fn send_message(socket: &mut WebSocket, message: &ServerMessage) -> bool {
    let Ok(text) = serde_json::to_string(message) else {
        return false;
    };

    socket.send(Message::Text(text.into())).await.is_ok()
}

async fn send_error(socket: &mut WebSocket, message: &'static str) {
    let _ = send_message(socket, &ServerMessage::Error { message }).await;
}

fn room_token(room: &Room) -> (Uuid, TokenHash) {
    loop {
        let token = Uuid::new_v4();
        let token_hash = hash_token(token);

        if room.seats.iter().all(|seat| seat.token_hash != token_hash) {
            return (token, token_hash);
        }
    }
}

fn hash_token(token: Uuid) -> TokenHash {
    Sha256::digest(token.as_bytes()).into()
}

fn seat_for_token(room: &Room, token: Uuid) -> Option<usize> {
    let token_hash = hash_token(token);

    room.seats
        .iter()
        .position(|seat| seat.token_hash == token_hash)
}

// server seed for new hand
fn secure_seed() -> Result<[u8; 32], getrandom::Error> {
    let mut seed = [0u8; 32];

    getrandom::fill(&mut seed)?;
    Ok(seed)
}

fn start_game(config: RoomConfig, seed: [u8; 32]) -> State {
    let stacks = vec![config.stack; config.players];

    State::new(seed, 0, &stacks, config.small_blind, config.big_blind)
}

// advance finished streets
fn advance(game: &mut State) -> Result<(), &'static str> {
    if game.fold_winner.is_some() {
        game.settle().map_err(|_| "cannot settle hand")?;
        return Ok(());
    }

    while game.round_complete && !game.settled {
        if game.street == Street::River {
            game.settle().map_err(|_| "cannot settle hand")?;
        } else {
            game.advance_street().map_err(|_| "cannot advance hand")?;
        }
    }

    Ok(())
}

fn restore_rooms(stored: Vec<StoredRoom>) -> Result<HashMap<Uuid, Arc<Mutex<Room>>>, io::Error> {
    let mut rooms = HashMap::with_capacity(stored.len());

    for stored in stored {
        let id = stored.id;
        let room = restore_room(stored)?;

        if rooms.insert(id, Arc::new(Mutex::new(room))).is_some() {
            return Err(recovery_error(id, "duplicate room"));
        }
    }

    Ok(rooms)
}

fn restore_room(stored: StoredRoom) -> Result<Room, io::Error> {
    let id = stored.id;
    let config = RoomConfig {
        players: usize::try_from(stored.players)
            .map_err(|_| recovery_error(id, "invalid player count"))?,
        stack: u32::try_from(stored.stack).map_err(|_| recovery_error(id, "invalid stack"))?,
        small_blind: u32::try_from(stored.small_blind)
            .map_err(|_| recovery_error(id, "invalid small blind"))?,
        big_blind: u32::try_from(stored.big_blind)
            .map_err(|_| recovery_error(id, "invalid big blind"))?,
    };
    let rev = u64::try_from(stored.rev).map_err(|_| recovery_error(id, "invalid revision"))?;

    config
        .validate()
        .map_err(|_| recovery_error(id, "invalid room config"))?;

    if stored.seats.is_empty() || stored.seats.len() > config.players {
        return Err(recovery_error(id, "invalid seat count"));
    }

    let mut seats = Vec::with_capacity(stored.seats.len());

    for (expected, seat) in stored.seats.into_iter().enumerate() {
        let index =
            usize::try_from(seat.seat).map_err(|_| recovery_error(id, "invalid seat index"))?;
        let token_hash = seat
            .token_hash
            .try_into()
            .map_err(|_| recovery_error(id, "invalid token hash"))?;

        if index != expected {
            return Err(recovery_error(id, "seat sequence gap"));
        }

        seats.push(Seat {
            token_hash,
            ready_hand: seat.ready_hand,
        });
    }

    let hand = match stored.hand {
        Some(hand) if seats.len() == config.players => Some(restore_hand(id, config, hand)?),
        Some(_) => return Err(recovery_error(id, "hand before room full")),
        None if seats.len() == config.players => {
            return Err(recovery_error(id, "full room without hand"));
        }
        None => None,
    };
    let ready_count = match &hand {
        Some(hand) => {
            let mut count = 0;

            for seat in &seats {
                match seat.ready_hand {
                    Some(ready) if ready == hand.id && hand.game.settled => count += 1,
                    Some(_) => return Err(recovery_error(id, "invalid ready hand")),
                    None => {}
                }
            }

            count
        }
        None if seats.iter().any(|seat| seat.ready_hand.is_some()) => {
            return Err(recovery_error(id, "ready seat without hand"));
        }
        None => 0,
    };
    let action_count = hand.as_ref().map_or(0, |hand| hand.next_seq);
    let seat_revs =
        u64::try_from(seats.len() - 1).map_err(|_| recovery_error(id, "revision limit reached"))?;
    let min_rev = seat_revs
        .checked_add(action_count)
        .and_then(|rev| rev.checked_add(ready_count))
        .ok_or_else(|| recovery_error(id, "revision limit reached"))?;

    if rev < min_rev {
        return Err(recovery_error(id, "revision behind room state"));
    }

    let (notify, _) = broadcast::channel(16);

    Ok(Room {
        config,
        seats,
        hand,
        rev,
        notify,
    })
}

fn restore_hand(id: Uuid, config: RoomConfig, stored: StoredHand) -> Result<LiveHand, io::Error> {
    let no =
        u64::try_from(stored.hand_no).map_err(|_| recovery_error(id, "invalid hand number"))?;
    let seed = stored
        .seed
        .try_into()
        .map_err(|_| recovery_error(id, "invalid hand seed"))?;
    let dealer =
        usize::try_from(stored.dealer).map_err(|_| recovery_error(id, "invalid dealer"))?;
    let stacks = stored
        .stacks
        .into_iter()
        .map(|stack| u32::try_from(stack).map_err(|_| recovery_error(id, "invalid hand stack")))
        .collect::<Result<Vec<_>, _>>()?;
    let total: u64 = stacks.iter().map(|&stack| u64::from(stack)).sum();

    if stacks.len() != config.players
        || dealer >= config.players
        || stacks.iter().any(|&stack| stack < config.big_blind)
        || total > u64::from(u32::MAX)
    {
        return Err(recovery_error(id, "invalid hand inputs"));
    }

    let mut game = State::new(seed, dealer, &stacks, config.small_blind, config.big_blind);
    let next_seq = u64::try_from(stored.actions.len())
        .map_err(|_| recovery_error(id, "action limit reached"))?;

    // replay persisted actions
    for (expected, stored) in stored.actions.into_iter().enumerate() {
        let expected =
            u64::try_from(expected).map_err(|_| recovery_error(id, "action limit reached"))?;
        let seq =
            u64::try_from(stored.seq).map_err(|_| recovery_error(id, "invalid action sequence"))?;
        let player = usize::try_from(stored.player)
            .map_err(|_| recovery_error(id, "invalid action player"))?;
        let action = restore_action(&stored).map_err(|err| recovery_error(id, err))?;

        if seq != expected {
            return Err(recovery_error(id, "action sequence gap"));
        }

        if player >= config.players {
            return Err(recovery_error(id, "invalid action player"));
        }

        game.apply(player, action)
            .map_err(|_| recovery_error(id, "action replay rejected"))?;
        advance(&mut game).map_err(|_| recovery_error(id, "action replay failed"))?;
    }

    Ok(LiveHand {
        id: stored.id,
        no,
        game,
        next_seq,
    })
}

fn restore_action(stored: &StoredAction) -> Result<Action, &'static str> {
    match (stored.action.as_str(), stored.raise_to) {
        ("fold", None) => Ok(Action::Fold),
        ("check", None) => Ok(Action::Check),
        ("call", None) => Ok(Action::Call),
        ("raise_to", Some(to)) => u32::try_from(to)
            .map(Action::RaiseTo)
            .map_err(|_| "invalid raise target"),
        ("fold" | "check" | "call" | "raise_to", _) => Err("invalid action value"),
        _ => Err("unknown action"),
    }
}

fn recovery_error(room: Uuid, message: &str) -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidData,
        format!("cannot restore room {room}: {message}"),
    )
}

fn seat_view(game: &State, seat: usize) -> SeatView {
    let players = game
        .players
        .iter()
        .map(|player| PlayerView {
            stack: player.stack,
            bet: player.bet,
            folded: player.folded,
        })
        .collect();
    let turn =
        (!game.round_complete && game.fold_winner.is_none() && !game.settled).then_some(game.turn);

    SeatView {
        players,
        hole: game.hole[seat].map(card_view),
        board: game.board.iter().copied().map(card_view).collect(),
        pot: game.pot,
        dealer: game.dealer,
        turn,
        street: street_view(game.street),
        round_complete: game.round_complete,
        settled: game.settled,
        actions: game.legal_actions(seat).map(action_view),
        ready: None,
    }
}

fn action_view(actions: LegalActions) -> ActionView {
    ActionView {
        fold: actions.fold,
        check: actions.check,
        call: actions.call,
        raise: actions.raise.map(|range| RaiseView {
            min_to: range.min_to,
            max_to: range.max_to,
        }),
    }
}

fn card_view(card: Card) -> CardView {
    let rank = match card.rank() {
        Rank::Two => "2",
        Rank::Three => "3",
        Rank::Four => "4",
        Rank::Five => "5",
        Rank::Six => "6",
        Rank::Seven => "7",
        Rank::Eight => "8",
        Rank::Nine => "9",
        Rank::Ten => "10",
        Rank::Jack => "J",
        Rank::Queen => "Q",
        Rank::King => "K",
        Rank::Ace => "A",
    };
    let suit = match card.suit() {
        Suit::Clubs => "♣",
        Suit::Diamonds => "♦",
        Suit::Hearts => "♥",
        Suit::Spades => "♠",
    };

    CardView {
        value: format!("{rank}{suit}"),
    }
}

fn street_view(street: Street) -> &'static str {
    match street {
        Street::Preflop => "preflop",
        Street::Flop => "flop",
        Street::Turn => "turn",
        Street::River => "river",
    }
}

fn action_error(err: ActionError) -> &'static str {
    match err {
        ActionError::InvalidPlayer => "invalid player",
        ActionError::NotTurn => "not your turn",
        ActionError::RoundComplete => "betting round complete",
        ActionError::HandComplete => "hand complete",
        ActionError::CannotCheck => "cannot check",
        ActionError::CannotCall => "cannot call",
        ActionError::CannotRaise => "cannot raise",
    }
}

#[cfg(test)]
mod tests {
    use crate::db::StoredSeat;
    use sqlx::Row;

    use super::*;

    const SEED: [u8; 32] = [0x42; 32];
    const NEXT_SEED: [u8; 32] = [0x24; 32];

    fn config(players: usize) -> RoomConfig {
        RoomConfig {
            players,
            stack: 1000,
            small_blind: 5,
            big_blind: 10,
        }
    }

    fn started(stack: u32) -> Room {
        let mut config = config(2);

        config.stack = stack;

        let mut room = Room::new(config, hash_token(Uuid::new_v4())).unwrap();

        join(&mut room, Uuid::new_v4(), Some(SEED)).unwrap();
        room
    }

    fn join(room: &mut Room, token: Uuid, seed: Option<[u8; 32]>) -> Result<usize, JoinError> {
        let seat = room.next_seat()?;
        let hand = if seat + 1 == room.config.players {
            let seed = seed.expect("test seed");

            Some(LiveHand {
                id: Uuid::new_v4(),
                no: 0,
                game: start_game(room.config, seed),
                next_seq: 0,
            })
        } else {
            None
        };
        let rev = room.rev + 1;

        room.commit_join(hash_token(token), hand, rev);
        Ok(seat)
    }

    fn apply(room: &mut Room, seat: usize, action: Action) -> Result<(), &'static str> {
        let next = room.stage_action(seat, action)?;

        room.commit_action(next);
        Ok(())
    }

    fn stored_room() -> StoredRoom {
        StoredRoom {
            id: Uuid::from_u128(10),
            players: 2,
            stack: 1000,
            small_blind: 5,
            big_blind: 10,
            rev: 1,
            seats: vec![
                StoredSeat {
                    seat: 0,
                    token_hash: hash_token(Uuid::from_u128(1)).to_vec(),
                    ready_hand: None,
                },
                StoredSeat {
                    seat: 1,
                    token_hash: hash_token(Uuid::from_u128(2)).to_vec(),
                    ready_hand: None,
                },
            ],
            hand: Some(StoredHand {
                id: Uuid::from_u128(11),
                hand_no: 0,
                seed: SEED.to_vec(),
                dealer: 0,
                stacks: vec![1000, 1000],
                actions: Vec::new(),
            }),
        }
    }

    fn same_game(actual: &State, expected: &State) {
        assert_eq!(actual.players, expected.players);
        assert_eq!(actual.hole, expected.hole);
        assert_eq!(actual.board, expected.board);
        assert_eq!(actual.pot, expected.pot);
        assert_eq!(actual.min_raise, expected.min_raise);
        assert_eq!(actual.small_blind, expected.small_blind);
        assert_eq!(actual.big_blind, expected.big_blind);
        assert_eq!(actual.dealer, expected.dealer);
        assert_eq!(actual.turn, expected.turn);
        assert_eq!(actual.next_card, expected.next_card);
        assert_eq!(actual.street, expected.street);
        assert_eq!(actual.round_complete, expected.round_complete);
        assert_eq!(actual.fold_winner, expected.fold_winner);
        assert_eq!(actual.settled, expected.settled);

        for player in 0..actual.players.len() {
            assert_eq!(actual.legal_actions(player), expected.legal_actions(player));
        }
    }

    async fn reload(db: &Db, id: Uuid) -> Room {
        let stored = db
            .load_rooms()
            .await
            .unwrap()
            .into_iter()
            .find(|room| room.id == id)
            .unwrap();

        restore_room(stored).unwrap()
    }

    async fn persist(db: &Db, id: Uuid, room: &mut Room, seat: usize, action: Action) {
        let next = room.stage_action(seat, action).unwrap();

        db.append_action(NewAction {
            room: id,
            hand: next.hand,
            seq: next.seq,
            player: next.player,
            action: next.action,
            rev: room.rev,
            next_rev: next.rev,
        })
        .await
        .unwrap();
        room.commit_action(next);
    }

    #[test]
    fn valid_room() {
        let token = Uuid::new_v4();
        let token_hash = hash_token(token);
        let room = Room::new(config(3), token_hash).unwrap();

        assert_eq!(room.seats.len(), 1);
        assert_eq!(room.seats[0].token_hash, token_hash);
        assert!(room.hand.is_none());
        assert_eq!(room.rev, 0);
    }

    #[test]
    fn token_hashes() {
        let first = Uuid::from_u128(1);
        let second = Uuid::from_u128(2);

        assert_eq!(hash_token(first), hash_token(first));
        assert_ne!(hash_token(first), hash_token(second));
    }

    #[test]
    fn restored_token() {
        let room = restore_room(stored_room()).unwrap();

        assert_eq!(seat_for_token(&room, Uuid::from_u128(1)), Some(0));
        assert_eq!(seat_for_token(&room, Uuid::from_u128(2)), Some(1));
        assert_eq!(seat_for_token(&room, Uuid::from_u128(3)), None);
    }

    #[test]
    fn corrupt_recovery() {
        let mut room = stored_room();
        room.hand.as_mut().unwrap().seed.pop();
        assert!(restore_room(room).is_err());

        let mut room = stored_room();
        room.hand.as_mut().unwrap().dealer = 2;
        assert!(restore_room(room).is_err());

        let mut room = stored_room();
        room.hand.as_mut().unwrap().stacks[0] = i64::from(u32::MAX) + 1;
        assert!(restore_room(room).is_err());

        let mut room = stored_room();
        room.rev = 2;
        room.hand.as_mut().unwrap().actions.push(StoredAction {
            seq: 1,
            player: 0,
            action: "call".to_owned(),
            raise_to: None,
        });
        assert!(restore_room(room).is_err());

        let mut room = stored_room();
        room.rev = 2;
        room.hand.as_mut().unwrap().actions.push(StoredAction {
            seq: 0,
            player: 0,
            action: "bet".to_owned(),
            raise_to: None,
        });
        assert!(restore_room(room).is_err());

        let mut room = stored_room();
        room.rev = 2;
        room.hand.as_mut().unwrap().actions.push(StoredAction {
            seq: 0,
            player: 2,
            action: "fold".to_owned(),
            raise_to: None,
        });
        assert!(restore_room(room).is_err());

        let mut room = stored_room();
        room.rev = 2;
        room.hand.as_mut().unwrap().actions.push(StoredAction {
            seq: 0,
            player: 1,
            action: "check".to_owned(),
            raise_to: None,
        });
        assert!(restore_room(room).is_err());

        let mut room = stored_room();
        room.rev = 2;
        room.hand.as_mut().unwrap().actions.push(StoredAction {
            seq: 0,
            player: 0,
            action: "fold".to_owned(),
            raise_to: Some(20),
        });
        assert!(restore_room(room).is_err());
    }

    #[test]
    fn invalid_config() {
        let invalid = [
            RoomConfig {
                players: 1,
                ..config(2)
            },
            RoomConfig {
                players: 7,
                ..config(2)
            },
            RoomConfig {
                small_blind: 0,
                ..config(2)
            },
            RoomConfig {
                small_blind: 10,
                big_blind: 5,
                ..config(2)
            },
            RoomConfig {
                stack: 9,
                ..config(2)
            },
            RoomConfig {
                stack: u32::MAX,
                ..config(6)
            },
        ];

        for config in invalid {
            assert!(Room::new(config, hash_token(Uuid::new_v4())).is_err());
        }
    }

    #[test]
    fn ordered_join() {
        let first = Uuid::new_v4();
        let second = Uuid::new_v4();
        let mut room = Room::new(config(3), hash_token(first)).unwrap();
        let mut changes = room.notify.subscribe();

        assert_eq!(join(&mut room, second, None), Ok(1));
        assert_eq!(room.seats[1].token_hash, hash_token(second));
        assert_ne!(room.seats[0].token_hash, room.seats[1].token_hash);
        assert_eq!(room.rev, 1);
        assert_eq!(changes.try_recv(), Ok(1));
    }

    #[test]
    fn full_room() {
        let mut room = Room::new(config(2), hash_token(Uuid::new_v4())).unwrap();

        assert_eq!(join(&mut room, Uuid::new_v4(), Some(SEED)), Ok(1));
        assert_eq!(
            join(&mut room, Uuid::new_v4(), Some(SEED)),
            Err(JoinError::Full)
        );
    }

    #[test]
    fn final_join() {
        let config = config(3);
        let mut room = Room::new(config, hash_token(Uuid::new_v4())).unwrap();

        join(&mut room, Uuid::new_v4(), None).unwrap();
        join(&mut room, Uuid::new_v4(), Some(SEED)).unwrap();

        let game = &room.hand.as_ref().unwrap().game;

        assert_eq!(room.seats.len(), 3);
        assert_eq!(game.players.len(), 3);
        assert_eq!(game.dealer, 0);
        assert_eq!(game.pot, 15);
        assert_eq!(game.players[0].stack, 1000);
        assert_eq!(game.players[1].stack, 995);
        assert_eq!(game.players[2].stack, 990);
        assert_eq!(room.rev, 2);
    }

    #[test]
    fn room_isolation() {
        let mut first = Room::new(config(3), hash_token(Uuid::new_v4())).unwrap();
        let second = Room::new(config(3), hash_token(Uuid::new_v4())).unwrap();

        join(&mut first, Uuid::new_v4(), None).unwrap();

        assert_eq!(first.seats.len(), 2);
        assert_eq!(second.seats.len(), 1);
        assert!(first.hand.is_none());
        assert!(second.hand.is_none());
    }

    #[test]
    fn private_views() {
        let room = started(1000);
        let game = &room.hand.as_ref().unwrap().game;
        let first = seat_view(game, 0);
        let second = seat_view(game, 1);

        assert_eq!(first.hole, game.hole[0].map(card_view));
        assert_eq!(second.hole, game.hole[1].map(card_view));
        assert_ne!(first.hole, second.hole);
    }

    #[test]
    fn viewer_actions() {
        let room = started(1000);
        let game = &room.hand.as_ref().unwrap().game;

        assert!(seat_view(game, 0).actions.is_some());
        assert!(seat_view(game, 1).actions.is_none());
    }

    #[test]
    fn waiting_action() {
        let room = Room::new(config(3), hash_token(Uuid::new_v4())).unwrap();

        assert_eq!(
            room.stage_action(0, Action::Call).err(),
            Some("game not started")
        );
        assert_eq!(room.rev, 0);
    }

    #[test]
    fn legal_call() {
        let mut room = started(1000);
        let mut changes = room.notify.subscribe();

        assert_eq!(apply(&mut room, 0, Action::Call), Ok(()));

        let game = &room.hand.as_ref().unwrap().game;

        assert_eq!(game.players[0].stack, 990);
        assert_eq!(game.players[0].bet, 10);
        assert_eq!(game.pot, 20);
        assert_eq!(game.turn, 1);
        assert_eq!(room.rev, 2);
        assert_eq!(changes.try_recv(), Ok(2));
    }

    #[test]
    fn wrong_turn() {
        let room = started(1000);
        let expected = start_game(config(2), SEED);
        let mut changes = room.notify.subscribe();

        assert_eq!(
            room.stage_action(1, Action::Check).err(),
            Some("not your turn")
        );
        assert_eq!(&room.hand.as_ref().unwrap().game, &expected);
        assert_eq!(room.rev, 1);
        assert_eq!(
            changes.try_recv(),
            Err(broadcast::error::TryRecvError::Empty)
        );
    }

    #[test]
    fn invalid_raise() {
        let room = started(1000);
        let expected = start_game(config(2), SEED);

        assert_eq!(
            room.stage_action(0, Action::RaiseTo(10)).err(),
            Some("cannot raise")
        );
        assert_eq!(&room.hand.as_ref().unwrap().game, &expected);
        assert_eq!(room.rev, 1);
    }

    #[test]
    fn fold_win() {
        let mut room = started(100);

        apply(&mut room, 0, Action::Fold).unwrap();

        let game = &room.hand.as_ref().unwrap().game;

        assert!(game.settled);
        assert_eq!(game.fold_winner, Some(1));
        assert_eq!(game.pot, 0);
        assert_eq!(game.players[1].stack, 105);
        assert_eq!(room.rev, 2);
    }

    #[test]
    fn terminal_view() {
        let mut room = started(100);

        apply(&mut room, 0, Action::Fold).unwrap();

        let view = seat_view(&room.hand.as_ref().unwrap().game, 0);

        assert_eq!(view.turn, None);
        assert_eq!(view.actions, None);
        assert!(view.settled);
    }

    #[test]
    fn street_progress() {
        let mut room = started(1000);

        apply(&mut room, 0, Action::Call).unwrap();
        apply(&mut room, 1, Action::Check).unwrap();

        let game = &room.hand.as_ref().unwrap().game;

        assert_eq!(game.street, Street::Flop);
        assert_eq!(game.board.len(), 3);
        assert!(!game.round_complete);
        assert!(!game.settled);
        assert_eq!(room.rev, 3);
    }

    #[test]
    fn all_in_runout() {
        let mut room = started(100);

        apply(&mut room, 0, Action::RaiseTo(100)).unwrap();
        apply(&mut room, 1, Action::Call).unwrap();

        let game = &room.hand.as_ref().unwrap().game;

        assert!(game.settled);
        assert_eq!(game.street, Street::River);
        assert_eq!(game.board.len(), 5);
        assert_eq!(game.pot, 0);
        assert_eq!(
            game.players
                .iter()
                .map(|player| u64::from(player.stack))
                .sum::<u64>(),
            200
        );
        assert_eq!(room.rev, 3);
    }

    #[test]
    fn ready_rules() {
        let waiting = Room::new(config(2), hash_token(Uuid::new_v4())).unwrap();

        assert_eq!(waiting.stage_ready(0).err(), Some("game not started"));

        let mut room = started(100);

        assert_eq!(room.stage_ready(0).err(), Some("hand not settled"));
        apply(&mut room, 0, Action::Fold).unwrap();

        let ready = room.stage_ready(0).unwrap();

        assert!(!ready.all);
        room.commit_ready(0, None, ready.rev);
        assert_eq!(room.stage_ready(0).err(), Some("already ready"));

        let first = room_view(&room, room.hand.as_ref().unwrap(), 0)
            .ready
            .unwrap();
        let second = room_view(&room, room.hand.as_ref().unwrap(), 1)
            .ready
            .unwrap();

        assert_eq!(first.count, 1);
        assert!(first.mine);
        assert!(!second.mine);
        assert!(!first.complete);
    }

    #[test]
    fn next_hand() {
        let mut room = started(100);

        apply(&mut room, 0, Action::Fold).unwrap();

        let old = room.hand.as_ref().unwrap();
        let old_hole = old.game.hole.clone();
        let stacks: Vec<_> = old.game.players.iter().map(|player| player.stack).collect();

        let ready = room.stage_ready(0).unwrap();
        room.commit_ready(0, None, ready.rev);

        let ready = room.stage_ready(1).unwrap();
        let game = room
            .hand
            .as_ref()
            .unwrap()
            .game
            .next_hand(NEXT_SEED)
            .unwrap();
        let hand = LiveHand {
            id: Uuid::new_v4(),
            no: 1,
            game,
            next_seq: 0,
        };

        assert!(ready.all);
        room.commit_ready(1, Some(hand), ready.rev);

        let hand = room.hand.as_ref().unwrap();

        assert_eq!(hand.no, 1);
        assert_eq!(hand.game.dealer, 1);
        assert_eq!(hand.next_seq, 0);
        assert_ne!(hand.game.hole, old_hole);
        assert_eq!(
            hand.game
                .players
                .iter()
                .map(|player| player.stack + player.bet)
                .collect::<Vec<_>>(),
            stacks
        );
        assert!(room.seats.iter().all(|seat| seat.ready_hand.is_none()));
        assert!(room_view(&room, hand, 0).ready.is_none());
        assert_ne!(seat_view(&hand.game, 0).hole, seat_view(&hand.game, 1).hole);
    }

    #[test]
    fn short_table() {
        let mut room = started(10);

        apply(&mut room, 0, Action::Fold).unwrap();
        let game = room.hand.as_ref().unwrap().game.clone();

        let ready = room.stage_ready(0).unwrap();
        room.commit_ready(0, None, ready.rev);
        let ready = room.stage_ready(1).unwrap();

        assert_eq!(
            room.hand.as_ref().unwrap().game.next_hand(NEXT_SEED),
            Err(NextHandError::CannotStart)
        );

        room.commit_ready(1, None, ready.rev);

        let hand = room.hand.as_ref().unwrap();
        let view = room_view(&room, hand, 0).ready.unwrap();

        assert_eq!(hand.game, game);
        assert_eq!(hand.no, 0);
        assert!(view.complete);
        assert_eq!(view.count, 2);
    }

    #[tokio::test]
    #[ignore = "requires TEST_DATABASE_URL"]
    async fn persistence() {
        let url = std::env::var("TEST_DATABASE_URL").expect("TEST_DATABASE_URL");
        let db = Db::connect(&url).await.unwrap();

        sqlx::query("TRUNCATE hand_actions, hands, seats, rooms")
            .execute(db.pool())
            .await
            .unwrap();

        let waiting_config = config(3);
        let waiting_id = Uuid::new_v4();
        let waiting_first = Uuid::new_v4();
        let waiting_second = Uuid::new_v4();

        db.create_room(
            waiting_id,
            waiting_config.players,
            waiting_config.stack,
            waiting_config.small_blind,
            waiting_config.big_blind,
            &hash_token(waiting_first),
        )
        .await
        .unwrap();
        db.join_room(waiting_id, 1, &hash_token(waiting_second), 0, 1, None)
            .await
            .unwrap();

        let waiting = reload(&db, waiting_id).await;

        assert_eq!(waiting.seats.len(), 2);
        assert!(waiting.hand.is_none());
        assert_eq!(waiting.rev, 1);
        assert_eq!(waiting.next_seat(), Ok(2));
        assert_eq!(seat_for_token(&waiting, waiting_first), Some(0));
        assert_eq!(seat_for_token(&waiting, waiting_second), Some(1));
        assert_eq!(
            room_message(&waiting, 0),
            ServerMessage::Waiting {
                joined: 2,
                players: 3
            }
        );

        let config = config(2);
        let id = Uuid::new_v4();
        let first = Uuid::new_v4();
        let first_hash = hash_token(first);

        db.create_room(
            id,
            config.players,
            config.stack,
            config.small_blind,
            config.big_blind,
            &first_hash,
        )
        .await
        .unwrap();

        let row = sqlx::query(
            "SELECT players, stack, small_blind, big_blind, rev FROM rooms WHERE id = $1",
        )
        .bind(id)
        .fetch_one(db.pool())
        .await
        .unwrap();

        assert_eq!(row.get::<i32, _>("players"), 2);
        assert_eq!(row.get::<i64, _>("stack"), 1000);
        assert_eq!(row.get::<i64, _>("small_blind"), 5);
        assert_eq!(row.get::<i64, _>("big_blind"), 10);
        assert_eq!(row.get::<i64, _>("rev"), 0);

        let mut room = Room::new(config, first_hash).unwrap();
        let second = Uuid::new_v4();
        let second_hash = hash_token(second);
        let hand_id = Uuid::new_v4();
        let stacks = vec![config.stack; config.players];

        db.join_room(
            id,
            1,
            &second_hash,
            0,
            1,
            Some(NewHand {
                id: hand_id,
                no: 0,
                seed: &SEED,
                dealer: 0,
                stacks: &stacks,
            }),
        )
        .await
        .unwrap();
        room.commit_join(
            second_hash,
            Some(LiveHand {
                id: hand_id,
                no: 0,
                game: start_game(config, SEED),
                next_seq: 0,
            }),
            1,
        );

        let rows =
            sqlx::query("SELECT seat, token_hash FROM seats WHERE room_id = $1 ORDER BY seat")
                .bind(id)
                .fetch_all(db.pool())
                .await
                .unwrap();

        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].get::<i32, _>("seat"), 0);
        assert_eq!(rows[1].get::<i32, _>("seat"), 1);
        assert_eq!(rows[0].get::<Vec<u8>, _>("token_hash"), first_hash);
        assert_eq!(rows[1].get::<Vec<u8>, _>("token_hash"), second_hash);
        assert_ne!(rows[0].get::<Vec<u8>, _>("token_hash"), first.as_bytes());
        assert_ne!(rows[1].get::<Vec<u8>, _>("token_hash"), second.as_bytes());

        let row =
            sqlx::query("SELECT hand_no, seed, dealer, starting_stacks FROM hands WHERE id = $1")
                .bind(hand_id)
                .fetch_one(db.pool())
                .await
                .unwrap();

        assert_eq!(row.get::<i64, _>("hand_no"), 0);
        assert_eq!(row.get::<Vec<u8>, _>("seed"), SEED);
        assert_eq!(row.get::<i32, _>("dealer"), 0);
        assert_eq!(row.get::<Vec<i64>, _>("starting_stacks"), [1000, 1000]);

        persist(&db, id, &mut room, 0, Action::RaiseTo(20)).await;

        let expected = room.hand.as_ref().unwrap().game.clone();
        let restored = reload(&db, id).await;
        let restored_hand = restored.hand.as_ref().unwrap();

        same_game(&restored_hand.game, &expected);
        assert_eq!(restored.rev, 2);
        assert_eq!(restored_hand.next_seq, 1);
        assert_eq!(seat_for_token(&restored, first), Some(0));
        assert_eq!(seat_for_token(&restored, second), Some(1));
        room = restored;

        persist(&db, id, &mut room, 1, Action::Call).await;

        let expected = room.hand.as_ref().unwrap().game.clone();
        let restored = reload(&db, id).await;
        let restored_hand = restored.hand.as_ref().unwrap();

        same_game(&restored_hand.game, &expected);
        assert_eq!(restored_hand.game.street, Street::Flop);
        assert_eq!(restored_hand.game.board.len(), 3);
        assert_eq!(restored_hand.next_seq, 2);
        room = restored;

        persist(&db, id, &mut room, 1, Action::Check).await;

        let state = room.hand.as_ref().unwrap().game.clone();
        let rev = room.rev;
        let count = sqlx::query("SELECT COUNT(*) AS count FROM hand_actions WHERE hand_id = $1")
            .bind(hand_id)
            .fetch_one(db.pool())
            .await
            .unwrap()
            .get::<i64, _>("count");

        assert_eq!(
            room.stage_action(1, Action::Check).err(),
            Some("not your turn")
        );
        assert_eq!(room.hand.as_ref().unwrap().game, state);
        assert_eq!(room.rev, rev);
        assert_eq!(
            sqlx::query("SELECT COUNT(*) AS count FROM hand_actions WHERE hand_id = $1")
                .bind(hand_id)
                .fetch_one(db.pool())
                .await
                .unwrap()
                .get::<i64, _>("count"),
            count
        );

        let state = room.hand.as_ref().unwrap().game.clone();
        let rev = room.rev;
        let next = room.stage_action(0, Action::Check).unwrap();

        assert!(
            db.append_action(NewAction {
                room: id,
                hand: next.hand,
                seq: next.seq,
                player: next.player,
                action: next.action,
                rev: rev + 1,
                next_rev: next.rev,
            })
            .await
            .is_err()
        );
        assert_eq!(room.hand.as_ref().unwrap().game, state);
        assert_eq!(room.rev, rev);
        assert_eq!(
            sqlx::query("SELECT COUNT(*) AS count FROM hand_actions WHERE hand_id = $1")
                .bind(hand_id)
                .fetch_one(db.pool())
                .await
                .unwrap()
                .get::<i64, _>("count"),
            count
        );

        let rows = sqlx::query(
            "SELECT seq, player, action, raise_to FROM hand_actions \
             WHERE hand_id = $1 ORDER BY seq",
        )
        .bind(hand_id)
        .fetch_all(db.pool())
        .await
        .unwrap();

        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].get::<i64, _>("seq"), 0);
        assert_eq!(rows[0].get::<i32, _>("player"), 0);
        assert_eq!(rows[0].get::<String, _>("action"), "raise_to");
        assert_eq!(rows[0].get::<Option<i64>, _>("raise_to"), Some(20));
        assert_eq!(rows[1].get::<i64, _>("seq"), 1);
        assert_eq!(rows[1].get::<i32, _>("player"), 1);
        assert_eq!(rows[1].get::<String, _>("action"), "call");
        assert_eq!(rows[1].get::<Option<i64>, _>("raise_to"), None);
        assert_eq!(rows[2].get::<i64, _>("seq"), 2);
        assert_eq!(rows[2].get::<String, _>("action"), "check");
        assert_eq!(
            sqlx::query("SELECT rev FROM rooms WHERE id = $1")
                .bind(id)
                .fetch_one(db.pool())
                .await
                .unwrap()
                .get::<i64, _>("rev"),
            4
        );

        persist(&db, id, &mut room, 0, Action::Check).await;
        persist(&db, id, &mut room, 1, Action::Check).await;
        persist(&db, id, &mut room, 0, Action::Check).await;
        persist(&db, id, &mut room, 1, Action::Check).await;
        persist(&db, id, &mut room, 0, Action::Check).await;

        let expected = room.hand.as_ref().unwrap().game.clone();
        let restored = reload(&db, id).await;
        let restored_hand = restored.hand.as_ref().unwrap();

        same_game(&restored_hand.game, &expected);
        assert!(restored_hand.game.settled);
        assert_eq!(restored_hand.game.street, Street::River);
        assert_eq!(restored_hand.game.board.len(), 5);
        assert_eq!(restored_hand.game.pot, 0);
        assert_eq!(restored_hand.next_seq, 8);
        assert_eq!(restored.rev, 9);
        assert!(
            restored_hand
                .game
                .players
                .iter()
                .enumerate()
                .all(|(player, _)| restored_hand.game.legal_actions(player).is_none())
        );

        let rows = sqlx::query("SELECT seq FROM hand_actions WHERE hand_id = $1 ORDER BY seq")
            .bind(hand_id)
            .fetch_all(db.pool())
            .await
            .unwrap();
        let seqs: Vec<i64> = rows.iter().map(|row| row.get("seq")).collect();

        assert_eq!(seqs, (0..8).collect::<Vec<_>>());

        let other_id = Uuid::new_v4();
        let other_first = hash_token(Uuid::new_v4());
        let other_second = hash_token(Uuid::new_v4());
        let other_hand = Uuid::new_v4();
        let mut other = Room::new(config, other_first).unwrap();

        db.create_room(
            other_id,
            config.players,
            config.stack,
            config.small_blind,
            config.big_blind,
            &other_first,
        )
        .await
        .unwrap();
        db.join_room(
            other_id,
            1,
            &other_second,
            0,
            1,
            Some(NewHand {
                id: other_hand,
                no: 0,
                seed: &SEED,
                dealer: 0,
                stacks: &stacks,
            }),
        )
        .await
        .unwrap();
        other.commit_join(
            other_second,
            Some(LiveHand {
                id: other_hand,
                no: 0,
                game: start_game(config, SEED),
                next_seq: 0,
            }),
            1,
        );
        persist(&db, other_id, &mut other, 0, Action::Fold).await;

        let expected = other.hand.as_ref().unwrap().game.clone();
        let restored = reload(&db, other_id).await;
        let restored_hand = restored.hand.as_ref().unwrap();

        same_game(&restored_hand.game, &expected);
        assert!(restored_hand.game.settled);
        assert_eq!(restored_hand.game.fold_winner, Some(1));
        assert_eq!(restored_hand.game.pot, 0);

        let other_count = sqlx::query(
            "SELECT COUNT(*) AS count FROM hand_actions actions \
             JOIN hands ON hands.id = actions.hand_id WHERE hands.room_id = $1",
        )
        .bind(other_id)
        .fetch_one(db.pool())
        .await
        .unwrap()
        .get::<i64, _>("count");
        let first_count = sqlx::query(
            "SELECT COUNT(*) AS count FROM hand_actions actions \
             JOIN hands ON hands.id = actions.hand_id WHERE hands.room_id = $1",
        )
        .bind(id)
        .fetch_one(db.pool())
        .await
        .unwrap()
        .get::<i64, _>("count");

        assert_eq!(first_count, 8);
        assert_eq!(other_count, 1);

        let mut all_in_config = config;
        all_in_config.stack = 100;
        let all_in_id = Uuid::new_v4();
        let all_in_first = hash_token(Uuid::new_v4());
        let all_in_second = hash_token(Uuid::new_v4());
        let all_in_hand = Uuid::new_v4();
        let all_in_stacks = vec![100, 100];
        let mut all_in = Room::new(all_in_config, all_in_first).unwrap();

        db.create_room(
            all_in_id,
            all_in_config.players,
            all_in_config.stack,
            all_in_config.small_blind,
            all_in_config.big_blind,
            &all_in_first,
        )
        .await
        .unwrap();
        db.join_room(
            all_in_id,
            1,
            &all_in_second,
            0,
            1,
            Some(NewHand {
                id: all_in_hand,
                no: 0,
                seed: &SEED,
                dealer: 0,
                stacks: &all_in_stacks,
            }),
        )
        .await
        .unwrap();
        all_in.commit_join(
            all_in_second,
            Some(LiveHand {
                id: all_in_hand,
                no: 0,
                game: State::new(SEED, 0, &all_in_stacks, 5, 10),
                next_seq: 0,
            }),
            1,
        );
        persist(&db, all_in_id, &mut all_in, 0, Action::RaiseTo(100)).await;
        persist(&db, all_in_id, &mut all_in, 1, Action::Call).await;

        let expected = all_in.hand.as_ref().unwrap().game.clone();
        let restored = reload(&db, all_in_id).await;
        let restored_hand = restored.hand.as_ref().unwrap();

        same_game(&restored_hand.game, &expected);
        assert!(restored_hand.game.settled);
        assert_eq!(restored_hand.game.street, Street::River);
        assert_eq!(restored_hand.game.board.len(), 5);
        assert_eq!(restored_hand.game.pot, 0);

        let latest_id = Uuid::new_v4();
        let latest_seed = [0x24; 32];

        sqlx::query(
            "INSERT INTO hands (id, room_id, hand_no, seed, dealer, starting_stacks) \
             VALUES ($1, $2, 1, $3, 1, $4)",
        )
        .bind(latest_id)
        .bind(all_in_id)
        .bind(latest_seed.as_slice())
        .bind(vec![100i64, 100])
        .execute(db.pool())
        .await
        .unwrap();

        let restored = reload(&db, all_in_id).await;
        let restored_hand = restored.hand.as_ref().unwrap();
        let expected = State::new(latest_seed, 1, &[100, 100], 5, 10);

        assert_eq!(restored_hand.id, latest_id);
        assert_eq!(restored_hand.next_seq, 0);
        same_game(&restored_hand.game, &expected);

        let ready_id = Uuid::new_v4();
        let ready_first = Uuid::new_v4();
        let ready_second = Uuid::new_v4();
        let ready_hand = Uuid::new_v4();
        let ready_config = RoomConfig {
            players: 2,
            stack: 100,
            small_blind: 5,
            big_blind: 10,
        };
        let ready_stacks = vec![100, 100];
        let mut live = Room::new(ready_config, hash_token(ready_first)).unwrap();

        db.create_room(
            ready_id,
            ready_config.players,
            100,
            ready_config.small_blind,
            ready_config.big_blind,
            &hash_token(ready_first),
        )
        .await
        .unwrap();
        db.join_room(
            ready_id,
            1,
            &hash_token(ready_second),
            0,
            1,
            Some(NewHand {
                id: ready_hand,
                no: 0,
                seed: &SEED,
                dealer: 0,
                stacks: &ready_stacks,
            }),
        )
        .await
        .unwrap();
        live.commit_join(
            hash_token(ready_second),
            Some(LiveHand {
                id: ready_hand,
                no: 0,
                game: State::new(SEED, 0, &ready_stacks, 5, 10),
                next_seq: 0,
            }),
            1,
        );

        let mut rooms = HashMap::new();
        rooms.insert(ready_id, Arc::new(Mutex::new(live)));
        let ready_state = AppState::new(db.clone(), rooms);

        assert_eq!(
            ready_room(&ready_state, ready_id, 0).await,
            Err("hand not settled")
        );
        apply_action(&ready_state, ready_id, 0, Action::Fold)
            .await
            .unwrap();
        ready_room(&ready_state, ready_id, 0).await.unwrap();

        let rev = sqlx::query("SELECT rev FROM rooms WHERE id = $1")
            .bind(ready_id)
            .fetch_one(db.pool())
            .await
            .unwrap()
            .get::<i64, _>("rev");

        assert_eq!(rev, 3);
        assert_eq!(
            sqlx::query("SELECT ready_hand FROM seats WHERE room_id = $1 AND seat = 0")
                .bind(ready_id)
                .fetch_one(db.pool())
                .await
                .unwrap()
                .get::<Option<Uuid>, _>("ready_hand"),
            Some(ready_hand)
        );
        assert_eq!(
            ready_room(&ready_state, ready_id, 0).await,
            Err("already ready")
        );
        assert_eq!(
            sqlx::query("SELECT rev FROM rooms WHERE id = $1")
                .bind(ready_id)
                .fetch_one(db.pool())
                .await
                .unwrap()
                .get::<i64, _>("rev"),
            rev
        );

        let restored = reload(&db, ready_id).await;
        let first_ready = room_view(&restored, restored.hand.as_ref().unwrap(), 0)
            .ready
            .unwrap();
        let second_ready = room_view(&restored, restored.hand.as_ref().unwrap(), 1)
            .ready
            .unwrap();

        assert!(first_ready.mine);
        assert!(!second_ready.mine);
        assert_eq!(first_ready.count, 1);
        assert_eq!(restored.rev, 3);
        assert_eq!(seat_for_token(&restored, ready_first), Some(0));
        assert_eq!(seat_for_token(&restored, ready_second), Some(1));

        let mut rooms = HashMap::new();
        rooms.insert(ready_id, Arc::new(Mutex::new(restored)));
        let ready_state = AppState::new(db.clone(), rooms);

        ready_room(&ready_state, ready_id, 1).await.unwrap();

        let room = find_room(&ready_state, ready_id).await.unwrap();
        let room = room.lock().await;
        let next = room.hand.as_ref().unwrap();
        let next_id = next.id;

        assert_eq!(next.no, 1);
        assert_eq!(next.game.dealer, 1);
        assert_eq!(next.next_seq, 0);
        assert!(!next.game.settled);
        assert_eq!(next.game.board.len(), 0);
        assert_eq!(next.game.pot, 15);
        assert!(room.seats.iter().all(|seat| seat.ready_hand.is_none()));
        assert!(room_view(&room, next, 0).ready.is_none());
        assert_ne!(seat_view(&next.game, 0).hole, seat_view(&next.game, 1).hole);
        drop(room);

        let rows = sqlx::query(
            "SELECT id, hand_no, seed, dealer, starting_stacks FROM hands \
             WHERE room_id = $1 ORDER BY hand_no",
        )
        .bind(ready_id)
        .fetch_all(db.pool())
        .await
        .unwrap();

        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].get::<Uuid, _>("id"), ready_hand);
        assert_eq!(rows[1].get::<Uuid, _>("id"), next_id);
        assert_eq!(rows[1].get::<i64, _>("hand_no"), 1);
        assert_eq!(rows[1].get::<Vec<u8>, _>("seed").len(), 32);
        assert_eq!(rows[1].get::<i32, _>("dealer"), 1);
        assert_eq!(rows[1].get::<Vec<i64>, _>("starting_stacks"), [95, 105]);
        assert!(
            sqlx::query("SELECT ready_hand FROM seats WHERE room_id = $1")
                .bind(ready_id)
                .fetch_all(db.pool())
                .await
                .unwrap()
                .iter()
                .all(|row| row.get::<Option<Uuid>, _>("ready_hand").is_none())
        );
        assert_eq!(
            sqlx::query("SELECT COUNT(*) AS count FROM hand_actions WHERE hand_id = $1")
                .bind(ready_hand)
                .fetch_one(db.pool())
                .await
                .unwrap()
                .get::<i64, _>("count"),
            1
        );

        apply_action(&ready_state, ready_id, 1, Action::Call)
            .await
            .unwrap();

        let row = sqlx::query(
            "SELECT seq, player, action FROM hand_actions WHERE hand_id = $1 ORDER BY seq",
        )
        .bind(next_id)
        .fetch_one(db.pool())
        .await
        .unwrap();

        assert_eq!(row.get::<i64, _>("seq"), 0);
        assert_eq!(row.get::<i32, _>("player"), 1);
        assert_eq!(row.get::<String, _>("action"), "call");

        let before = find_room(&ready_state, ready_id).await.unwrap();
        let before = before.lock().await.hand.as_ref().unwrap().game.clone();
        let restored = reload(&db, ready_id).await;
        let restored_hand = restored.hand.as_ref().unwrap();

        same_game(&restored_hand.game, &before);
        assert_eq!(restored_hand.id, next_id);
        assert_eq!(restored_hand.no, 1);
        assert_eq!(restored_hand.next_seq, 1);

        apply_action(&ready_state, ready_id, 0, Action::Fold)
            .await
            .unwrap();
        let (first, second) = tokio::join!(
            ready_room(&ready_state, ready_id, 0),
            ready_room(&ready_state, ready_id, 1)
        );

        assert_eq!(first, Ok(()));
        assert_eq!(second, Ok(()));
        assert_eq!(
            sqlx::query("SELECT COUNT(*) AS count FROM hands WHERE room_id = $1")
                .bind(ready_id)
                .fetch_one(db.pool())
                .await
                .unwrap()
                .get::<i64, _>("count"),
            3
        );

        let short_id = Uuid::new_v4();
        let short_first = hash_token(Uuid::new_v4());
        let short_second = hash_token(Uuid::new_v4());
        let short_hand = Uuid::new_v4();
        let short_config = RoomConfig {
            stack: 10,
            ..ready_config
        };
        let short_stacks = vec![10, 10];
        let mut short = Room::new(short_config, short_first).unwrap();

        db.create_room(short_id, 2, 10, 5, 10, &short_first)
            .await
            .unwrap();
        db.join_room(
            short_id,
            1,
            &short_second,
            0,
            1,
            Some(NewHand {
                id: short_hand,
                no: 0,
                seed: &SEED,
                dealer: 0,
                stacks: &short_stacks,
            }),
        )
        .await
        .unwrap();
        short.commit_join(
            short_second,
            Some(LiveHand {
                id: short_hand,
                no: 0,
                game: State::new(SEED, 0, &short_stacks, 5, 10),
                next_seq: 0,
            }),
            1,
        );

        let mut rooms = HashMap::new();
        rooms.insert(short_id, Arc::new(Mutex::new(short)));
        let short_state = AppState::new(db.clone(), rooms);

        apply_action(&short_state, short_id, 0, Action::Fold)
            .await
            .unwrap();
        ready_room(&short_state, short_id, 0).await.unwrap();
        ready_room(&short_state, short_id, 1).await.unwrap();

        let short = find_room(&short_state, short_id).await.unwrap();
        let short = short.lock().await;
        let hand = short.hand.as_ref().unwrap();

        assert_eq!(hand.id, short_hand);
        assert_eq!(hand.no, 0);
        assert_eq!(hand.game.players[0].stack, 5);
        assert!(room_view(&short, hand, 0).ready.unwrap().complete);
        assert_eq!(
            sqlx::query("SELECT COUNT(*) AS count FROM hands WHERE room_id = $1")
                .bind(short_id)
                .fetch_one(db.pool())
                .await
                .unwrap()
                .get::<i64, _>("count"),
            1
        );
        drop(short);

        let short = reload(&db, short_id).await;
        let hand = short.hand.as_ref().unwrap();

        assert!(room_view(&short, hand, 1).ready.unwrap().complete);
        assert_eq!(hand.id, short_hand);
    }
}
