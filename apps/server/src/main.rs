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
    Ceremony, Challenge, Challenges, HandResult, HandResultKind, JoinError, LiveHand, PendingClaim,
    PendingDraw, PlayedAction, Room, RoomConfig, Seat, TokenHash, bind_facts, replay_hand,
    start_game,
};

type HttpError = (StatusCode, &'static str);
type Rooms = Arc<Mutex<HashMap<Uuid, Arc<Mutex<Room>>>>>;

#[derive(Clone)]
struct AppState {
    db: Db,
    rooms: Rooms,
    proof: Option<ProofVerifier>,
}

impl AppState {
    fn new(db: Db, rooms: HashMap<Uuid, Arc<Mutex<Room>>>, proof: ProofVerifier) -> Self {
        Self {
            db,
            rooms: Arc::new(Mutex::new(rooms)),
            proof: Some(proof),
        }
    }

    #[cfg(test)]
    fn test(db: Db, rooms: HashMap<Uuid, Arc<Mutex<Room>>>) -> Self {
        Self {
            db,
            rooms: Arc::new(Mutex::new(rooms)),
            proof: None,
        }
    }
}

#[derive(Serialize)]
struct SeatResponse {
    room: Uuid,
    seat: usize,
    token: Uuid,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CreateRoomRequest {
    players: usize,
    stack: u32,
    small_blind: u32,
    big_blind: u32,
    entropy: String,
}

impl CreateRoomRequest {
    const fn config(&self) -> RoomConfig {
        RoomConfig {
            players: self.players,
            stack: self.stack,
            small_blind: self.small_blind,
            big_blind: self.big_blind,
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct EntropyRequest {
    entropy: String,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
#[serde(deny_unknown_fields)]
enum ClientMessage {
    Auth {
        token: Uuid,
    },
    Fold,
    Check,
    Call,
    RaiseTo {
        to: u32,
    },
    ChallengeCommit {
        hand_no: u64,
        commitment: String,
    },
    ChallengeDraw {
        hand_no: u64,
        proof: String,
        public_inputs: String,
    },
    ChallengeClaim {
        hand_no: u64,
        proof: String,
        public_inputs: String,
    },
    Ready {
        entropy: Option<String>,
    },
}

#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ServerMessage {
    Waiting {
        joined: usize,
        players: usize,
    },
    WaitingFair {
        joined: usize,
        players: usize,
        deal: DealView,
    },
    Snapshot {
        rev: u64,
        view: Box<SeatView>,
    },
    Error {
        message: &'static str,
    },
}

#[derive(Debug, Eq, PartialEq, Serialize)]
struct SeatView {
    players: Vec<PlayerView>,
    hand_no: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    deal: Option<DealView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    next_deal: Option<DealView>,
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
    result: Option<HandResultView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    ready: Option<ReadyView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    challenge: Option<ChallengeView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    claim: Option<ClaimView>,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
struct DealView {
    hand_no: u64,
    commitment: String,
    contributors: usize,
    required: usize,
    mine: bool,
    state: &'static str,
    audit: bool,
}

#[derive(Serialize)]
struct AuditEntropyView {
    seat: usize,
    share: String,
}

#[derive(Serialize)]
struct AuditView {
    protocol_version: u8,
    algorithm: &'static str,
    room: Uuid,
    hand_no: u64,
    players: usize,
    dealer: usize,
    commitment: String,
    server_secret: String,
    contributions: Vec<AuditEntropyView>,
    seed: String,
    deck: Vec<CardView>,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
struct HandResultView {
    kind: &'static str,
    awards: Vec<AwardView>,
    revealed: Vec<Option<[CardView; 2]>>,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
struct AwardView {
    player: usize,
    amount: u32,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
struct ChallengeView {
    hand_no: u64,
    assigned: bool,
    draw_verified: bool,
    hand_tag: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    commitment: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    nonce: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    catalog_root: Option<String>,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
struct ClaimView {
    hand_no: u64,
    hand_tag: String,
    commitment: String,
    nonce: String,
    catalog_root: String,
    facts_salt: String,
    facts_hash: String,
    facts: [u8; FACT_COUNT],
    status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    points: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    nullifier: Option<String>,
}

#[derive(Serialize)]
struct ReceiptView {
    protocol_version: u8,
    room: Uuid,
    hand_no: u64,
    proof_system: &'static str,
    circuit_id: &'static str,
    bb_version: &'static str,
    artifact_sha256: &'static str,
    vk_sha256: &'static str,
    hand_tag: String,
    seat: usize,
    commitment: String,
    nonce: String,
    facts_hash: String,
    nullifier: String,
    catalog_root: String,
    points: u32,
    draw_proof: String,
    draw_public_inputs: String,
    completion_proof: String,
    completion_public_inputs: String,
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
    proof_points: u64,
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

    axum::serve(
        listener,
        app_with_origins(AppState::new(db, rooms, proof), origins),
    )
    .await?;
    Ok(())
}

#[cfg(test)]
fn app(state: AppState, origin: HeaderValue) -> Router {
    app_with_origins(state, vec![origin])
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
        protocol_version: deal_core::PROTOCOL_VERSION,
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
    config
        .validate()
        .map_err(|err| (StatusCode::BAD_REQUEST, err))?;
    let share =
        decode_hex(&request.entropy).ok_or((StatusCode::BAD_REQUEST, "invalid deal entropy"))?;
    let token = Uuid::new_v4();
    let token_hash = hash_token(token);
    let id = Uuid::new_v4();
    let ceremony = fairness::random_ceremony(id, 0, config.players).map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "cannot create deal ceremony",
        )
    })?;
    let room = Room::new_fair(config, token_hash, ceremony.clone(), share)
        .map_err(|err| (StatusCode::BAD_REQUEST, err))?;

    fairness::create_room(&state.db, id, config, &token_hash, &ceremony, share)
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
    Json(request): Json<EntropyRequest>,
) -> Result<Json<SeatResponse>, HttpError> {
    let share =
        decode_hex(&request.entropy).ok_or((StatusCode::BAD_REQUEST, "invalid deal entropy"))?;
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
        Some(
            room.ceremony
                .as_ref()
                .ok_or((StatusCode::INTERNAL_SERVER_ERROR, "deal ceremony missing"))?
                .seed_with(id, seat, share)
                .map_err(|err| (StatusCode::BAD_REQUEST, err))?,
        )
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
        seed,
        starting_stacks: stacks.clone().expect("starting stacks"),
        game: start_game(room.config, seed),
        result: None,
        next_seq: 0,
        actions: Vec::new(),
    });
    let next = if final_join {
        Some(
            fairness::random_ceremony(id, 1, room.config.players).map_err(|_| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "cannot create deal ceremony",
                )
            })?,
        )
    } else {
        None
    };
    let ceremony = room
        .ceremony
        .as_ref()
        .ok_or((StatusCode::INTERNAL_SERVER_ERROR, "deal ceremony missing"))?;

    fairness::join_room(
        &state.db,
        id,
        seat,
        &token_hash,
        share,
        room.rev,
        next_rev,
        ceremony,
        hand,
        next.as_ref(),
    )
    .await
    .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "cannot join room"))?;
    room.commit_fair_join(token_hash, seat, share, game, next, next_rev);

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
                    ClientMessage::Fold => apply_action(&state, id, seat, Action::Fold).await,
                    ClientMessage::Check => apply_action(&state, id, seat, Action::Check).await,
                    ClientMessage::Call => apply_action(&state, id, seat, Action::Call).await,
                    ClientMessage::RaiseTo { to } => {
                        apply_action(&state, id, seat, Action::RaiseTo(to)).await
                    }
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
                    ClientMessage::Ready { entropy } => match entropy {
                        Some(entropy) => ready_room_entropy(&state, id, seat, &entropy).await,
                        None => Err("deal entropy required"),
                    },
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
    let mut next = room.stage_action(seat, action)?;

    if next.facts.is_some() {
        let salts = (0..room.config.players)
            .map(|_| secure_nonce().map_err(|_| "cannot commit challenge facts"))
            .collect::<Result<Vec<_>, _>>()?;

        bind_facts(&mut next, &room.current_challenges, salts)?;
    }

    // command commit before state swap
    state
        .db
        .append_action(NewAction {
            room: id,
            hand: next.hand,
            hand_no: room.hand.as_ref().expect("staged hand").no,
            seq: next.seq,
            player: next.player,
            action: next.action,
            facts: next.fact_commitments.as_deref(),
            rev: room.rev,
            next_rev: next.rev,
        })
        .await
        .map_err(|_| "cannot persist action")?;
    room.commit_action(next);
    Ok(())
}

async fn challenge_room(
    state: &AppState,
    id: Uuid,
    seat: usize,
    hand_no: u64,
    commitment: &str,
) -> Result<(), &'static str> {
    let commitment = decode_hex(commitment).ok_or("invalid challenge commitment")?;
    let room = find_room(state, id).await.ok_or("room not found")?;
    let mut room = room.lock().await;
    let pending = room.stage_challenge(id, seat, hand_no, commitment)?;

    state
        .db
        .commit_challenge(NewChallenge {
            room: id,
            hand_no: pending.hand_no,
            seat: pending.seat,
            hand_tag: pending.hand_tag,
            commitment: pending.commitment,
        })
        .await
        .map_err(|_| "cannot persist challenge commitment")?;

    // nonce after durable commitment
    let nonce = secure_nonce().map_err(|_| "cannot assign challenge")?;
    let root = catalog_root();
    let challenge = Challenge {
        hand_no: pending.hand_no,
        seat: pending.seat,
        hand_tag: pending.hand_tag,
        commitment: pending.commitment,
        nonce,
        catalog_root: root,
        draw_verified: false,
        facts_salt: None,
        facts_hash: None,
        facts: None,
        nullifier: None,
        points: None,
    };

    state
        .db
        .assign_challenge(ChallengeEntropy {
            room: id,
            hand_no: pending.hand_no,
            seat: pending.seat,
            hand_tag: pending.hand_tag,
            commitment: pending.commitment,
            nonce,
            catalog_root: root,
            rev: room.rev,
            next_rev: pending.rev,
        })
        .await
        .map_err(|_| "cannot persist challenge")?;
    room.commit_challenge(challenge, pending.rev);
    Ok(())
}

