use crate::*;

#[derive(Serialize)]
pub(super) struct SeatResponse {
    pub(super) room: Uuid,
    pub(super) seat: usize,
    pub(super) token: Uuid,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct CreateRoomRequest {
    pub(super) players: usize,
    pub(super) stack: u32,
    pub(super) small_blind: u32,
    pub(super) big_blind: u32,
    pub(super) mode: Option<RoomMode>,
}

impl CreateRoomRequest {
    pub(super) const fn config(&self) -> RoomConfig {
        RoomConfig {
            players: self.players,
            stack: self.stack,
            small_blind: self.small_blind,
            big_blind: self.big_blind,
        }
    }

    pub(super) fn mode(&self) -> RoomMode {
        self.mode.unwrap_or(RoomMode::Multiplayer)
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct JoinRequest {}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
#[serde(deny_unknown_fields)]
pub(super) enum ClientMessage {
    Auth {
        token: Uuid,
    },
    Fold {
        hand_no: u64,
        rev: u64,
        request_id: Uuid,
    },
    Check {
        hand_no: u64,
        rev: u64,
        request_id: Uuid,
    },
    Call {
        hand_no: u64,
        rev: u64,
        request_id: Uuid,
    },
    RaiseTo {
        to: u32,
        hand_no: u64,
        rev: u64,
        request_id: Uuid,
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
        hand_no: u64,
        commitment: String,
        entropy: String,
    },
    DealEntropy {
        hand_no: u64,
        commitment: String,
        entropy: String,
    },
}

#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub(super) enum ServerMessage {
    Waiting {
        joined: usize,
        players: usize,
        mode: RoomMode,
    },
    WaitingFair {
        rev: u64,
        joined: usize,
        players: usize,
        mode: RoomMode,
        deal: DealView,
    },
    Snapshot {
        rev: u64,
        view: Box<SeatView>,
    },
    Error {
        code: &'static str,
        message: &'static str,
    },
}

#[derive(Debug, Eq, PartialEq, Serialize)]
pub(super) struct SeatView {
    pub(super) mode: RoomMode,
    pub(super) players: Vec<PlayerView>,
    pub(super) hand_no: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) deal: Option<DealView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) next_deal: Option<DealView>,
    pub(super) hole: [CardView; 2],
    pub(super) board: Vec<CardView>,
    pub(super) pot: u32,
    pub(super) dealer: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) turn: Option<usize>,
    pub(super) street: &'static str,
    pub(super) round_complete: bool,
    pub(super) settled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) actions: Option<ActionView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) result: Option<HandResultView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) ready: Option<ReadyView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) challenge: Option<ChallengeView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) claim: Option<ClaimView>,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
pub(super) struct DealView {
    pub(super) protocol_version: u8,
    pub(super) config: RoomConfig,
    pub(super) dealer: usize,
    pub(super) hand_no: u64,
    pub(super) commitment: String,
    pub(super) contributors: usize,
    pub(super) required: usize,
    pub(super) mine: bool,
    pub(super) state: &'static str,
    pub(super) audit: bool,
}

#[derive(Serialize)]
pub(super) struct AuditEntropyView {
    pub(super) seat: usize,
    pub(super) share: String,
}

#[derive(Serialize)]
pub(super) struct AuditView {
    pub(super) protocol_version: u8,
    pub(super) config: RoomConfig,
    pub(super) algorithm: &'static str,
    pub(super) room: Uuid,
    pub(super) hand_no: u64,
    pub(super) players: usize,
    pub(super) dealer: usize,
    pub(super) commitment: String,
    pub(super) server_secret: String,
    pub(super) contributions: Vec<AuditEntropyView>,
    pub(super) seed: String,
    pub(super) deck: Vec<CardView>,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
pub(super) struct HandResultView {
    pub(super) kind: &'static str,
    pub(super) awards: Vec<AwardView>,
    pub(super) revealed: Vec<Option<[CardView; 2]>>,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
pub(super) struct AwardView {
    pub(super) player: usize,
    pub(super) amount: u32,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
pub(super) struct ChallengeView {
    pub(super) hand_no: u64,
    pub(super) assigned: bool,
    pub(super) draw_verified: bool,
    pub(super) hand_tag: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) commitment: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) nonce: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) catalog_root: Option<String>,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
pub(super) struct ClaimView {
    pub(super) hand_no: u64,
    pub(super) hand_tag: String,
    pub(super) commitment: String,
    pub(super) nonce: String,
    pub(super) catalog_root: String,
    pub(super) facts_salt: String,
    pub(super) facts_hash: String,
    pub(super) facts: [u8; FACT_COUNT],
    pub(super) status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) points: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) nullifier: Option<String>,
}

#[derive(Serialize)]
pub(super) struct ReceiptView {
    pub(super) protocol_version: u8,
    pub(super) room: Uuid,
    pub(super) hand_no: u64,
    pub(super) proof_system: &'static str,
    pub(super) circuit_id: &'static str,
    pub(super) bb_version: &'static str,
    pub(super) artifact_sha256: &'static str,
    pub(super) vk_sha256: &'static str,
    pub(super) hand_tag: String,
    pub(super) seat: usize,
    pub(super) commitment: String,
    pub(super) nonce: String,
    pub(super) facts_hash: String,
    pub(super) nullifier: String,
    pub(super) catalog_root: String,
    pub(super) points: u32,
    pub(super) draw_proof: String,
    pub(super) draw_public_inputs: String,
    pub(super) completion_proof: String,
    pub(super) completion_public_inputs: String,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
pub(super) struct ReadyView {
    pub(super) mine: bool,
    pub(super) count: usize,
    pub(super) players: usize,
    pub(super) complete: bool,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
pub(super) struct PlayerView {
    pub(super) stack: u32,
    pub(super) bet: u32,
    pub(super) folded: bool,
    pub(super) proof_points: u64,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
pub(super) struct CardView {
    pub(super) value: String,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
pub(super) struct ActionView {
    pub(super) fold: bool,
    pub(super) check: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) call: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) raise: Option<RaiseView>,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
pub(super) struct RaiseView {
    pub(super) min_to: u32,
    pub(super) max_to: u32,
}
