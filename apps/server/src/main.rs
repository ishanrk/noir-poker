use std::collections::HashMap;
use std::env;
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
use tokio::net::TcpListener;
use tokio::sync::{Mutex, broadcast};
use tower_http::cors::CorsLayer;
use uuid::Uuid;

type HttpError = (StatusCode, &'static str);

#[derive(Clone)]
struct AppState {
    // room state behind one lock
    rooms: Arc<Mutex<HashMap<Uuid, Room>>>,
}

impl AppState {
    fn new() -> Self {
        Self {
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
    game: Option<State>,
    rev: u64,
    notify: broadcast::Sender<u64>,
}

impl Room {
    fn new(config: RoomConfig, token: Uuid) -> Result<Self, &'static str> {
        config.validate()?;
        let (notify, _) = broadcast::channel(16);

        Ok(Self {
            config,
            seats: vec![Seat { token }],
            game: None,
            rev: 0,
            notify,
        })
    }

    fn join(&mut self, token: Uuid, seed: Option<[u8; 32]>) -> Result<usize, JoinError> {
        if self.game.is_some() || self.seats.len() >= self.config.players {
            return Err(JoinError::Full);
        }

        let seat = self.seats.len();
        let game = if seat + 1 == self.config.players {
            Some(start_game(self.config, seed.ok_or(JoinError::Start)?))
        } else {
            None
        };

        self.seats.push(Seat { token });
        self.game = game;
        self.changed();
        Ok(seat)
    }

    fn apply(&mut self, seat: usize, action: Action) -> Result<(), &'static str> {
        let game = self.game.as_mut().ok_or("game not started")?;

        game.apply(seat, action).map_err(action_error)?;
        advance(game)?;
        self.changed();
        Ok(())
    }

    fn changed(&mut self) {
        self.rev += 1;
        let _ = self.notify.send(self.rev);
    }
}

struct Seat {
    token: Uuid,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum JoinError {
    Full,
    Start,
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
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let port: u16 = env::var("PORT")
        .unwrap_or_else(|_| "3001".to_owned())
        .parse()?;
    let origin: HeaderValue = env::var("WEB_ORIGIN")
        .unwrap_or_else(|_| "http://localhost:3000".to_owned())
        .parse()?;
    let listener = TcpListener::bind(("0.0.0.0", port)).await?;

    axum::serve(listener, app(AppState::new(), origin)).await?;
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
    let room = Room::new(config, token).map_err(|err| (StatusCode::BAD_REQUEST, err))?;
    let mut rooms = state.rooms.lock().await;
    let id = loop {
        let id = Uuid::new_v4();

        if !rooms.contains_key(&id) {
            break id;
        }
    };

    rooms.insert(id, room);

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
    let mut rooms = state.rooms.lock().await;
    let room = rooms
        .get_mut(&id)
        .ok_or((StatusCode::NOT_FOUND, "room not found"))?;
    let token = room_token(room);
    let seed = if room.seats.len() + 1 == room.config.players {
        Some(secure_seed().map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "cannot start room"))?)
    } else {
        None
    };
    let seat = room.join(token, seed).map_err(|err| match err {
        JoinError::Full => (StatusCode::CONFLICT, "room full"),
        JoinError::Start => (StatusCode::INTERNAL_SERVER_ERROR, "cannot start room"),
    })?;

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
    let session = {
        let rooms = state.rooms.lock().await;

        match rooms.get(&id) {
            Some(room) => match room.seats.iter().position(|seat| seat.token == token) {
                Some(seat) => Ok((seat, room.notify.subscribe(), room_message(room, seat))),
                None => Err("unknown token"),
            },
            None => Err("room not found"),
        }
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
                let result = {
                    let mut rooms = state.rooms.lock().await;

                    match rooms.get_mut(&id) {
                        Some(room) => room.apply(seat, action),
                        None => Err("room not found"),
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

async fn current_message(state: &AppState, id: Uuid, seat: usize) -> Option<ServerMessage> {
    let rooms = state.rooms.lock().await;
    let room = rooms.get(&id)?;

    Some(room_message(room, seat))
}

fn room_message(room: &Room, seat: usize) -> ServerMessage {
    match &room.game {
        Some(game) => ServerMessage::Snapshot {
            rev: room.rev,
            view: seat_view(game, seat),
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

fn room_token(room: &Room) -> Uuid {
    loop {
        let token = Uuid::new_v4();

        if room.seats.iter().all(|seat| seat.token != token) {
            return token;
        }
    }
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

        let mut room = Room::new(config, Uuid::new_v4()).unwrap();

        room.join(Uuid::new_v4(), Some(SEED)).unwrap();
        room
    }

    #[test]
    fn valid_room() {
        let token = Uuid::new_v4();
        let room = Room::new(config(3), token).unwrap();

        assert_eq!(room.seats.len(), 1);
        assert_eq!(room.seats[0].token, token);
        assert!(room.game.is_none());
        assert_eq!(room.rev, 0);
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
            assert!(Room::new(config, Uuid::new_v4()).is_err());
        }
    }

    #[test]
    fn ordered_join() {
        let first = Uuid::new_v4();
        let second = Uuid::new_v4();
        let mut room = Room::new(config(3), first).unwrap();
        let mut changes = room.notify.subscribe();

        assert_eq!(room.join(second, None), Ok(1));
        assert_eq!(room.seats[1].token, second);
        assert_ne!(room.seats[0].token, room.seats[1].token);
        assert_eq!(room.rev, 1);
        assert_eq!(changes.try_recv(), Ok(1));
    }

    #[test]
    fn full_room() {
        let mut room = Room::new(config(2), Uuid::new_v4()).unwrap();

        assert_eq!(room.join(Uuid::new_v4(), Some(SEED)), Ok(1));
        assert_eq!(room.join(Uuid::new_v4(), Some(SEED)), Err(JoinError::Full));
    }

    #[test]
    fn final_join() {
        let config = config(3);
        let mut room = Room::new(config, Uuid::new_v4()).unwrap();

        room.join(Uuid::new_v4(), None).unwrap();
        room.join(Uuid::new_v4(), Some(SEED)).unwrap();

        let game = room.game.as_ref().unwrap();

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
        let mut first = Room::new(config(3), Uuid::new_v4()).unwrap();
        let second = Room::new(config(3), Uuid::new_v4()).unwrap();

        first.join(Uuid::new_v4(), None).unwrap();

        assert_eq!(first.seats.len(), 2);
        assert_eq!(second.seats.len(), 1);
        assert!(first.game.is_none());
        assert!(second.game.is_none());
    }

    #[test]
    fn private_views() {
        let room = started(1000);
        let game = room.game.as_ref().unwrap();
        let first = seat_view(game, 0);
        let second = seat_view(game, 1);

        assert_eq!(first.hole, game.hole[0].map(card_view));
        assert_eq!(second.hole, game.hole[1].map(card_view));
        assert_ne!(first.hole, second.hole);
    }

    #[test]
    fn viewer_actions() {
        let room = started(1000);
        let game = room.game.as_ref().unwrap();

        assert!(seat_view(game, 0).actions.is_some());
        assert!(seat_view(game, 1).actions.is_none());
    }

    #[test]
    fn waiting_action() {
        let mut room = Room::new(config(3), Uuid::new_v4()).unwrap();

        assert_eq!(room.apply(0, Action::Call), Err("game not started"));
        assert_eq!(room.rev, 0);
    }

    #[test]
    fn legal_call() {
        let mut room = started(1000);
        let mut changes = room.notify.subscribe();

        assert_eq!(room.apply(0, Action::Call), Ok(()));

        let game = room.game.as_ref().unwrap();

        assert_eq!(game.players[0].stack, 990);
        assert_eq!(game.players[0].bet, 10);
        assert_eq!(game.pot, 20);
        assert_eq!(game.turn, 1);
        assert_eq!(room.rev, 2);
        assert_eq!(changes.try_recv(), Ok(2));
    }

    #[test]
    fn wrong_turn() {
        let mut room = started(1000);
        let expected = start_game(config(2), SEED);
        let mut changes = room.notify.subscribe();

        assert_eq!(room.apply(1, Action::Check), Err("not your turn"));
        assert_eq!(room.game.as_ref().unwrap(), &expected);
        assert_eq!(room.rev, 1);
        assert_eq!(
            changes.try_recv(),
            Err(broadcast::error::TryRecvError::Empty)
        );
    }

    #[test]
    fn invalid_raise() {
        let mut room = started(1000);
        let expected = start_game(config(2), SEED);

        assert_eq!(room.apply(0, Action::RaiseTo(10)), Err("cannot raise"));
        assert_eq!(room.game.as_ref().unwrap(), &expected);
        assert_eq!(room.rev, 1);
    }

    #[test]
    fn fold_win() {
        let mut room = started(100);

        room.apply(0, Action::Fold).unwrap();

        let game = room.game.as_ref().unwrap();

        assert!(game.settled);
        assert_eq!(game.fold_winner, Some(1));
        assert_eq!(game.pot, 0);
        assert_eq!(game.players[1].stack, 105);
        assert_eq!(room.rev, 2);
    }

    #[test]
    fn terminal_view() {
        let mut room = started(100);

        room.apply(0, Action::Fold).unwrap();

        let view = seat_view(room.game.as_ref().unwrap(), 0);

        assert_eq!(view.turn, None);
        assert_eq!(view.actions, None);
        assert!(view.settled);
    }

    #[test]
    fn street_progress() {
        let mut room = started(1000);

        room.apply(0, Action::Call).unwrap();
        room.apply(1, Action::Check).unwrap();

        let game = room.game.as_ref().unwrap();

        assert_eq!(game.street, Street::Flop);
        assert_eq!(game.board.len(), 3);
        assert!(!game.round_complete);
        assert!(!game.settled);
        assert_eq!(room.rev, 3);
    }

    #[test]
    fn all_in_runout() {
        let mut room = started(100);

        room.apply(0, Action::RaiseTo(100)).unwrap();
        room.apply(1, Action::Call).unwrap();

        let game = room.game.as_ref().unwrap();

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
}
