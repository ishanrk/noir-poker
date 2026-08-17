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
use game_core::{Action, ActionError, Card, LegalActions, Rank, State, Street, Suit};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::net::TcpListener;
use tokio::sync::{Mutex, broadcast};
use tower_http::cors::CorsLayer;
use uuid::Uuid;

use crate::db::{Db, NewAction, NewHand};

type HttpError = (StatusCode, &'static str);
type TokenHash = [u8; 32];
type Rooms = Arc<Mutex<HashMap<Uuid, Arc<Mutex<Room>>>>>;

#[derive(Clone)]
struct AppState {
    db: Db,
    rooms: Rooms,
}

impl AppState {
    fn new(db: Db) -> Self {
        Self {
            db,
            rooms: Arc::new(Mutex::new(HashMap::new())),
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
            seats: vec![Seat { token_hash }],
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
        self.seats.push(Seat { token_hash });
        self.hand = hand;
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
}

struct LiveHand {
    id: Uuid,
    game: State,
    next_seq: u64,
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
    let listener = TcpListener::bind(("0.0.0.0", port)).await?;

    axum::serve(listener, app(AppState::new(db), origin)).await?;
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
        seed,
        dealer: 0,
        stacks: stacks.as_deref().expect("starting stacks"),
    });
    let game = seed.map(|seed| LiveHand {
        id: hand_id.expect("hand id"),
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
    let token_hash = hash_token(token);
    let session = match find_room(&state, id).await {
        Some(room) => {
            let room = room.lock().await;

            match room
                .seats
                .iter()
                .position(|seat| seat.token_hash == token_hash)
            {
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

                let action = match message {
                    Message::Text(text) => match serde_json::from_str(text.as_str()) {
                        Ok(ClientMessage::Fold) => Action::Fold,
                        Ok(ClientMessage::Check) => Action::Check,
                        Ok(ClientMessage::Call) => Action::Call,
                        Ok(ClientMessage::RaiseTo { to }) => Action::RaiseTo(to),
                        Ok(ClientMessage::Auth { .. }) => {
                            send_error(&mut socket, "already authenticated").await;
                            continue;
                        }
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
                let result = apply_action(&state, id, seat, action).await;

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

async fn current_message(state: &AppState, id: Uuid, seat: usize) -> Option<ServerMessage> {
    let room = find_room(state, id).await?;
    let room = room.lock().await;

    Some(room_message(&room, seat))
}

fn room_message(room: &Room, seat: usize) -> ServerMessage {
    match &room.hand {
        Some(hand) => ServerMessage::Snapshot {
            rev: room.rev,
            view: seat_view(&hand.game, seat),
        },
        None => ServerMessage::Waiting {
            joined: room.seats.len(),
            players: room.config.players,
        },
    }
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
    use sqlx::Row;

    use super::*;

    const SEED: [u8; 32] = [0x42; 32];

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

    #[tokio::test]
    #[ignore = "requires TEST_DATABASE_URL"]
    async fn persistence() {
        let url = std::env::var("TEST_DATABASE_URL").expect("TEST_DATABASE_URL");
        let db = Db::connect(&url).await.unwrap();

        sqlx::query("TRUNCATE hand_actions, hands, seats, rooms")
            .execute(db.pool())
            .await
            .unwrap();

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
        persist(&db, id, &mut room, 1, Action::Call).await;
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
                game: start_game(config, SEED),
                next_seq: 0,
            }),
            1,
        );
        persist(&db, other_id, &mut other, 0, Action::Fold).await;

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

        assert_eq!(first_count, 3);
        assert_eq!(other_count, 1);
    }
}
