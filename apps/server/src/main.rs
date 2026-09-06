mod commands;
use commands::*;
mod recovery;
use recovery::*;
mod views;
use views::*;
mod transport;
use transport::*;
mod admission;
mod bot;
mod db;
mod fairness;
mod proof;
mod room;

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
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use challenge_core::{
    FACT_COUNT, Facts, MODE_COMPLETE, MODE_DRAW, POINTS, PROTOCOL_VERSION, catalog_root,
    facts_hash, hand_tag,
};
use game_core::{Action, Card, LegalActions, Rank, State, Street, Suit};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::net::TcpListener;
use tokio::sync::{Mutex, broadcast};
use tower_http::cors::{AllowOrigin, CorsLayer};
use uuid::Uuid;

use crate::db::{
    ChallengeEntropy, ClaimUpdate, Db, DrawUpdate, NewAction, NewChallenge, NewHand, ProofReceipt,
    StoredAction, StoredChallenge, StoredHand, StoredRoom,
};
use crate::proof::{
    ARTIFACT_SHA256, BB_VERSION, CIRCUIT_ID, PROOF_SYSTEM, ProofInputs, ProofVerifier, VK_SHA256,
    decode_bytes, decode_proof,
};
use crate::room::{
    Ceremony, Challenge, Challenges, HandResult, HandResultKind, LiveHand, PendingClaim,
    PendingDraw, PlayedAction, Room, RoomConfig, RoomMode, Seat, TokenHash, bind_facts,
    replay_hand, start_game,
};

type HttpError = (StatusCode, &'static str);
type Rooms = Arc<Mutex<HashMap<Uuid, Arc<Mutex<Room>>>>>;

#[derive(Clone)]
struct AppState {
    admission: Arc<Mutex<admission::Admission>>,
    db: Db,
    rooms: Rooms,
    proof: Option<ProofVerifier>,
}

impl AppState {
    fn new(db: Db, rooms: HashMap<Uuid, Arc<Mutex<Room>>>, proof: ProofVerifier) -> Self {
        Self {
            admission: Arc::new(Mutex::new(admission::Admission::default())),
            db,
            rooms: Arc::new(Mutex::new(rooms)),
            proof: Some(proof),
        }
    }

    #[cfg(test)]
    fn test(db: Db, rooms: HashMap<Uuid, Arc<Mutex<Room>>>) -> Self {
        Self {
            admission: Arc::new(Mutex::new(admission::Admission::default())),
            db,
            rooms: Arc::new(Mutex::new(rooms)),
            proof: None,
        }
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let port: u16 = env::var("PORT")
        .unwrap_or_else(|_| "3001".to_owned())
        .parse()?;
    let origins = web_origins()?;
    let database_url =
        env::var("DATABASE_URL").map_err(|_| io::Error::other("DATABASE_URL missing"))?;
    let bb = env::var("BB_PATH").map_err(|_| io::Error::other("BB_PATH missing"))?;
    let vk = env::var("CHALLENGE_VK_PATH")
        .unwrap_or_else(|_| concat!(env!("CARGO_MANIFEST_DIR"), "/zk/challenge_v2.vk").to_owned());
    let db = Db::connect(&database_url).await?;
    fairness::ensure_pending(&db).await?;
    finish_pending_challenges(&db).await?;
    let proof = ProofVerifier::load(bb, vk)?;
    let rooms = restore_rooms(db.load_rooms().await?)?;
    attach_fairness(&db, &rooms).await?;
    let listener = TcpListener::bind(("0.0.0.0", port)).await?;

    let mut state = AppState::new(db, rooms, proof);
    state.admission = Arc::new(Mutex::new(admission::Admission::load()?));
    axum::serve(listener, app_with_origins(state, origins)).await?;
    Ok(())
}

fn app_with_origins(state: AppState, origins: Vec<HeaderValue>) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/rooms", post(create_room))
        .route("/rooms/{room}/join", post(join_room))
        .route("/rooms/{room}/ws", get(room_ws))
        .route("/proofs/{nullifier}", get(proof_receipt))
        .route("/audits/{room}/{hand_no}", get(deal_audit))
        .with_state(state)
        .layer(
            CorsLayer::new()
                .allow_origin(AllowOrigin::list(origins))
                .allow_methods([Method::GET, Method::POST])
                .allow_headers([CONTENT_TYPE]),
        )
}

fn web_origins() -> Result<Vec<HeaderValue>, Box<dyn std::error::Error + Send + Sync>> {
    let raw = env::var("WEB_ORIGINS")
        .or_else(|_| env::var("WEB_ORIGIN"))
        .unwrap_or_else(|_| "http://localhost:3000".to_owned());
    let origins = raw
        .split(',')
        .map(str::trim)
        .filter(|origin| !origin.is_empty())
        .map(str::parse)
        .collect::<Result<Vec<HeaderValue>, _>>()?;

    if origins.is_empty() {
        return Err(io::Error::other("WEB_ORIGINS empty").into());
    }

    Ok(origins)
}

async fn health() -> &'static str {
    "ok"
}