async fn claim_room(
    state: &AppState,
    id: Uuid,
    seat: usize,
    hand_no: u64,
    proof: &str,
    public_inputs: &str,
) -> Result<(), &'static str> {
    let proof = decode_proof(proof, public_inputs)?;
    let inputs = proof.inputs;
    let room = find_room(state, id).await.ok_or("room not found")?;

    {
        let room = room.lock().await;
        let pending = room.stage_claim(seat, hand_no)?;

        if !claim_matches(inputs, pending) {
            return Err("challenge proof mismatch");
        }
    }

    let verifier = state.proof.as_ref().ok_or("proof verifier unavailable")?;
    let verified = match verifier.verify(&proof).await {
        Ok(verified) => verified,
        Err(err) => {
            eprintln!("challenge verify error: {err:?}");
            return Err("cannot verify challenge");
        }
    };

    if !verified {
        return Err("challenge proof failed");
    }

    let mut room = room.lock().await;
    let pending = room.stage_claim(seat, hand_no)?;

    if !claim_matches(inputs, pending) {
        return Err("challenge proof mismatch");
    }

    state
        .db
        .claim(ClaimUpdate {
            room: id,
            hand_no: pending.hand_no,
            seat: pending.seat,
            hand_tag: pending.hand_tag,
            commitment: pending.commitment,
            nonce: pending.nonce,
            catalog_root: pending.catalog_root,
            facts_salt: pending.facts_salt,
            facts_hash: pending.facts_hash,
            nullifier: inputs.nullifier,
            proof: proof.proof_bytes,
            public_inputs: proof.public_input_bytes,
            points: pending.points,
            prior_points: pending.prior_points,
            next_points: pending.next_points,
            rev: room.rev,
            next_rev: pending.rev,
        })
        .await
        .map_err(|_| "cannot persist challenge claim")?;
    room.commit_claim(pending, inputs.nullifier);
    Ok(())
}

async fn draw_room(
    state: &AppState,
    id: Uuid,
    seat: usize,
    hand_no: u64,
    proof: &str,
    public_inputs: &str,
) -> Result<(), &'static str> {
    let proof = decode_proof(proof, public_inputs)?;
    let inputs = proof.inputs;
    let room = find_room(state, id).await.ok_or("room not found")?;

    {
        let room = room.lock().await;
        let pending = room.stage_draw(seat, hand_no)?;

        if !draw_matches(inputs, pending) {
            return Err("draw proof mismatch");
        }
    }

    let verifier = state.proof.as_ref().ok_or("proof verifier unavailable")?;
    let verified = match verifier.verify(&proof).await {
        Ok(verified) => verified,
        Err(err) => {
            eprintln!("challenge verify error: {err:?}");
            return Err("cannot verify challenge");
        }
    };

    if !verified {
        return Err("draw proof failed");
    }

    let mut room = room.lock().await;
    let pending = room.stage_draw(seat, hand_no)?;

    if !draw_matches(inputs, pending) {
        return Err("draw proof mismatch");
    }

    state
        .db
        .draw(DrawUpdate {
            room: id,
            hand_no: pending.hand_no,
            seat: pending.seat,
            hand_tag: pending.hand_tag,
            commitment: pending.commitment,
            nonce: pending.nonce,
            catalog_root: pending.catalog_root,
            proof: proof.proof_bytes,
            public_inputs: proof.public_input_bytes,
            rev: room.rev,
            next_rev: pending.rev,
        })
        .await
        .map_err(|_| "cannot persist draw proof")?;
    room.commit_draw(pending);
    Ok(())
}

fn draw_matches(inputs: ProofInputs, draw: PendingDraw) -> bool {
    inputs.mode == MODE_DRAW
        && usize::from(inputs.seat) == draw.seat
        && inputs.hand_tag == draw.hand_tag
        && inputs.commitment == draw.commitment
        && inputs.nonce == draw.nonce
        && inputs.catalog_root == draw.catalog_root
        && inputs.facts_hash == [0; 32]
        && inputs.nullifier == [0; 32]
}

fn claim_matches(inputs: ProofInputs, claim: PendingClaim) -> bool {
    inputs.mode == MODE_COMPLETE
        && usize::from(inputs.seat) == claim.seat
        && inputs.hand_tag == claim.hand_tag
        && inputs.commitment == claim.commitment
        && inputs.nonce == claim.nonce
        && inputs.catalog_root == claim.catalog_root
        && inputs.facts_hash == claim.facts_hash
        && inputs.nullifier != [0; 32]
}

#[cfg(test)]
async fn ready_room(state: &AppState, id: Uuid, seat: usize) -> Result<(), &'static str> {
    let share = secure_nonce().map_err(|_| "cannot create deal entropy")?;
    ready_room_entropy(state, id, seat, &encode_hex(share)).await
}

async fn ready_room_entropy(
    state: &AppState,
    id: Uuid,
    seat: usize,
    entropy: &str,
) -> Result<(), &'static str> {
    let share = decode_hex(entropy).ok_or("invalid deal entropy")?;
    let room = find_room(state, id).await.ok_or("room not found")?;
    let mut room = room.lock().await;
    let pending = room.stage_fair_ready(seat, share)?;
    let seed = if pending.all {
        Some(
            room.ceremony
                .as_ref()
                .ok_or("deal ceremony missing")?
                .seed_with(id, seat, share)?,
        )
    } else {
        None
    };
    let next_hand = match seed {
        Some(seed) => room.stage_next_hand(seed)?,
        None => None,
    };
    let new_hand = next_hand.as_ref().map(|hand| NewHand {
        id: hand.id,
        no: hand.no,
        seed: &hand.seed,
        dealer: hand.game.dealer,
        stacks: &hand.starting_stacks,
    });
    let next = match next_hand.as_ref() {
        Some(hand) => Some(
            fairness::random_ceremony(
                id,
                hand.no.checked_add(1).ok_or("hand limit reached")?,
                room.config.players,
            )
            .map_err(|_| "cannot create deal ceremony")?,
        ),
        None => None,
    };
    let ceremony = room.ceremony.as_ref().ok_or("deal ceremony missing")?;

    fairness::ready(
        &state.db,
        id,
        pending.hand,
        seat,
        share,
        room.rev,
        pending.rev,
        ceremony,
        new_hand,
        next.as_ref(),
    )
    .await
    .map_err(|_| "cannot persist deal contribution")?;
    room.commit_fair_ready(seat, pending, next_hand, next);
    Ok(())
}

async fn current_message(state: &AppState, id: Uuid, seat: usize) -> Option<ServerMessage> {
    let room = find_room(state, id).await?;
    let room = room.lock().await;

    Some(room_message(id, &room, seat))
}

fn room_message(id: Uuid, room: &Room, seat: usize) -> ServerMessage {
    match &room.hand {
        Some(hand) => ServerMessage::Snapshot {
            rev: room.rev,
            view: Box::new(room_view(id, room, hand, seat)),
        },
        None => match room.ceremony.as_ref() {
            Some(ceremony) => ServerMessage::WaitingFair {
                joined: room.seats.len(),
                players: room.config.players,
                deal: pending_deal_view(ceremony, seat, room.config.players),
            },
            None => ServerMessage::Waiting {
                joined: room.seats.len(),
                players: room.config.players,
            },
        },
    }
}

fn room_view(id: Uuid, room: &Room, hand: &LiveHand, seat: usize) -> SeatView {
    let mut view = seat_view(&hand.game, seat);

    view.hand_no = hand.no;
    view.deal = room.current_commitment.map(|commitment| DealView {
        hand_no: hand.no,
        commitment: encode_hex(commitment),
        contributors: room.config.players,
        required: room.config.players,
        mine: true,
        state: if hand.game.settled {
            "revealed"
        } else {
            "sealed"
        },
        audit: hand.game.settled,
    });

    for (player, stored) in view.players.iter_mut().zip(&room.seats) {
        player.proof_points = stored.proof_points;
    }

    if hand.game.settled {
        view.result = Some(result_view(
            &hand.game,
            hand.result.as_ref().expect("settled result"),
        ));
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

        let next_no = hand.no.checked_add(1).expect("valid hand number");
        view.next_deal = room
            .ceremony
            .as_ref()
            .map(|ceremony| pending_deal_view(ceremony, seat, room.config.players));
        view.challenge = Some(challenge_view(
            next_no,
            hand_tag(*id.as_bytes(), next_no),
            room.next_challenges[seat].as_ref(),
        ));

        if let Some(challenge) = room.current_challenges[seat].as_ref() {
            view.claim = challenge
                .facts
                .zip(challenge.facts_salt)
                .zip(challenge.facts_hash)
                .map(|((facts, salt), hash)| ClaimView {
                    hand_no: challenge.hand_no,
                    hand_tag: encode_hex(challenge.hand_tag),
                    commitment: encode_hex(challenge.commitment),
                    nonce: encode_hex(challenge.nonce),
                    catalog_root: encode_hex(challenge.catalog_root),
                    facts_salt: encode_hex(salt),
                    facts_hash: encode_hex(hash),
                    facts: facts.bytes(),
                    status: if challenge.nullifier.is_some() {
                        "claimed"
                    } else {
                        "claimable"
                    },
                    points: challenge.points,
                    nullifier: challenge.nullifier.map(encode_hex),
                });
        }
    } else if let Some(challenge) = room.current_challenges[seat].as_ref() {
        view.challenge = Some(challenge_view(
            challenge.hand_no,
            challenge.hand_tag,
            Some(challenge),
        ));
    }

    view
}

fn pending_deal_view(ceremony: &Ceremony, seat: usize, players: usize) -> DealView {
    DealView {
        hand_no: ceremony.hand_no,
        commitment: encode_hex(ceremony.commitment),
        contributors: ceremony.contributors(),
        required: players,
        mine: ceremony
            .shares
            .get(seat)
            .is_some_and(|share| share.is_some()),
        state: "collecting",
        audit: false,
    }
}