async fn deal_audit(
    AxumState(state): AxumState<AppState>,
    Path((room, hand_no)): Path<(Uuid, u64)>,
) -> Result<Json<AuditView>, HttpError> {
    let stored = fairness::audit(&state.db, room, hand_no)
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "cannot load deal audit"))?
        .ok_or((StatusCode::NOT_FOUND, "deal audit not found"))?;
    let expected_commitment =
        deal_core::commitment(*room.as_bytes(), hand_no, stored.server_secret);
    let expected_seed = deal_core::seed(
        *room.as_bytes(),
        hand_no,
        stored.server_secret,
        &stored.shares,
    )
    .ok_or((StatusCode::INTERNAL_SERVER_ERROR, "invalid deal audit"))?;
    let (hand, _) = restore_hand(room, stored.config, stored.hand)
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "invalid deal audit"))?;

    if !hand.game.settled {
        return Err((StatusCode::CONFLICT, "hand is still active"));
    }

    if expected_commitment != stored.commitment
        || expected_seed != stored.final_seed
        || expected_seed != hand.seed
    {
        return Err((StatusCode::INTERNAL_SERVER_ERROR, "deal audit mismatch"));
    }

    let deck = game_core::Deck::from_seed(expected_seed)
        .cards()
        .iter()
        .copied()
        .map(card_view)
        .collect();

    Ok(Json(AuditView {
        protocol_version: stored.protocol_version,
        config: stored.config,
        algorithm: "sha256-counter-rejection-fisher-yates-v1",
        room,
        hand_no,
        players: stored.config.players,
        dealer: hand.game.dealer,
        commitment: encode_hex(stored.commitment),
        server_secret: encode_hex(stored.server_secret),
        contributions: stored
            .shares
            .into_iter()
            .enumerate()
            .map(|(seat, share)| AuditEntropyView {
                seat,
                share: encode_hex(share),
            })
            .collect(),
        seed: encode_hex(expected_seed),
        deck,
    }))
}

async fn proof_receipt(
    AxumState(state): AxumState<AppState>,
    Path(nullifier): Path<String>,
) -> Result<Json<ReceiptView>, HttpError> {
    let nullifier =
        decode_hex(&nullifier).ok_or((StatusCode::BAD_REQUEST, "invalid proof nullifier"))?;
    let receipt = state
        .db
        .proof_receipt(&nullifier)
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "cannot load proof"))?
        .ok_or((StatusCode::NOT_FOUND, "proof not found"))?;

    receipt_view(receipt)
        .map(Json)
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "invalid proof receipt"))
}

fn receipt_view(receipt: ProofReceipt) -> Result<ReceiptView, ()> {
    let hand_no = u64::try_from(receipt.hand_no).map_err(|_| ())?;
    let hand_tag = receipt.hand_tag.try_into().map_err(|_| ())?;
    let commitment = receipt.commitment.try_into().map_err(|_| ())?;
    let nonce = receipt.nonce.try_into().map_err(|_| ())?;
    let facts_hash = receipt.facts_hash.try_into().map_err(|_| ())?;
    let nullifier = receipt.nullifier.try_into().map_err(|_| ())?;
    let catalog_root = receipt.catalog_root.try_into().map_err(|_| ())?;
    let seat = usize::try_from(receipt.seat).map_err(|_| ())?;
    let points = u32::try_from(receipt.points).map_err(|_| ())?;

    if seat >= 6 || points != u32::from(POINTS) {
        return Err(());
    }

    Ok(ReceiptView {
        protocol_version: PROTOCOL_VERSION,
        room: receipt.room,
        hand_no,
        proof_system: PROOF_SYSTEM,
        circuit_id: CIRCUIT_ID,
        bb_version: BB_VERSION,
        artifact_sha256: ARTIFACT_SHA256,
        vk_sha256: VK_SHA256,
        hand_tag: encode_hex(hand_tag),
        seat,
        commitment: encode_hex(commitment),
        nonce: encode_hex(nonce),
        facts_hash: encode_hex(facts_hash),
        nullifier: encode_hex(nullifier),
        catalog_root: encode_hex(catalog_root),
        points,
        draw_proof: STANDARD.encode(receipt.draw_proof),
        draw_public_inputs: STANDARD.encode(receipt.draw_public_inputs),
        completion_proof: STANDARD.encode(receipt.completion_proof),
        completion_public_inputs: STANDARD.encode(receipt.completion_public_inputs),
    })
}

async fn create_room(
    AxumState(state): AxumState<AppState>,
    Json(request): Json<CreateRoomRequest>,
) -> Result<(StatusCode, Json<SeatResponse>), HttpError> {
    let config = request.config();
    let mode = request.mode();
    config
        .validate()
        .map_err(|err| (StatusCode::BAD_REQUEST, err))?;
    let mut admission = state.admission.lock().await;
    if mode == RoomMode::Aztec && !admission.experimental_aztec {
        return Err((StatusCode::CONFLICT, "experimental aztec disabled"));
    }
    admission
        .accept(state.rooms.lock().await.len(), std::time::Instant::now())
        .map_err(|err| (StatusCode::TOO_MANY_REQUESTS, err))?;
    let token = Uuid::new_v4();
    let token_hash = hash_token(token);
    let id = Uuid::new_v4();
    let ceremony = fairness::random_ceremony(id, 0, config.players).map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "cannot create deal ceremony",
        )
    })?;
    let room = Room::reserve(config, mode, token_hash, ceremony.clone())
        .map_err(|err| (StatusCode::BAD_REQUEST, err))?;
    fairness::reserve_room(&state.db, id, config, mode, &token_hash, &ceremony)
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
    Json(_request): Json<JoinRequest>,
) -> Result<Json<SeatResponse>, HttpError> {
    let experimental_aztec = state.admission.lock().await.experimental_aztec;
    let room = find_room(&state, id)
        .await
        .ok_or((StatusCode::NOT_FOUND, "room not found"))?;
    let mut room = room.lock().await;
    if room.mode == RoomMode::Single {
        return Err((StatusCode::CONFLICT, "single room full"));
    }
    if room.mode == RoomMode::Aztec && !experimental_aztec {
        return Err((StatusCode::CONFLICT, "experimental aztec disabled"));
    }
    let (token, token_hash) = room_token(&room);
    let seat = room
        .next_seat()
        .map_err(|_| (StatusCode::CONFLICT, "room full"))?;
    let next_rev = room
        .rev
        .checked_add(1)
        .ok_or((StatusCode::CONFLICT, "revision limit reached"))?;
    fairness::reserve_seat(&state.db, id, seat, &token_hash, room.rev, next_rev)
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "cannot reserve seat"))?;
    room.seats.push(Seat {
        token_hash,
        ready_hand: None,
        proof_points: 0,
    });
    room.changed(next_rev);

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
    ws.max_frame_size(131_072)
        .max_message_size(131_072)
        .on_upgrade(move |socket| socket_loop(socket, state, id))
}