fn challenge_view(
    hand_no: u64,
    hand_tag: [u8; 32],
    challenge: Option<&Challenge>,
) -> ChallengeView {
    ChallengeView {
        hand_no,
        assigned: challenge.is_some(),
        draw_verified: challenge.is_some_and(|challenge| challenge.draw_verified),
        hand_tag: encode_hex(hand_tag),
        commitment: challenge.map(|challenge| encode_hex(challenge.commitment)),
        nonce: challenge.map(|challenge| encode_hex(challenge.nonce)),
        catalog_root: challenge.map(|challenge| encode_hex(challenge.catalog_root)),
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

async fn finish_pending_challenges(
    db: &Db,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    while let Some(pending) = db.pending_challenge().await? {
        let nonce = secure_nonce()?;
        let next_rev = pending
            .rev
            .checked_add(1)
            .ok_or_else(|| io::Error::other("revision limit reached"))?;

        db.assign_challenge(ChallengeEntropy {
            room: pending.room,
            hand_no: pending.hand_no,
            seat: pending.seat,
            hand_tag: pending.hand_tag,
            commitment: pending.commitment,
            nonce,
            catalog_root: catalog_root(),
            rev: pending.rev,
            next_rev,
        })
        .await?;
    }

    Ok(())
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

async fn attach_fairness(
    db: &Db,
    rooms: &HashMap<Uuid, Arc<Mutex<Room>>>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let entries: Vec<_> = rooms
        .iter()
        .map(|(id, room)| (*id, Arc::clone(room)))
        .collect();

    for (id, room) in entries {
        let players = room.lock().await.config.players;
        let pending = fairness::load_pending(db, id, players).await?;
        let current = fairness::current_commitment(db, id).await?;
        let mut room = room.lock().await;

        room.ceremony = pending;
        room.current_commitment = current;
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
            proof_points: u64::try_from(seat.proof_points)
                .map_err(|_| recovery_error(id, "invalid proof points"))?,
        });
    }

    let (hand, facts) = match stored.hand {
        Some(hand) if seats.len() == config.players => {
            let (hand, facts) = restore_hand(id, config, hand)?;

            (Some(hand), facts)
        }
        Some(_) => return Err(recovery_error(id, "hand before room full")),
        None if seats.len() == config.players => {
            return Err(recovery_error(id, "full room without hand"));
        }
        None => (None, None),
    };
    let (current_challenges, next_challenges, proof_points) = match &hand {
        Some(hand) => restore_challenges(
            id,
            hand,
            facts.as_deref(),
            stored.challenges,
            config.players,
        )?,
        None if stored.challenges.is_empty() => (
            vec![None; config.players],
            vec![None; config.players],
            vec![0; config.players],
        ),
        None => return Err(recovery_error(id, "challenge without hand")),
    };

    if seats
        .iter()
        .zip(proof_points)
        .any(|(seat, points)| seat.proof_points != points)
    {
        return Err(recovery_error(id, "proof points mismatch"));
    }
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
        .and_then(|rev| {
            rev.checked_add(
                u64::try_from(
                    current_challenges.iter().flatten().count()
                        + next_challenges.iter().flatten().count(),
                )
                .ok()?,
            )
        })
        .and_then(|rev| {
            rev.checked_add(
                u64::try_from(
                    current_challenges
                        .iter()
                        .chain(&next_challenges)
                        .flatten()
                        .filter(|challenge| challenge.draw_verified)
                        .count(),
                )
                .ok()?,
            )
        })
        .and_then(|rev| {
            rev.checked_add(
                u64::try_from(
                    current_challenges
                        .iter()
                        .chain(&next_challenges)
                        .flatten()
                        .filter(|challenge| challenge.nullifier.is_some())
                        .count(),
                )
                .ok()?,
            )
        })
        .ok_or_else(|| recovery_error(id, "revision limit reached"))?;

    if rev < min_rev {
        return Err(recovery_error(id, "revision behind room state"));
    }

    let (notify, _) = broadcast::channel(16);

    Ok(Room {
        config,
        seats,
        hand,
        current_commitment: None,
        ceremony: None,
        current_challenges,
        next_challenges,
        rev,
        notify,
    })
}

fn restore_hand(
    id: Uuid,
    config: RoomConfig,
    stored: StoredHand,
) -> Result<(LiveHand, Option<Vec<Facts>>), io::Error> {
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

    let next_seq = u64::try_from(stored.actions.len())
        .map_err(|_| recovery_error(id, "action limit reached"))?;
    let mut actions = Vec::with_capacity(stored.actions.len());

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

        actions.push(PlayedAction { player, action });
    }

    let (game, result, facts) = replay_hand(config, seed, dealer, &stacks, &actions)
        .map_err(|_| recovery_error(id, "action replay failed"))?;
    let facts = game.settled.then_some(facts);

    Ok((
        LiveHand {
            id: stored.id,
            no,
            seed,
            starting_stacks: stacks.clone(),
            game,
            result,
            next_seq,
            actions,
        },
        facts,
    ))
}

fn restore_challenges(
    id: Uuid,
    hand: &LiveHand,
    facts: Option<&[Facts]>,
    stored: Vec<StoredChallenge>,
    players: usize,
) -> Result<(Challenges, Challenges, Vec<u64>), io::Error> {
    let mut current = vec![None; players];
    let mut next = vec![None; players];
    let mut proof_points = vec![0u64; players];
    let next_no = hand
        .no
        .checked_add(1)
        .ok_or_else(|| recovery_error(id, "hand limit reached"))?;

    for stored in stored {
        let no = u64::try_from(stored.hand_no)
            .map_err(|_| recovery_error(id, "invalid challenge hand"))?;

        if no > next_no {
            return Err(recovery_error(id, "future challenge hand"));
        }

        let seat = usize::try_from(stored.seat)
            .map_err(|_| recovery_error(id, "invalid challenge seat"))?;

        if seat >= players || stored.version != i32::from(PROTOCOL_VERSION) {
            return Err(recovery_error(id, "invalid challenge assignment"));
        }

        let tag: [u8; 32] = stored
            .hand_tag
            .try_into()
            .map_err(|_| recovery_error(id, "invalid challenge hand tag"))?;
        let commitment = stored
            .commitment
            .try_into()
            .map_err(|_| recovery_error(id, "invalid challenge commitment"))?;
        let nonce = stored
            .nonce
            .try_into()
            .map_err(|_| recovery_error(id, "invalid challenge nonce"))?;
        let root = stored
            .catalog_root
            .try_into()
            .map_err(|_| recovery_error(id, "invalid challenge catalog root"))?;
        let salt = stored
            .facts_salt
            .as_deref()
            .map(|salt| {
                salt.try_into()
                    .map_err(|_| recovery_error(id, "invalid challenge facts salt"))
            })
            .transpose()?;
        let stored_hash = stored
            .facts_hash
            .as_deref()
            .map(|hash| {
                hash.try_into()
                    .map_err(|_| recovery_error(id, "invalid challenge facts hash"))
            })
            .transpose()?;

        if tag != hand_tag(*id.as_bytes(), no) || root != catalog_root() {
            return Err(recovery_error(id, "challenge hand tag mismatch"));
        }

        let draw = match (
            &stored.draw_proof,
            &stored.draw_public_inputs,
            stored.draw_verified,
        ) {
            (Some(proof), Some(public), true) => {
                let proof = decode_bytes(proof.clone(), public.clone())
                    .map_err(|_| recovery_error(id, "invalid draw proof"))?;
                let inputs = proof.inputs;

                if inputs.mode != MODE_DRAW
                    || usize::from(inputs.seat) != seat
                    || inputs.hand_tag != tag
                    || inputs.commitment != commitment
                    || inputs.nonce != nonce
                    || inputs.catalog_root != root
                    || inputs.facts_hash != [0; 32]
                    || inputs.nullifier != [0; 32]
                {
                    return Err(recovery_error(id, "draw proof mismatch"));
                }

                true
            }
            (None, None, false) => false,
            _ => return Err(recovery_error(id, "invalid draw proof")),
        };

        if salt.is_some() != stored_hash.is_some() {
            return Err(recovery_error(id, "invalid challenge facts"));
        }

        let mut challenge = Challenge {
            hand_no: no,
            seat,
            hand_tag: tag,
            commitment,
            nonce,
            catalog_root: root,
            draw_verified: draw,
            facts_salt: salt,
            facts_hash: stored_hash,
            facts: None,
            nullifier: None,
            points: None,
        };

        match (
            &stored.nullifier,
            stored.points,
            &stored.completion_proof,
            &stored.completion_public_inputs,
            stored.claimed,
        ) {
            (Some(nullifier), Some(points), Some(proof), Some(public), true) => {
                let nullifier: [u8; 32] = nullifier
                    .as_slice()
                    .try_into()
                    .map_err(|_| recovery_error(id, "invalid challenge nullifier"))?;
                let points = u32::try_from(points)
                    .map_err(|_| recovery_error(id, "invalid challenge points"))?;
                let proof = decode_bytes(proof.clone(), public.clone())
                    .map_err(|_| recovery_error(id, "invalid completion proof"))?;
                let inputs = proof.inputs;

                if !draw
                    || points != u32::from(POINTS)
                    || inputs.mode != MODE_COMPLETE
                    || usize::from(inputs.seat) != seat
                    || inputs.hand_tag != tag
                    || inputs.commitment != commitment
                    || inputs.nonce != nonce
                    || inputs.catalog_root != root
                    || Some(inputs.facts_hash) != stored_hash
                    || inputs.nullifier != nullifier
                {
                    return Err(recovery_error(id, "completion proof mismatch"));
                }

                challenge.nullifier = Some(nullifier);
                challenge.points = Some(points);
                proof_points[seat] = proof_points[seat]
                    .checked_add(u64::from(points))
                    .ok_or_else(|| recovery_error(id, "proof points limit reached"))?;
            }
            (None, None, None, None, false) => {}
            _ => return Err(recovery_error(id, "invalid challenge claim")),
        }

        if no < hand.no {
            if !draw || salt.is_none() || stored_hash.is_none() {
                return Err(recovery_error(id, "invalid historical challenge"));
            }

            continue;
        }

        if no == hand.no {
            if hand.no == 0 || !draw || current[seat].is_some() {
                return Err(recovery_error(id, "invalid current challenge"));
            }

            match (hand.game.settled, facts, salt, stored_hash) {
                (true, Some(facts), Some(salt), Some(stored_hash)) => {
                    let expected = facts_hash(tag, seat as u8, salt, facts[seat]);

                    if stored_hash != expected {
                        return Err(recovery_error(id, "challenge facts hash mismatch"));
                    }

                    challenge.facts = Some(facts[seat]);
                }
                (false, _, None, None) if challenge.nullifier.is_none() => {}
                _ => return Err(recovery_error(id, "invalid challenge facts")),
            }

            current[seat] = Some(challenge);
        } else {
            if !hand.game.settled
                || salt.is_some()
                || stored_hash.is_some()
                || challenge.nullifier.is_some()
                || next[seat].is_some()
            {
                return Err(recovery_error(id, "invalid next challenge"));
            }

            next[seat] = Some(challenge);
        }
    }

    if hand.no > 0 && current.iter().any(Option::is_none) {
        return Err(recovery_error(id, "current challenge missing"));
    }

    Ok((current, next, proof_points))
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

fn result_view(game: &State, result: &HandResult) -> HandResultView {
    let revealed = game
        .players
        .iter()
        .enumerate()
        .map(|(seat, player)| match result.kind {
            HandResultKind::Showdown if !player.folded => Some(game.hole[seat].map(card_view)),
            HandResultKind::Fold | HandResultKind::Showdown => None,
        })
        .collect();

    HandResultView {
        kind: match result.kind {
            HandResultKind::Fold => "fold",
            HandResultKind::Showdown => "showdown",
        },
        awards: result
            .awards
            .iter()
            .map(|award| AwardView {
                player: award.player,
                amount: award.amount,
            })
            .collect(),
        revealed,
    }
}

fn seat_view(game: &State, seat: usize) -> SeatView {
    let players = game
        .players
        .iter()
        .map(|player| PlayerView {
            stack: player.stack,
            bet: player.bet,
            folded: player.folded,
            proof_points: 0,
        })
        .collect();
    let turn =
        (!game.round_complete && game.fold_winner.is_none() && !game.settled).then_some(game.turn);

    SeatView {
        players,
        hand_no: 0,
        deal: None,
        next_deal: None,
        hole: game.hole[seat].map(card_view),
        board: game.board.iter().copied().map(card_view).collect(),
        pot: game.pot,
        dealer: game.dealer,
        turn,
        street: street_view(game.street),
        round_complete: game.round_complete,
        settled: game.settled,
        actions: game.legal_actions(seat).map(action_view),
        result: None,
        ready: None,
        challenge: None,
        claim: None,
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

#[cfg(test)]
mod tests {
    use crate::db::StoredSeat;
    use game_core::NextHandError;
    use sqlx::Row;

    use super::*;

    const SEED: [u8; 32] = [0x42; 32];
    const NEXT_SEED: [u8; 32] = [0x24; 32];
    const TEST_ROOM: Uuid = Uuid::from_u128(10);

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
            let stacks = vec![room.config.stack; room.config.players];

            Some(live_hand(Uuid::new_v4(), 0, seed, 0, stacks, room.config))
        } else {
            None
        };
        let rev = room.rev + 1;

        room.commit_join(hash_token(token), hand, rev);
        Ok(seat)
    }

    fn live_hand(
        id: Uuid,
        no: u64,
        seed: [u8; 32],
        dealer: usize,
        stacks: Vec<u32>,
        config: RoomConfig,
    ) -> LiveHand {
        LiveHand {
            id,
            no,
            seed,
            game: State::new(seed, dealer, &stacks, config.small_blind, config.big_blind),
            starting_stacks: stacks,
            result: None,
            next_seq: 0,
            actions: Vec::new(),
        }
    }

    fn assign(room: &mut Room, id: Uuid, seat: usize) {
        let hand_no = room.hand.as_ref().unwrap().no + 1;
        let pending = room
            .stage_challenge(id, seat, hand_no, [seat as u8 + 1; 32])
            .unwrap();
        let challenge = Challenge {
            hand_no,
            seat,
            hand_tag: pending.hand_tag,
            commitment: pending.commitment,
            nonce: [seat as u8 + 7; 32],
            catalog_root: catalog_root(),
            draw_verified: true,
            facts_salt: None,
            facts_hash: None,
            facts: None,
            nullifier: None,
            points: None,
        };

        room.commit_challenge(challenge, pending.rev);
    }

    fn assign_all(room: &mut Room, id: Uuid) {
        for seat in 0..room.seats.len() {
            assign(room, id, seat);
        }
    }

    fn claimable_room() -> Room {
        let mut room = started(100);
        let hand = room.hand.as_mut().unwrap();

        hand.no = 1;

        for seat in 0..room.seats.len() {
            room.current_challenges[seat] = Some(Challenge {
                hand_no: 1,
                seat,
                hand_tag: hand_tag(*TEST_ROOM.as_bytes(), 1),
                commitment: [seat as u8 + 1; 32],
                nonce: [seat as u8 + 7; 32],
                catalog_root: catalog_root(),
                draw_verified: true,
                facts_salt: None,
                facts_hash: None,
                facts: None,
                nullifier: None,
                points: None,
            });
        }

        apply(&mut room, 0, Action::Fold).unwrap();
        room
    }

    fn apply(room: &mut Room, seat: usize, action: Action) -> Result<(), &'static str> {
        let mut next = room.stage_action(seat, action)?;

        if next.facts.is_some() {
            bind_facts(
                &mut next,
                &room.current_challenges,
                vec![[0x55; 32]; room.config.players],
            )?;
        }

        room.commit_action(next);
        Ok(())
    }

    fn stored_room() -> StoredRoom {
        StoredRoom {
            id: TEST_ROOM,
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
                    proof_points: 0,
                },
                StoredSeat {
                    seat: 1,
                    token_hash: hash_token(Uuid::from_u128(2)).to_vec(),
                    ready_hand: None,
                    proof_points: 0,
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
            challenges: Vec::new(),
        }
    }

    fn proof_parts(inputs: ProofInputs) -> (Vec<u8>, Vec<u8>) {
        let mut public = Vec::with_capacity(crate::proof::PUBLIC_BYTES);

        for byte in [inputs.mode]
            .into_iter()
            .chain(inputs.hand_tag)
            .chain([inputs.seat])
            .chain(inputs.commitment)
            .chain(inputs.nonce)
            .chain(inputs.facts_hash)
            .chain(inputs.nullifier)
            .chain(inputs.catalog_root)
        {
            public.extend_from_slice(&[0; 31]);
            public.push(byte);
        }

        (vec![0; 32], public)
    }

    async fn persist_draw(db: &Db, room_id: Uuid, room: &mut Room, seat: usize) {
        let hand_no = room.hand.as_ref().unwrap().no + 1;
        let draw = room.stage_draw(seat, hand_no).unwrap();
        let (proof, public_inputs) = proof_parts(ProofInputs {
            mode: MODE_DRAW,
            hand_tag: draw.hand_tag,
            seat: draw.seat as u8,
            commitment: draw.commitment,
            nonce: draw.nonce,
            facts_hash: [0; 32],
            nullifier: [0; 32],
            catalog_root: draw.catalog_root,
        });

        db.draw(DrawUpdate {
            room: room_id,
            hand_no: draw.hand_no,
            seat: draw.seat,
            hand_tag: draw.hand_tag,
            commitment: draw.commitment,
            nonce: draw.nonce,
            catalog_root: draw.catalog_root,
            proof,
            public_inputs,
            rev: room.rev,
            next_rev: draw.rev,
        })
        .await
        .unwrap();
        room.commit_draw(draw);
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
        let mut room = restore_room(stored).unwrap();
        let players = room.config.players;

        room.ceremony = fairness::load_pending(db, id, players).await.unwrap();
        room.current_commitment = fairness::current_commitment(db, id).await.unwrap();
        room
    }

    async fn persist(db: &Db, id: Uuid, room: &mut Room, seat: usize, action: Action) {
        let mut next = room.stage_action(seat, action).unwrap();

        if next.facts.is_some() {
            bind_facts(
                &mut next,
                &room.current_challenges,
                vec![[0x55; 32]; room.config.players],
            )
            .unwrap();
        }

        db.append_action(NewAction {
            room: id,
            hand: next.hand,
            hand_no: room.hand.as_ref().unwrap().no,
            seq: next.seq,
            player: next.player,
            action: next.action,
            facts: next.fact_commitments.as_deref(),
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
        let hand = room.hand.as_ref().unwrap();
        let game = &hand.game;
        let first = room_view(TEST_ROOM, &room, hand, 0);
        let second = room_view(TEST_ROOM, &room, hand, 1);

        assert_eq!(first.hole, game.hole[0].map(card_view));
        assert_eq!(second.hole, game.hole[1].map(card_view));
        assert_ne!(first.hole, second.hole);
        assert!(first.result.is_none());
        assert!(second.result.is_none());
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

        let hand = room.hand.as_ref().unwrap();
        let game = &hand.game;
        let view = room_view(TEST_ROOM, &room, hand, 0);
        let result = view.result.unwrap();

        assert!(game.settled);
        assert_eq!(game.fold_winner, Some(1));
        assert_eq!(game.pot, 0);
        assert_eq!(game.players[1].stack, 105);
        assert_eq!(result.kind, "fold");
        assert_eq!(
            result.awards,
            vec![AwardView {
                player: 1,
                amount: 15,
            }]
        );
        assert!(result.revealed.iter().all(Option::is_none));
        assert_eq!(room.rev, 2);
    }

    #[test]
    fn showdown_view() {
        let mut room = Room::new(config(3), hash_token(Uuid::new_v4())).unwrap();

        join(&mut room, Uuid::new_v4(), None).unwrap();
        join(&mut room, Uuid::new_v4(), Some(SEED)).unwrap();
        apply(&mut room, 0, Action::Fold).unwrap();

        while !room.hand.as_ref().unwrap().game.settled {
            let game = &room.hand.as_ref().unwrap().game;
            let seat = game.turn;
            let actions = game.legal_actions(seat).unwrap();
            let action = if actions.check {
                Action::Check
            } else if actions.call.is_some() {
                Action::Call
            } else {
                Action::Fold
            };

            apply(&mut room, seat, action).unwrap();
        }

        let hand = room.hand.as_ref().unwrap();
        let result = room_view(TEST_ROOM, &room, hand, 1).result.unwrap();

        assert_eq!(result.kind, "showdown");
        assert_eq!(result.revealed[0], None);
        assert_eq!(result.revealed[1], Some(hand.game.hole[1].map(card_view)));
        assert_eq!(result.revealed[2], Some(hand.game.hole[2].map(card_view)));
        assert_eq!(
            result.awards,
            hand.result
                .as_ref()
                .unwrap()
                .awards
                .iter()
                .map(|award| AwardView {
                    player: award.player,
                    amount: award.amount,
                })
                .collect::<Vec<_>>()
        );
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
        assert_eq!(room.stage_ready(0).err(), Some("draw proof required"));
        assign_all(&mut room, TEST_ROOM);

        let ready = room.stage_ready(0).unwrap();

        assert!(!ready.all);
        room.commit_ready(0, None, ready.rev);
        assert_eq!(room.stage_ready(0).err(), Some("already ready"));

        let first = room_view(TEST_ROOM, &room, room.hand.as_ref().unwrap(), 0)
            .ready
            .unwrap();
        let second = room_view(TEST_ROOM, &room, room.hand.as_ref().unwrap(), 1)
            .ready
            .unwrap();

        assert_eq!(first.count, 1);
        assert!(first.mine);
        assert!(!second.mine);
        assert!(!first.complete);
    }

    #[test]
    fn challenge_rules() {
        let mut room = started(100);

        assert_eq!(
            room.stage_challenge(TEST_ROOM, 0, 1, [1; 32]).err(),
            Some("hand not settled")
        );
        apply(&mut room, 0, Action::Fold).unwrap();
        assert_eq!(
            room.stage_challenge(TEST_ROOM, 0, 2, [1; 32]).err(),
            Some("wrong challenge hand")
        );
        assign(&mut room, TEST_ROOM, 0);
        assign(&mut room, TEST_ROOM, 1);

        assert_eq!(
            room.stage_challenge(TEST_ROOM, 0, 1, [9; 32]).err(),
            Some("challenge already assigned")
        );

        let first = room_view(TEST_ROOM, &room, room.hand.as_ref().unwrap(), 0)
            .challenge
            .unwrap();
        let second = room_view(TEST_ROOM, &room, room.hand.as_ref().unwrap(), 1)
            .challenge
            .unwrap();

        assert!(first.assigned);
        assert!(second.assigned);
        assert!(first.draw_verified);
        assert!(second.draw_verified);
        assert_eq!(first.catalog_root, Some(encode_hex(catalog_root())));
        assert_eq!(second.catalog_root, Some(encode_hex(catalog_root())));
        assert_ne!(first.commitment, second.commitment);
        assert_eq!(
            first.hand_tag,
            encode_hex(hand_tag(*TEST_ROOM.as_bytes(), 1))
        );
        assert!(room.stage_ready(0).is_ok());
    }

    #[test]
    fn challenge_message() {
        let value = "11".repeat(32);
        let valid =
            format!("{{\"type\":\"challenge_commit\",\"hand_no\":1,\"commitment\":\"{value}\"}}");
        let secret = format!(
            "{{\"type\":\"challenge_commit\",\"hand_no\":1,\"commitment\":\"{value}\",\"secret\":\"{value}\"}}"
        );
        let index = format!(
            "{{\"type\":\"challenge_commit\",\"hand_no\":1,\"commitment\":\"{value}\",\"objective_index\":2}}"
        );

        assert!(serde_json::from_str::<ClientMessage>(&valid).is_ok());
        assert!(serde_json::from_str::<ClientMessage>(&secret).is_err());
        assert!(serde_json::from_str::<ClientMessage>(&index).is_err());
        assert!(decode_hex(&value).is_some());
        assert!(decode_hex(&value[..62]).is_none());
        assert!(decode_hex(&"aa".repeat(32).to_uppercase()).is_none());

        let claim = "{\"type\":\"challenge_claim\",\"hand_no\":1,\"proof\":\"AA==\",\"public_inputs\":\"AA==\"}";
        let draw = "{\"type\":\"challenge_draw\",\"hand_no\":1,\"proof\":\"AA==\",\"public_inputs\":\"AA==\"}";
        let facts = "{\"type\":\"challenge_claim\",\"hand_no\":1,\"proof\":\"AA==\",\"public_inputs\":\"AA==\",\"facts\":[1,0,0,0,0,0]}";
        let secret = format!(
            "{{\"type\":\"challenge_claim\",\"hand_no\":1,\"proof\":\"AA==\",\"public_inputs\":\"AA==\",\"secret\":\"{value}\"}}"
        );

        assert!(serde_json::from_str::<ClientMessage>(claim).is_ok());
        assert!(serde_json::from_str::<ClientMessage>(draw).is_ok());
        assert!(serde_json::from_str::<ClientMessage>(facts).is_err());
        assert!(serde_json::from_str::<ClientMessage>(&secret).is_err());
    }

    #[test]
    fn draw_rules() {
        let mut room = started(100);

        apply(&mut room, 0, Action::Fold).unwrap();
        let pending = room.stage_challenge(TEST_ROOM, 0, 1, [1; 32]).unwrap();
        room.commit_challenge(
            Challenge {
                hand_no: 1,
                seat: 0,
                hand_tag: pending.hand_tag,
                commitment: pending.commitment,
                nonce: [7; 32],
                catalog_root: catalog_root(),
                draw_verified: false,
                facts_salt: None,
                facts_hash: None,
                facts: None,
                nullifier: None,
                points: None,
            },
            pending.rev,
        );

        assert_eq!(room.stage_ready(0).err(), Some("draw proof required"));
        let draw = room.stage_draw(0, 1).unwrap();
        let mut inputs = ProofInputs {
            mode: MODE_DRAW,
            hand_tag: draw.hand_tag,
            seat: 0,
            commitment: draw.commitment,
            nonce: draw.nonce,
            facts_hash: [0; 32],
            nullifier: [0; 32],
            catalog_root: draw.catalog_root,
        };

        assert!(draw_matches(inputs, draw));
        inputs.facts_hash[0] = 1;
        assert!(!draw_matches(inputs, draw));
        room.commit_draw(draw);
        assert_eq!(room.stage_draw(0, 1).err(), Some("draw already verified"));
    }

    #[test]
    fn claim_rules() {
        let active = started(100);

        assert_eq!(active.stage_claim(0, 0).err(), Some("hand not settled"));

        let mut room = claimable_room();
        let claim = room.stage_claim(0, 1).unwrap();
        let challenge = room.current_challenges[0].as_ref().unwrap();
        let inputs = ProofInputs {
            mode: MODE_COMPLETE,
            hand_tag: challenge.hand_tag,
            seat: 0,
            commitment: challenge.commitment,
            nonce: challenge.nonce,
            facts_hash: challenge.facts_hash.unwrap(),
            nullifier: [9; 32],
            catalog_root: challenge.catalog_root,
        };

        assert!(claim_matches(inputs, claim));
        assert_eq!(claim.points, u32::from(POINTS));
        room.commit_claim(claim, inputs.nullifier);
        assert_eq!(room.seats[0].proof_points, u64::from(POINTS));
        assert_eq!(room.seats[1].proof_points, 0);
        assert_eq!(
            room.stage_claim(0, 1).err(),
            Some("challenge already claimed")
        );

        let view = room_view(TEST_ROOM, &room, room.hand.as_ref().unwrap(), 0);

        assert_eq!(view.claim.as_ref().unwrap().status, "claimed");
        assert_eq!(
            view.claim.as_ref().unwrap().catalog_root,
            encode_hex(catalog_root())
        );
        assert_eq!(view.claim.unwrap().points, Some(u32::from(POINTS)));
        assert_eq!(view.players[0].proof_points, u64::from(POINTS));
    }

    #[test]
    fn claim_metadata() {
        let room = claimable_room();
        let claim = room.stage_claim(0, 1).unwrap();
        let mut inputs = ProofInputs {
            mode: MODE_COMPLETE,
            hand_tag: claim.hand_tag,
            seat: 0,
            commitment: claim.commitment,
            nonce: claim.nonce,
            facts_hash: claim.facts_hash,
            nullifier: [9; 32],
            catalog_root: claim.catalog_root,
        };

        assert!(claim_matches(inputs, claim));

        inputs.hand_tag[0] ^= 1;
        assert!(!claim_matches(inputs, claim));
        inputs.hand_tag = claim.hand_tag;
        inputs.seat = 1;
        assert!(!claim_matches(inputs, claim));
        inputs.seat = 0;
        inputs.mode = MODE_DRAW;
        assert!(!claim_matches(inputs, claim));
        inputs.mode = MODE_COMPLETE;
        inputs.commitment[0] ^= 1;
        assert!(!claim_matches(inputs, claim));
        inputs.commitment = claim.commitment;
        inputs.nonce[0] ^= 1;
        assert!(!claim_matches(inputs, claim));
        inputs.nonce = claim.nonce;
        inputs.catalog_root[0] ^= 1;
        assert!(!claim_matches(inputs, claim));
        inputs.catalog_root = claim.catalog_root;
        inputs.facts_hash[0] ^= 1;
        assert!(!claim_matches(inputs, claim));
    }

    #[test]
    fn replay_facts() {
        let config = RoomConfig {
            players: 2,
            stack: 100,
            small_blind: 5,
            big_blind: 10,
        };
        let stacks = [100, 100];
        let actions = [
            PlayedAction {
                player: 0,
                action: Action::RaiseTo(20),
            },
            PlayedAction {
                player: 1,
                action: Action::Call,
            },
        ];
        let (_, _, facts) = replay_hand(config, SEED, 0, &stacks, &actions).unwrap();

        assert!(facts[0].raised_preflop);
        assert!(facts[0].saw_flop);
        assert!(facts[1].saw_flop);

        let actions = [
            PlayedAction {
                player: 0,
                action: Action::Call,
            },
            PlayedAction {
                player: 1,
                action: Action::Check,
            },
            PlayedAction {
                player: 1,
                action: Action::Check,
            },
            PlayedAction {
                player: 0,
                action: Action::Fold,
            },
        ];
        let (game, _, facts) = replay_hand(config, SEED, 0, &stacks, &actions).unwrap();

        assert!(game.settled);
        assert!(facts[0].called_preflop);
        assert!(facts[0].saw_flop);
        assert!(facts[1].checked_flop);
        assert!(!facts[0].reached_showdown);
        assert!(!facts[1].reached_showdown);
        assert_eq!(facts[1].net_profit, game.players[1].stack > stacks[1]);

        let actions = [PlayedAction {
            player: 0,
            action: Action::Fold,
        }];
        let (_, _, facts) = replay_hand(config, SEED, 0, &stacks, &actions).unwrap();

        assert!(!facts[0].saw_flop);
        assert!(!facts[1].saw_flop);

        let actions = [
            PlayedAction {
                player: 0,
                action: Action::Call,
            },
            PlayedAction {
                player: 1,
                action: Action::Check,
            },
            PlayedAction {
                player: 1,
                action: Action::Check,
            },
            PlayedAction {
                player: 0,
                action: Action::Check,
            },
            PlayedAction {
                player: 1,
                action: Action::Check,
            },
            PlayedAction {
                player: 0,
                action: Action::Check,
            },
            PlayedAction {
                player: 1,
                action: Action::Check,
            },
            PlayedAction {
                player: 0,
                action: Action::Check,
            },
        ];
        let (game, _, facts) = replay_hand(config, SEED, 0, &stacks, &actions).unwrap();

        assert!(game.settled);
        assert!(facts.iter().all(|facts| facts.reached_showdown));

        for seat in 0..2 {
            assert_eq!(
                facts[seat].net_profit,
                game.players[seat].stack > stacks[seat]
            );
        }
    }

    #[test]
    fn challenge_recovery() {
        let mut stored = stored_room();
        let hand = stored.hand.as_mut().unwrap();

        hand.hand_no = 1;
        hand.actions.push(StoredAction {
            seq: 0,
            player: 0,
            action: "fold".to_owned(),
            raise_to: None,
        });
        stored.rev = 6;
        let (_, result, facts) = replay_hand(
            config(2),
            SEED,
            0,
            &[1000, 1000],
            &[PlayedAction {
                player: 0,
                action: Action::Fold,
            }],
        )
        .unwrap();
        let tag = hand_tag(*TEST_ROOM.as_bytes(), 1);

        for seat in 0..2 {
            let commitment = [seat as u8 + 1; 32];
            let nonce = [seat as u8 + 7; 32];
            let salt = [0x55; 32];
            let hash = facts_hash(tag, seat as u8, salt, facts[seat as usize]);
            let (draw_proof, draw_public_inputs) = proof_parts(ProofInputs {
                mode: MODE_DRAW,
                hand_tag: tag,
                seat: seat as u8,
                commitment,
                nonce,
                facts_hash: [0; 32],
                nullifier: [0; 32],
                catalog_root: catalog_root(),
            });

            stored.challenges.push(StoredChallenge {
                hand_no: 1,
                seat,
                version: i32::from(PROTOCOL_VERSION),
                hand_tag: tag.to_vec(),
                commitment: commitment.to_vec(),
                nonce: nonce.to_vec(),
                catalog_root: catalog_root().to_vec(),
                draw_proof: Some(draw_proof),
                draw_public_inputs: Some(draw_public_inputs),
                draw_verified: true,
                facts_salt: Some(salt.to_vec()),
                facts_hash: Some(hash.to_vec()),
                nullifier: None,
                points: None,
                completion_proof: None,
                completion_public_inputs: None,
                claimed: false,
            });
        }

        let restored = restore_room(stored.clone()).unwrap();

        assert!(restored.hand.as_ref().unwrap().game.settled);
        assert_eq!(restored.hand.as_ref().unwrap().result, result);
        assert_eq!(
            restored.current_challenges[0].as_ref().unwrap().nonce,
            [7; 32]
        );
        assert_eq!(
            restored.current_challenges[0]
                .as_ref()
                .unwrap()
                .catalog_root,
            catalog_root()
        );
        assert!(
            restored.current_challenges[0]
                .as_ref()
                .unwrap()
                .facts
                .is_some()
        );

        let mut corrupt = stored.clone();
        corrupt.challenges[0].facts_hash.as_mut().unwrap()[0] ^= 1;
        assert!(restore_room(corrupt).is_err());

        let mut corrupt = stored;
        corrupt.challenges[0].catalog_root.pop();
        assert!(restore_room(corrupt).is_err());
    }

    #[test]
    fn next_hand() {
        let mut room = started(100);

        apply(&mut room, 0, Action::Fold).unwrap();
        assign_all(&mut room, TEST_ROOM);

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
            seed: NEXT_SEED,
            starting_stacks: stacks.clone(),
            game,
            result: None,
            next_seq: 0,
            actions: Vec::new(),
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
        assert!(room_view(TEST_ROOM, &room, hand, 0).ready.is_none());
        assert_ne!(seat_view(&hand.game, 0).hole, seat_view(&hand.game, 1).hole);
    }

    #[test]
    fn short_table() {
        let mut room = started(10);

        apply(&mut room, 0, Action::Fold).unwrap();
        let game = room.hand.as_ref().unwrap().game.clone();
        assign_all(&mut room, TEST_ROOM);

        let ready = room.stage_ready(0).unwrap();
        room.commit_ready(0, None, ready.rev);
        let ready = room.stage_ready(1).unwrap();

        assert_eq!(
            room.hand.as_ref().unwrap().game.next_hand(NEXT_SEED),
            Err(NextHandError::CannotStart)
        );

        room.commit_ready(1, None, ready.rev);

        let hand = room.hand.as_ref().unwrap();
        let view = room_view(TEST_ROOM, &room, hand, 0).ready.unwrap();

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

        sqlx::query("TRUNCATE hand_entropy, hand_ceremonies, challenge_assignments, hand_actions, hands, seats, rooms")
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
            room_message(waiting_id, &waiting, 0),
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
            Some(live_hand(hand_id, 0, SEED, 0, stacks.clone(), config)),
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
                hand_no: 0,
                seq: next.seq,
                player: next.player,
                action: next.action,
                facts: next.fact_commitments.as_deref(),
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
        let expected_result = room.hand.as_ref().unwrap().result.clone();
        let restored = reload(&db, id).await;
        let restored_hand = restored.hand.as_ref().unwrap();

        same_game(&restored_hand.game, &expected);
        assert_eq!(restored_hand.result, expected_result);
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
            Some(live_hand(other_hand, 0, SEED, 0, stacks.clone(), config)),
            1,
        );
        persist(&db, other_id, &mut other, 0, Action::Fold).await;

        let expected = other.hand.as_ref().unwrap().game.clone();
        let expected_result = other.hand.as_ref().unwrap().result.clone();
        let restored = reload(&db, other_id).await;
        let restored_hand = restored.hand.as_ref().unwrap();

        same_game(&restored_hand.game, &expected);
        assert_eq!(restored_hand.result, expected_result);
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
            Some(live_hand(
                all_in_hand,
                0,
                SEED,
                0,
                all_in_stacks.clone(),
                all_in_config,
            )),
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
        let latest_seed = [0x24u8; 32];

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

        let stored = db
            .load_rooms()
            .await
            .unwrap()
            .into_iter()
            .find(|room| room.id == all_in_id)
            .unwrap();

        assert!(restore_room(stored).is_err());
        sqlx::query("DELETE FROM hands WHERE id = $1")
            .bind(latest_id)
            .execute(db.pool())
            .await
            .unwrap();

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
        let ready_first_hash = hash_token(ready_first);
        let ready_second_hash = hash_token(ready_second);
        let ready_first_share = [0x61; 32];
        let ready_second_share = [0x62; 32];
        let ready_ceremony = fairness::random_ceremony(ready_id, 0, ready_config.players).unwrap();
        let mut live = Room::new_fair(
            ready_config,
            ready_first_hash,
            ready_ceremony,
            ready_first_share,
        )
        .unwrap();
        let ready_ceremony = live.ceremony.as_ref().unwrap().clone();
        let ready_seed = ready_ceremony
            .seed_with(ready_id, 1, ready_second_share)
            .unwrap();
        let ready_next_ceremony =
            fairness::random_ceremony(ready_id, 1, ready_config.players).unwrap();

        fairness::create_room(
            &db,
            ready_id,
            ready_config,
            &ready_first_hash,
            &ready_ceremony,
            ready_first_share,
        )
        .await
        .unwrap();
        fairness::join_room(
            &db,
            ready_id,
            1,
            &ready_second_hash,
            ready_second_share,
            0,
            1,
            &ready_ceremony,
            Some(NewHand {
                id: ready_hand,
                no: 0,
                seed: &ready_seed,
                dealer: 0,
                stacks: &ready_stacks,
            }),
            Some(&ready_next_ceremony),
        )
        .await
        .unwrap();
        live.commit_fair_join(
            ready_second_hash,
            1,
            ready_second_share,
            Some(live_hand(
                ready_hand,
                0,
                ready_seed,
                0,
                ready_stacks.clone(),
                ready_config,
            )),
            Some(ready_next_ceremony),
            1,
        );

        let mut rooms = HashMap::new();
        rooms.insert(ready_id, Arc::new(Mutex::new(live)));
        let ready_state = AppState::test(db.clone(), rooms);

        assert_eq!(
            ready_room(&ready_state, ready_id, 0).await,
            Err("hand not settled")
        );
        apply_action(&ready_state, ready_id, 0, Action::Fold)
            .await
            .unwrap();
        assert_eq!(
            ready_room(&ready_state, ready_id, 0).await,
            Err("draw proof required")
        );
        let first_commitment = encode_hex([1; 32]);
        let second_commitment = encode_hex([2; 32]);

        challenge_room(&ready_state, ready_id, 0, 1, &first_commitment)
            .await
            .unwrap();
        challenge_room(&ready_state, ready_id, 1, 1, &second_commitment)
            .await
            .unwrap();
        assert_eq!(
            challenge_room(&ready_state, ready_id, 0, 1, &encode_hex([9; 32]),).await,
            Err("challenge already assigned")
        );
        {
            let live = find_room(&ready_state, ready_id).await.unwrap();
            let mut room = live.lock().await;

            persist_draw(&db, ready_id, &mut room, 0).await;
            persist_draw(&db, ready_id, &mut room, 1).await;
        }
        ready_room(&ready_state, ready_id, 0).await.unwrap();

        let rev = sqlx::query("SELECT rev FROM rooms WHERE id = $1")
            .bind(ready_id)
            .fetch_one(db.pool())
            .await
            .unwrap()
            .get::<i64, _>("rev");

        assert_eq!(rev, 7);
        let assignments = sqlx::query(
            "SELECT hand_no, seat, version, hand_tag, commitment, nonce, catalog_root, facts_hash \
             FROM challenge_assignments WHERE room_id = $1 ORDER BY seat",
        )
        .bind(ready_id)
        .fetch_all(db.pool())
        .await
        .unwrap();

        assert_eq!(assignments.len(), 2);
        assert_eq!(assignments[0].get::<i64, _>("hand_no"), 1);
        assert_eq!(assignments[0].get::<i32, _>("seat"), 0);
        assert_eq!(assignments[0].get::<i32, _>("version"), 2);
        assert_eq!(
            assignments[0].get::<Vec<u8>, _>("hand_tag"),
            hand_tag(*ready_id.as_bytes(), 1)
        );
        assert_eq!(assignments[0].get::<Vec<u8>, _>("commitment"), [1; 32]);
        assert_eq!(assignments[0].get::<Vec<u8>, _>("nonce").len(), 32);
        assert_eq!(
            assignments[0].get::<Vec<u8>, _>("catalog_root"),
            catalog_root()
        );
        assert!(
            assignments[0]
                .get::<Option<Vec<u8>>, _>("facts_hash")
                .is_none()
        );
        let first_nonce = assignments[0].get::<Vec<u8>, _>("nonce");
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
        let first_ready = room_view(ready_id, &restored, restored.hand.as_ref().unwrap(), 0)
            .ready
            .unwrap();
        let second_ready = room_view(ready_id, &restored, restored.hand.as_ref().unwrap(), 1)
            .ready
            .unwrap();

        assert!(first_ready.mine);
        assert!(!second_ready.mine);
        assert_eq!(first_ready.count, 1);
        assert_eq!(restored.rev, 7);
        assert_eq!(
            restored.next_challenges[0].as_ref().unwrap().nonce,
            first_nonce.as_slice()
        );
        assert_eq!(seat_for_token(&restored, ready_first), Some(0));
        assert_eq!(seat_for_token(&restored, ready_second), Some(1));

        let mut rooms = HashMap::new();
        rooms.insert(ready_id, Arc::new(Mutex::new(restored)));
        let ready_state = AppState::test(db.clone(), rooms);

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
        assert!(room_view(ready_id, &room, next, 0).ready.is_none());
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

        let fact_rows = sqlx::query(
            "SELECT seat, facts_hash FROM challenge_assignments \
             WHERE room_id = $1 AND hand_no = 1 ORDER BY seat",
        )
        .bind(ready_id)
        .fetch_all(db.pool())
        .await
        .unwrap();
        let room = find_room(&ready_state, ready_id).await.unwrap();
        let room = room.lock().await;
        let first_claim = room_view(ready_id, &room, room.hand.as_ref().unwrap(), 0)
            .claim
            .unwrap();
        let second_claim = room_view(ready_id, &room, room.hand.as_ref().unwrap(), 1)
            .claim
            .unwrap();

        assert_eq!(fact_rows.len(), 2);
        assert_eq!(first_claim.facts, [0, 0, 0, 0, 0, 0]);
        assert_eq!(second_claim.facts, [0, 0, 1, 0, 0, 1]);
        assert_eq!(
            fact_rows[0].get::<Vec<u8>, _>("facts_hash"),
            decode_hex(&first_claim.facts_hash).unwrap()
        );
        assert_eq!(
            fact_rows[1].get::<Vec<u8>, _>("facts_hash"),
            decode_hex(&second_claim.facts_hash).unwrap()
        );
        assert_ne!(first_claim.facts_hash, second_claim.facts_hash);
        drop(room);

        let restored = reload(&db, ready_id).await;

        assert_eq!(
            restored.current_challenges[0].as_ref().unwrap().nonce,
            first_nonce.as_slice()
        );
        assert_eq!(
            room_view(ready_id, &restored, restored.hand.as_ref().unwrap(), 0)
                .claim
                .unwrap()
                .facts,
            [0, 0, 0, 0, 0, 0]
        );

        let live = find_room(&ready_state, ready_id).await.unwrap();
        let mut room = live.lock().await;
        let claim = room.stage_claim(0, 1).unwrap();
        let nullifier = [0x91; 32];
        let (proof, public_inputs) = proof_parts(ProofInputs {
            mode: MODE_COMPLETE,
            hand_tag: claim.hand_tag,
            seat: claim.seat as u8,
            commitment: claim.commitment,
            nonce: claim.nonce,
            facts_hash: claim.facts_hash,
            nullifier,
            catalog_root: claim.catalog_root,
        });

        db.claim(ClaimUpdate {
            room: ready_id,
            hand_no: claim.hand_no,
            seat: claim.seat,
            hand_tag: claim.hand_tag,
            commitment: claim.commitment,
            nonce: claim.nonce,
            catalog_root: claim.catalog_root,
            facts_salt: claim.facts_salt,
            facts_hash: claim.facts_hash,
            nullifier,
            proof,
            public_inputs,
            points: claim.points,
            prior_points: claim.prior_points,
            next_points: claim.next_points,
            rev: room.rev,
            next_rev: claim.rev,
        })
        .await
        .unwrap();
        room.commit_claim(claim, nullifier);

        assert_eq!(room.seats[0].proof_points, u64::from(POINTS));
        assert_eq!(
            room.stage_claim(0, 1).err(),
            Some("challenge already claimed")
        );
        let other = room.stage_claim(1, 1).unwrap();
        let rev = room.rev;
        let (proof, public_inputs) = proof_parts(ProofInputs {
            mode: MODE_COMPLETE,
            hand_tag: other.hand_tag,
            seat: other.seat as u8,
            commitment: other.commitment,
            nonce: other.nonce,
            facts_hash: other.facts_hash,
            nullifier,
            catalog_root: other.catalog_root,
        });

        assert!(
            db.claim(ClaimUpdate {
                room: ready_id,
                hand_no: other.hand_no,
                seat: other.seat,
                hand_tag: other.hand_tag,
                commitment: other.commitment,
                nonce: other.nonce,
                catalog_root: other.catalog_root,
                facts_salt: other.facts_salt,
                facts_hash: other.facts_hash,
                nullifier,
                proof,
                public_inputs,
                points: other.points,
                prior_points: other.prior_points,
                next_points: other.next_points,
                rev,
                next_rev: other.rev,
            })
            .await
            .is_err()
        );
        assert_eq!(room.rev, rev);
        assert_eq!(room.seats[1].proof_points, 0);
        drop(room);

        let row = sqlx::query(
            "SELECT nullifier, points, claimed_at IS NOT NULL AS claimed \
             FROM challenge_assignments WHERE room_id = $1 AND hand_no = 1 AND seat = 0",
        )
        .bind(ready_id)
        .fetch_one(db.pool())
        .await
        .unwrap();

        assert_eq!(row.get::<Vec<u8>, _>("nullifier"), nullifier);
        assert_eq!(row.get::<i64, _>("points"), i64::from(POINTS));
        assert!(row.get::<bool, _>("claimed"));
        assert!(
            sqlx::query(
                "SELECT nullifier FROM challenge_assignments \
                 WHERE room_id = $1 AND hand_no = 1 AND seat = 1",
            )
            .bind(ready_id)
            .fetch_one(db.pool())
            .await
            .unwrap()
            .get::<Option<Vec<u8>>, _>("nullifier")
            .is_none()
        );
        assert_eq!(
            sqlx::query("SELECT proof_points FROM seats WHERE room_id = $1 AND seat = 0")
                .bind(ready_id)
                .fetch_one(db.pool())
                .await
                .unwrap()
                .get::<i64, _>("proof_points"),
            i64::from(POINTS)
        );

        let restored = reload(&db, ready_id).await;

        assert_eq!(restored.seats[0].proof_points, u64::from(POINTS));
        assert_eq!(
            restored.current_challenges[0].as_ref().unwrap().nullifier,
            Some(nullifier)
        );
        assert_eq!(
            room_view(ready_id, &restored, restored.hand.as_ref().unwrap(), 0)
                .claim
                .unwrap()
                .status,
            "claimed"
        );

        let first_hash = fact_rows[0].get::<Vec<u8>, _>("facts_hash");
        let mut corrupt_hash = first_hash.clone();
        corrupt_hash[0] ^= 1;
        sqlx::query(
            "UPDATE challenge_assignments SET facts_hash = $3 \
             WHERE room_id = $1 AND hand_no = 1 AND seat = $2",
        )
        .bind(ready_id)
        .bind(0i32)
        .bind(corrupt_hash)
        .execute(db.pool())
        .await
        .unwrap();
        let stored = db
            .load_rooms()
            .await
            .unwrap()
            .into_iter()
            .find(|room| room.id == ready_id)
            .unwrap();

        assert!(restore_room(stored).is_err());

        sqlx::query(
            "UPDATE challenge_assignments SET facts_hash = $3 \
             WHERE room_id = $1 AND hand_no = 1 AND seat = $2",
        )
        .bind(ready_id)
        .bind(0i32)
        .bind(first_hash)
        .execute(db.pool())
        .await
        .unwrap();

        challenge_room(&ready_state, ready_id, 0, 2, &encode_hex([3; 32]))
            .await
            .unwrap();
        challenge_room(&ready_state, ready_id, 1, 2, &encode_hex([4; 32]))
            .await
            .unwrap();
        {
            let live = find_room(&ready_state, ready_id).await.unwrap();
            let mut room = live.lock().await;

            persist_draw(&db, ready_id, &mut room, 0).await;
            persist_draw(&db, ready_id, &mut room, 1).await;
        }
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
        let short_first_share = [0x71; 32];
        let short_second_share = [0x72; 32];
        let short_ceremony = fairness::random_ceremony(short_id, 0, short_config.players).unwrap();
        let mut short =
            Room::new_fair(short_config, short_first, short_ceremony, short_first_share).unwrap();
        let short_ceremony = short.ceremony.as_ref().unwrap().clone();
        let short_seed = short_ceremony
            .seed_with(short_id, 1, short_second_share)
            .unwrap();
        let short_next_ceremony =
            fairness::random_ceremony(short_id, 1, short_config.players).unwrap();

        fairness::create_room(
            &db,
            short_id,
            short_config,
            &short_first,
            &short_ceremony,
            short_first_share,
        )
        .await
        .unwrap();
        fairness::join_room(
            &db,
            short_id,
            1,
            &short_second,
            short_second_share,
            0,
            1,
            &short_ceremony,
            Some(NewHand {
                id: short_hand,
                no: 0,
                seed: &short_seed,
                dealer: 0,
                stacks: &short_stacks,
            }),
            Some(&short_next_ceremony),
        )
        .await
        .unwrap();
        short.commit_fair_join(
            short_second,
            1,
            short_second_share,
            Some(live_hand(
                short_hand,
                0,
                short_seed,
                0,
                short_stacks.clone(),
                short_config,
            )),
            Some(short_next_ceremony),
            1,
        );

        let mut rooms = HashMap::new();
        rooms.insert(short_id, Arc::new(Mutex::new(short)));
        let short_state = AppState::test(db.clone(), rooms);

        apply_action(&short_state, short_id, 0, Action::Fold)
            .await
            .unwrap();
        challenge_room(&short_state, short_id, 0, 1, &encode_hex([5; 32]))
            .await
            .unwrap();
        challenge_room(&short_state, short_id, 1, 1, &encode_hex([6; 32]))
            .await
            .unwrap();
        {
            let live = find_room(&short_state, short_id).await.unwrap();
            let mut room = live.lock().await;

            persist_draw(&db, short_id, &mut room, 0).await;
            persist_draw(&db, short_id, &mut room, 1).await;
        }
        ready_room(&short_state, short_id, 0).await.unwrap();
        ready_room(&short_state, short_id, 1).await.unwrap();

        let short = find_room(&short_state, short_id).await.unwrap();
        let short = short.lock().await;
        let hand = short.hand.as_ref().unwrap();

        assert_eq!(hand.id, short_hand);
        assert_eq!(hand.no, 0);
        assert_eq!(hand.game.players[0].stack, 5);
        assert!(room_view(short_id, &short, hand, 0).ready.unwrap().complete);
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

        assert!(room_view(short_id, &short, hand, 1).ready.unwrap().complete);
        assert_eq!(hand.id, short_hand);
    }

    #[tokio::test]
    #[ignore = "requires TEST_DATABASE_URL BB_PATH and built ZK artifacts"]
    async fn real_claim() {
        use base64::Engine;
        use base64::engine::general_purpose::STANDARD;

        let url = std::env::var("TEST_DATABASE_URL").expect("TEST_DATABASE_URL");
        let bb = std::env::var("BB_PATH").expect("BB_PATH");
        let db = Db::connect(&url).await.unwrap();

        sqlx::query("TRUNCATE hand_entropy, hand_ceremonies, challenge_assignments, hand_actions, hands, seats, rooms")
            .execute(db.pool())
            .await
            .unwrap();

        let output = std::process::Command::new("node")
            .arg(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../web/scripts/prove-fixture.mjs"
            ))
            .output()
            .unwrap();

        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );

        let value: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
        let proof = value["proof"].as_str().unwrap();
        let public = value["public_inputs"].as_str().unwrap();
        let draw_proof = value["draw"]["proof"].as_str().unwrap();
        let draw_public = value["draw"]["public_inputs"].as_str().unwrap();
        let config = config(3);
        let id = Uuid::new_v4();
        let hand_id = Uuid::new_v4();
        let tokens = [Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4()];
        let stacks = vec![config.stack; config.players];

        db.create_room(
            id,
            config.players,
            config.stack,
            config.small_blind,
            config.big_blind,
            &hash_token(tokens[0]),
        )
        .await
        .unwrap();
        db.join_room(id, 1, &hash_token(tokens[1]), 0, 1, None)
            .await
            .unwrap();
        db.join_room(
            id,
            2,
            &hash_token(tokens[2]),
            1,
            2,
            Some(NewHand {
                id: hand_id,
                no: 1,
                seed: &SEED,
                dealer: 0,
                stacks: &stacks,
            }),
        )
        .await
        .unwrap();

        let tag = [0x11; 32];
        let commitment =
            decode_hex("2bc670e96587a294cd84d516fc5bca12c27475f24acfbd265c92fc1cde2c98b6").unwrap();
        let nonce = [0x33; 32];
        let salt = [0x44; 32];
        let fact_hash =
            decode_hex("219fdf285ea291ee6e2c065fca84f58eac0bbe38c6f87614df3e5db01d753104").unwrap();

        db.commit_challenge(NewChallenge {
            room: id,
            hand_no: 1,
            seat: 2,
            hand_tag: tag,
            commitment,
        })
        .await
        .unwrap();
        assert!(
            sqlx::query(
                "SELECT nonce IS NULL AS pending FROM challenge_assignments \
                 WHERE room_id = $1 AND hand_no = 1 AND seat = 2",
            )
            .bind(id)
            .fetch_one(db.pool())
            .await
            .unwrap()
            .get::<bool, _>("pending")
        );
        db.assign_challenge(ChallengeEntropy {
            room: id,
            hand_no: 1,
            seat: 2,
            hand_tag: tag,
            commitment,
            nonce,
            catalog_root: catalog_root(),
            rev: 2,
            next_rev: 3,
        })
        .await
        .unwrap();
        let draw = decode_proof(draw_proof, draw_public).unwrap();

        db.draw(DrawUpdate {
            room: id,
            hand_no: 1,
            seat: 2,
            hand_tag: tag,
            commitment,
            nonce,
            catalog_root: catalog_root(),
            proof: draw.proof_bytes,
            public_inputs: draw.public_input_bytes,
            rev: 3,
            next_rev: 4,
        })
        .await
        .unwrap();
        sqlx::query(
            "UPDATE challenge_assignments SET facts_salt = $4, facts_hash = $5 \
             WHERE room_id = $1 AND hand_no = $2 AND seat = $3",
        )
        .bind(id)
        .bind(1i64)
        .bind(2i32)
        .bind(salt.as_slice())
        .bind(fact_hash.as_slice())
        .execute(db.pool())
        .await
        .unwrap();

        let mut room = Room::new(config, hash_token(tokens[0])).unwrap();

        room.commit_join(hash_token(tokens[1]), None, 1);
        let mut hand = live_hand(hand_id, 1, SEED, 0, stacks, config);
        hand.game.settled = true;
        room.commit_join(hash_token(tokens[2]), Some(hand), 2);
        room.current_challenges[2] = Some(Challenge {
            hand_no: 1,
            seat: 2,
            hand_tag: tag,
            commitment,
            nonce,
            catalog_root: catalog_root(),
            draw_verified: true,
            facts_salt: Some(salt),
            facts_hash: Some(fact_hash),
            facts: Some(Facts {
                saw_flop: true,
                raised_preflop: true,
                called_preflop: true,
                checked_flop: true,
                reached_showdown: true,
                net_profit: true,
            }),
            nullifier: None,
            points: None,
        });
        room.rev = 4;

        let verifier = ProofVerifier::load(
            bb,
            concat!(env!("CARGO_MANIFEST_DIR"), "/zk/challenge_v2.vk"),
        )
        .unwrap();
        let mut rooms = HashMap::new();
        rooms.insert(id, Arc::new(Mutex::new(room)));
        let state = AppState::new(db.clone(), rooms, verifier);
        let mut wrong_public = STANDARD.decode(public).unwrap();

        wrong_public[32 + 31] ^= 1;

        assert_eq!(
            claim_room(&state, id, 2, 1, proof, &STANDARD.encode(wrong_public)).await,
            Err("challenge proof mismatch")
        );
        assert_eq!(
            claim_room(&state, id, 1, 1, proof, public).await,
            Err("challenge missing")
        );
        assert_eq!(
            claim_room(&state, id, 2, 0, proof, public).await,
            Err("wrong challenge hand")
        );

        let mut wrong_root = STANDARD.decode(public).unwrap();
        wrong_root[162 * 32 + 31] ^= 1;
        assert_eq!(
            claim_room(&state, id, 2, 1, proof, &STANDARD.encode(wrong_root)).await,
            Err("challenge proof mismatch")
        );

        let mut altered = STANDARD.decode(proof).unwrap();
        altered[0] ^= 1;
        let altered = STANDARD.encode(altered);

        assert_eq!(
            claim_room(&state, id, 2, 1, &altered, public).await,
            Err("challenge proof failed")
        );
        assert_eq!(
            sqlx::query("SELECT rev FROM rooms WHERE id = $1")
                .bind(id)
                .fetch_one(db.pool())
                .await
                .unwrap()
                .get::<i64, _>("rev"),
            4
        );
        assert!(
            sqlx::query(
                "SELECT nullifier FROM challenge_assignments \
                 WHERE room_id = $1 AND hand_no = 1 AND seat = 2",
            )
            .bind(id)
            .fetch_one(db.pool())
            .await
            .unwrap()
            .get::<Option<Vec<u8>>, _>("nullifier")
            .is_none()
        );

        claim_room(&state, id, 2, 1, proof, public).await.unwrap();

        let room = find_room(&state, id).await.unwrap();
        let room = room.lock().await;

        assert_eq!(room.rev, 5);
        assert_eq!(room.seats[2].proof_points, u64::from(POINTS));
        drop(room);
        assert_eq!(
            claim_room(&state, id, 2, 1, proof, public).await,
            Err("challenge already claimed")
        );
        assert_eq!(
            sqlx::query("SELECT proof_points FROM seats WHERE room_id = $1 AND seat = 2")
                .bind(id)
                .fetch_one(db.pool())
                .await
                .unwrap()
                .get::<i64, _>("proof_points"),
            i64::from(POINTS)
        );
        let nullifier =
            decode_hex("15978f5f3c49bc3521ee3e1dc8d43ab00428ad899aa105db3a4ec825cc26d77a").unwrap();
        let receipt = receipt_view(db.proof_receipt(&nullifier).await.unwrap().unwrap()).unwrap();
        let receipt = serde_json::to_value(receipt).unwrap();

        assert_eq!(receipt["points"], u32::from(POINTS));
        assert!(receipt["draw_proof"].as_str().unwrap().len() > 100);
        assert!(receipt["completion_proof"].as_str().unwrap().len() > 100);
        assert!(receipt.get("secret").is_none());
        assert!(receipt.get("facts_salt").is_none());
        assert!(receipt.get("facts").is_none());
        assert_eq!(
            sqlx::query(
                "SELECT COUNT(*) AS count FROM information_schema.columns \
                 WHERE table_name = 'challenge_assignments' AND column_name = 'proof'",
            )
            .fetch_one(db.pool())
            .await
            .unwrap()
            .get::<i64, _>("count"),
            0
        );
        assert_eq!(
            sqlx::query(
                "SELECT COUNT(*) AS count FROM information_schema.columns \
                 WHERE table_name = 'challenge_assignments' \
                 AND column_name IN ('secret', 'objective_index', 'siblings')",
            )
            .fetch_one(db.pool())
            .await
            .unwrap()
            .get::<i64, _>("count"),
            0
        );
        assert_eq!(
            sqlx::query(
                "SELECT COUNT(*) AS count FROM information_schema.tables \
                 WHERE table_schema = current_schema() AND table_name = 'challenge_catalog'",
            )
            .fetch_one(db.pool())
            .await
            .unwrap()
            .get::<i64, _>("count"),
            0
        );
    }
}