async fn socket_loop(mut socket: WebSocket, state: AppState, id: Uuid) {
    let token =
        match tokio::time::timeout(std::time::Duration::from_secs(10), auth_token(&mut socket))
            .await
            .unwrap_or(Err("authentication deadline exceeded"))
        {
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
                Some(seat) => Ok((seat, room.notify.subscribe(), room_message(id, &room, seat))),
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
                    ClientMessage::Fold { hand_no, rev, request_id } =>
                        betting_command(&state, id, seat, Action::Fold, hand_no, rev, request_id).await,
                    ClientMessage::Check { hand_no, rev, request_id } =>
                        betting_command(&state, id, seat, Action::Check, hand_no, rev, request_id).await,
                    ClientMessage::Call { hand_no, rev, request_id } =>
                        betting_command(&state, id, seat, Action::Call, hand_no, rev, request_id).await,
                    ClientMessage::RaiseTo { to, hand_no, rev, request_id } =>
                        betting_command(&state, id, seat, Action::RaiseTo(to), hand_no, rev, request_id).await,
                    ClientMessage::ChallengeCommit {
                        hand_no,
                        commitment,
                    } => {
                        challenge_room(&state, id, seat, hand_no, &commitment).await
                    }
                    ClientMessage::ChallengeDraw {
                        hand_no,
                        proof,
                        public_inputs,
                    } => {
                        draw_room(&state, id, seat, hand_no, &proof, &public_inputs).await
                    }
                    ClientMessage::ChallengeClaim {
                        hand_no,
                        proof,
                        public_inputs,
                    } => {
                        claim_room(&state, id, seat, hand_no, &proof, &public_inputs).await
                    }
                    ClientMessage::Ready { hand_no, commitment, entropy } =>
                        ready_bound(&state, id, seat, hand_no, &commitment, &entropy).await,
                    ClientMessage::DealEntropy { hand_no, commitment, entropy } =>
                        initial_entropy(&state, id, seat, hand_no, &commitment, &entropy).await,
                    ClientMessage::Auth { .. } => {
                        send_error(&mut socket, "already authenticated").await;
                        continue;
                    }
                };

                if let Err(err) = result {
                    send_error(&mut socket, err).await;
                }
                if let Some(message) = current_message(&state, id, seat).await
                    && !send_message(&mut socket, &message).await { return; }
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

async fn send_message(socket: &mut WebSocket, message: &ServerMessage) -> bool {
    let Ok(text) = serde_json::to_string(message) else {
        return false;
    };

    socket.send(Message::Text(text.into())).await.is_ok()
}

async fn send_error(socket: &mut WebSocket, message: &'static str) {
    let code = match message {
        "unknown token"
        | "authentication required"
        | "authentication failed"
        | "invalid authentication"
        | "authentication deadline exceeded"
        | "room not found" => "auth",
        "proof verifier busy" => "busy",
        _ => "command",
    };
    let _ = send_message(socket, &ServerMessage::Error { code, message }).await;
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
fn secure_nonce() -> Result<[u8; 32], getrandom::Error> {
    let mut nonce = [0u8; 32];

    getrandom::fill(&mut nonce)?;
    Ok(nonce)
}

fn encode_hex(bytes: [u8; 32]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut value = String::with_capacity(64);

    for byte in bytes {
        value.push(char::from(HEX[usize::from(byte >> 4)]));
        value.push(char::from(HEX[usize::from(byte & 15)]));
    }

    value
}

fn decode_hex(value: &str) -> Option<[u8; 32]> {
    if value.len() != 64 {
        return None;
    }

    let mut bytes = [0u8; 32];

    for (i, byte) in bytes.iter_mut().enumerate() {
        let high = hex_nibble(value.as_bytes()[i * 2])?;
        let low = hex_nibble(value.as_bytes()[i * 2 + 1])?;

        *byte = high << 4 | low;
    }

    Some(bytes)
}

const fn hex_nibble(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        _ => None,
    }
}

#[cfg(test)]
mod tests;
