use std::error::Error;
use std::io;

use challenge_core::{POINTS, PROTOCOL_VERSION};
use game_core::Action;
use sqlx::postgres::{PgConnection, PgPoolOptions, PgQueryResult, PgRow};
use sqlx::{PgPool, Postgres, Row, Transaction, query};
use uuid::Uuid;

#[cfg(test)]
use crate::room::RoomMode;
use crate::room::{FactCommitment, RoomConfig};

type DbResult<T> = Result<T, Box<dyn Error + Send + Sync>>;

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!();

pub struct NewHand<'a> {
    pub id: Uuid,
    pub no: u64,
    pub seed: &'a [u8; 32],
    pub dealer: usize,
    pub stacks: &'a [u32],
    pub encrypted: bool,
}

pub struct NewChallenge {
    pub room: Uuid,
    pub hand_no: u64,
    pub seat: usize,
    pub hand_tag: [u8; 32],
    pub commitment: [u8; 32],
}

pub struct ChallengeEntropy {
    pub room: Uuid,
    pub hand_no: u64,
    pub seat: usize,
    pub hand_tag: [u8; 32],
    pub commitment: [u8; 32],
    pub nonce: [u8; 32],
    pub catalog_root: [u8; 32],
    pub rev: u64,
    pub next_rev: u64,
}

pub struct PendingChallenge {
    pub room: Uuid,
    pub hand_no: u64,
    pub seat: usize,
    pub hand_tag: [u8; 32],
    pub commitment: [u8; 32],
    pub rev: u64,
}

pub struct DrawUpdate {
    pub room: Uuid,
    pub hand_no: u64,
    pub seat: usize,
    pub hand_tag: [u8; 32],
    pub commitment: [u8; 32],
    pub nonce: [u8; 32],
    pub catalog_root: [u8; 32],
    pub proof: Vec<u8>,
    pub public_inputs: Vec<u8>,
    pub rev: u64,
    pub next_rev: u64,
}

pub struct ClaimUpdate {
    pub room: Uuid,
    pub hand_no: u64,
    pub seat: usize,
    pub hand_tag: [u8; 32],
    pub commitment: [u8; 32],
    pub nonce: [u8; 32],
    pub catalog_root: [u8; 32],
    pub facts_salt: [u8; 32],
    pub facts_hash: [u8; 32],
    pub nullifier: [u8; 32],
    pub proof: Vec<u8>,
    pub public_inputs: Vec<u8>,
    pub points: u32,
    pub prior_points: u64,
    pub next_points: u64,
    pub bonuses: Option<Vec<u32>>,
    pub rev: u64,
    pub next_rev: u64,
}

pub struct NewAction<'a> {
    pub room: Uuid,
    pub hand: Uuid,
    pub hand_no: u64,
    pub seq: u64,
    pub player: usize,
    pub action: Action,
    pub facts: Option<&'a [FactCommitment]>,
    pub rev: u64,
    pub next_rev: u64,
}

pub struct NewAdmission<'a> {
    pub id: Uuid,
    pub room: Uuid,
    pub seat: usize,
    pub token_hash: &'a [u8; 32],
    pub account: &'a str,
    pub table_id: &'a str,
    pub entry_id: &'a str,
    pub amount: u32,
    pub config: RoomConfig,
    pub entropy: &'a [u8; 32],
    pub name: &'a str,
}

#[derive(Clone)]
pub struct StoredAdmission {
    pub id: Uuid,
    pub room: Uuid,
    pub seat: i32,
    pub expired: bool,
    pub token_hash: Vec<u8>,
    pub account: String,
    pub table_id: String,
    pub entry_id: String,
    pub amount: i64,
    pub players: i32,
    pub stack: i64,
    pub small_blind: i64,
    pub big_blind: i64,
    pub total_hands: i32,
    pub entropy: Vec<u8>,
    pub name: String,
    pub status: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NewSettlement {
    pub room: Uuid,
    pub table_id: String,
    pub recipients: [String; 6],
    pub payouts: [u32; 6],
}

#[derive(Clone)]
pub struct StoredSettlement {
    pub room: Uuid,
    pub kind: String,
    pub table_id: String,
    pub recipients: Vec<String>,
    pub payouts: Vec<i64>,
    pub status: String,
    pub tx_hash: Option<String>,
}

#[derive(Clone)]
pub struct StoredRoom {
    pub id: Uuid,
    pub mode: String,
    pub players: i32,
    pub stack: i64,
    pub small_blind: i64,
    pub big_blind: i64,
    pub total_hands: i32,
    pub challenge_awarded: bool,
    pub rev: i64,
    pub seats: Vec<StoredSeat>,
    pub hand: Option<StoredHand>,
    pub challenges: Vec<StoredChallenge>,
    pub settlement: Option<StoredSettlement>,
}

#[derive(Clone)]
pub struct StoredSeat {
    pub seat: i32,
    pub name: String,
    pub token_hash: Vec<u8>,
    pub ready_hand: Option<Uuid>,
    pub proof_points: i64,
    pub challenge_bonus: i64,
    pub aztec_account: Option<String>,
    pub aztec_entry: Option<String>,
    pub aztec_amount: Option<i64>,
}

#[derive(Clone)]
pub struct StoredHand {
    pub id: Uuid,
    pub hand_no: i64,
    pub seed: Vec<u8>,
    pub dealer: i32,
    pub stacks: Vec<i64>,
    pub actions: Vec<StoredAction>,
    pub final_deck: Option<Vec<u8>>,
    pub legacy_seed: bool,
}

#[derive(Clone)]
pub struct StoredAction {
    pub seq: i64,
    pub player: i32,
    pub action: String,
    pub raise_to: Option<i64>,
}

#[derive(Clone)]
pub struct StoredChallenge {
    pub hand_no: i64,
    pub seat: i32,
    pub version: i32,
    pub hand_tag: Vec<u8>,
    pub commitment: Vec<u8>,
    pub nonce: Vec<u8>,
    pub catalog_root: Vec<u8>,
    pub draw_proof: Option<Vec<u8>>,
    pub draw_public_inputs: Option<Vec<u8>>,
    pub draw_verified: bool,
    pub facts_salt: Option<Vec<u8>>,
    pub facts_hash: Option<Vec<u8>>,
    pub nullifier: Option<Vec<u8>>,
    pub points: Option<i64>,
    pub completion_proof: Option<Vec<u8>>,
    pub completion_public_inputs: Option<Vec<u8>>,
    pub claimed: bool,
}

pub struct ProofReceipt {
    pub room: Uuid,
    pub hand_no: i64,
    pub hand_tag: Vec<u8>,
    pub seat: i32,
    pub commitment: Vec<u8>,
    pub nonce: Vec<u8>,
    pub facts_hash: Vec<u8>,
    pub nullifier: Vec<u8>,
    pub catalog_root: Vec<u8>,
    pub points: i64,
    pub draw_proof: Option<Vec<u8>>,
    pub draw_public_inputs: Option<Vec<u8>>,
    pub completion_proof: Vec<u8>,
    pub completion_public_inputs: Vec<u8>,
}

pub struct PublishedProof {
    pub room: Uuid,
    pub hand_no: i64,
    pub seat: i32,
    pub hand_tag: Vec<u8>,
    pub commitment: Vec<u8>,
    pub nonce: Vec<u8>,
    pub catalog_root: Vec<u8>,
    pub facts_hash: Option<Vec<u8>>,
    pub nullifier: Option<Vec<u8>>,
    pub proof: Vec<u8>,
    pub public_inputs: Vec<u8>,
}

pub struct StoredHandMeta {
    pub hand_no: i64,
    pub dealer: i32,
}

pub struct StoredProofMeta {
    pub hand_no: i64,
    pub seat: i32,
    pub finished: bool,
    pub draw_published: bool,
    pub completion_published: bool,
    pub nullifier: Option<Vec<u8>>,
}

pub struct StoredClaim {
    pub version: i32,
    pub hand_tag: Vec<u8>,
    pub commitment: Vec<u8>,
    pub nonce: Vec<u8>,
    pub catalog_root: Vec<u8>,
    pub facts_salt: Vec<u8>,
    pub facts_hash: Vec<u8>,
    pub claimed: bool,
}

pub struct StoredDraw {
    pub version: i32,
    pub hand_tag: Vec<u8>,
    pub commitment: Vec<u8>,
    pub nonce: Vec<u8>,
    pub catalog_root: Vec<u8>,
    pub verified: bool,
}

#[derive(Clone)]
pub struct Db {
    pool: PgPool,
}

impl Db {
    pub async fn connect(url: &str) -> DbResult<Self> {
        let pool = PgPoolOptions::new().connect(url).await?;

        MIGRATOR.run(&pool).await?;
        Ok(Self { pool })
    }

    pub async fn reserve_aztec(&self, admission: NewAdmission<'_>) -> DbResult<()> {
        query(
            "INSERT INTO aztec_admissions (id, room_id, seat, token_hash, account, table_id, \
             entry_id, amount, players, stack, small_blind, big_blind, total_hands, entropy, name) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)",
        )
        .bind(admission.id)
        .bind(admission.room)
        .bind(i32::try_from(admission.seat)?)
        .bind(admission.token_hash.as_slice())
        .bind(admission.account)
        .bind(admission.table_id)
        .bind(admission.entry_id)
        .bind(i64::from(admission.amount))
        .bind(i32::try_from(admission.config.players)?)
        .bind(i64::from(admission.config.stack))
        .bind(i64::from(admission.config.small_blind))
        .bind(i64::from(admission.config.big_blind))
        .bind(i32::try_from(admission.config.hands)?)
        .bind(admission.entropy.as_slice())
        .bind(admission.name)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn has_aztec_state(&self) -> DbResult<bool> {
        let row = query(
            "SELECT EXISTS ( \
                 SELECT 1 FROM rooms WHERE mode = 'aztec' AND NOT EXISTS ( \
                     SELECT 1 FROM aztec_settlements \
                     WHERE aztec_settlements.room_id = rooms.id AND status = 'confirmed' \
                 ) \
             ) OR EXISTS ( \
                 SELECT 1 FROM aztec_admissions WHERE status IN ('reserved', 'authorized') \
             ) OR EXISTS ( \
                 SELECT 1 FROM aztec_settlements WHERE status != 'confirmed' \
             ) AS present",
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(row.try_get("present")?)
    }

    pub async fn aztec_admission(
        &self,
        id: Uuid,
        token_hash: &[u8; 32],
    ) -> DbResult<Option<StoredAdmission>> {
        query(
            "SELECT id, room_id, seat, expires_at <= now() AS expired, token_hash, account, table_id, \
             entry_id, amount, players, stack, small_blind, big_blind, total_hands, \
             entropy, name, status \
             FROM aztec_admissions WHERE id = $1 AND token_hash = $2",
        )
        .bind(id)
        .bind(token_hash.as_slice())
        .fetch_optional(&self.pool)
        .await?
        .map(stored_admission)
        .transpose()
    }

    pub async fn authorize_aztec(&self, id: Uuid, token_hash: &[u8; 32], tx: &str) -> DbResult<()> {
        let changed = query(
            "UPDATE aztec_admissions SET status = 'authorized', authorized_tx = $3, \
             updated_at = now() WHERE id = $1 AND token_hash = $2 AND status = 'reserved'",
        )
        .bind(id)
        .bind(token_hash.as_slice())
        .bind(tx)
        .execute(&self.pool)
        .await?;

        one_row(changed)?;
        Ok(())
    }

    pub async fn expired_aztec_admission(
        &self,
        room: Uuid,
        seat: usize,
    ) -> DbResult<Option<StoredAdmission>> {
        query(
            "SELECT id, room_id, seat, expires_at <= now() AS expired, token_hash, account, table_id, \
             entry_id, amount, players, stack, small_blind, big_blind, total_hands, \
             entropy, name, status \
             FROM aztec_admissions WHERE room_id = $1 AND seat = $2 \
             AND status IN ('reserved', 'authorized') AND expires_at <= now()",
        )
        .bind(room)
        .bind(i32::try_from(seat)?)
        .fetch_optional(&self.pool)
        .await?
        .map(stored_admission)
            .transpose()
    }

    pub async fn expired_aztec_admissions(&self) -> DbResult<Vec<StoredAdmission>> {
        query(
            "SELECT id, room_id, seat, expires_at <= now() AS expired, token_hash, account, \
             table_id, entry_id, amount, players, stack, small_blind, big_blind, \
             total_hands, entropy, name, status FROM aztec_admissions \
             WHERE status IN ('reserved', 'authorized') AND expires_at <= now() \
             ORDER BY CASE status WHEN 'authorized' THEN 0 ELSE 1 END, created_at LIMIT 1",
        )
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(stored_admission)
        .collect()
    }

    pub async fn fail_aztec_admission(&self, id: Uuid) -> DbResult<()> {
        let changed = query(
            "UPDATE aztec_admissions SET status = 'failed', updated_at = now() \
             WHERE id = $1 AND status IN ('reserved', 'authorized')",
        )
        .bind(id)
        .execute(&self.pool)
        .await?;
        one_row(changed)?;
        Ok(())
    }

    pub async fn finish_deck_with_settlement(
        &self,
        room: Uuid,
        hand_no: u64,
        transcript: &[u8],
        deck: &[u8; 52],
        facts: &[FactCommitment],
        settlement: Option<&NewSettlement>,
    ) -> DbResult<()> {
        let mut tx = self.pool.begin().await?;
        let changed = query(
            "UPDATE deck_transcripts SET transcript = $3, final_deck = $4, completed_at = now() \
             WHERE room_id = $1 AND hand_no = $2 AND completed_at IS NULL",
        )
        .bind(room)
        .bind(i64::try_from(hand_no)?)
        .bind(transcript)
        .bind(deck.as_slice())
        .execute(&mut *tx)
        .await?;
        one_row(changed)?;

        for fact in facts {
            let changed = query(
                "UPDATE challenge_assignments SET facts_salt = $4, facts_hash = $5 \
                 WHERE room_id = $1 AND hand_no = $2 AND seat = $3 \
                 AND facts_hash IS NULL",
            )
            .bind(room)
            .bind(i64::try_from(hand_no)?)
            .bind(i32::try_from(fact.seat)?)
            .bind(fact.salt.as_slice())
            .bind(fact.value.as_slice())
            .execute(&mut *tx)
            .await?;

            one_row(changed)?;
        }

        if let Some(settlement) = settlement {
            insert_settlement(&mut tx, settlement).await?;
        }

        tx.commit().await?;
        Ok(())
    }

    pub async fn deck_audit(&self, room: Uuid, hand_no: u64) -> DbResult<Option<Vec<u8>>> {
        Ok(
            query("SELECT transcript FROM deck_transcripts WHERE room_id = $1 AND hand_no = $2")
                .bind(room)
                .bind(i64::try_from(hand_no)?)
                .fetch_optional(&self.pool)
                .await?
                .and_then(|row| row.get("transcript")),
        )
    }

    #[cfg(test)]
    pub async fn incomplete_rooms(&self) -> DbResult<u64> {
        let row = query(
            "SELECT COUNT(DISTINCT room_id) AS count FROM deck_transcripts \
             WHERE completed_at IS NULL AND NOT EXISTS ( \
                 SELECT 1 FROM aztec_settlements \
                 WHERE aztec_settlements.room_id = deck_transcripts.room_id \
             )",
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(u64::try_from(row.try_get::<i64, _>("count")?)?)
    }

    pub async fn interrupt_incomplete_rooms(&self) -> DbResult<u64> {
        Ok(query(
            "INSERT INTO room_interruptions (room_id, hand_no, reason) \
             SELECT room_id, MIN(hand_no), 'server_restart' FROM deck_transcripts \
             WHERE completed_at IS NULL GROUP BY room_id \
             ON CONFLICT (room_id) DO NOTHING",
        )
        .execute(&self.pool)
        .await?
        .rows_affected())
    }

    pub async fn public_room_id(&self, code: &str) -> DbResult<Option<Uuid>> {
        if let Ok(id) = Uuid::parse_str(code) {
            return Ok(query("SELECT id FROM rooms WHERE id = $1")
                .bind(id)
                .fetch_optional(&self.pool)
                .await?
                .map(|row| row.get("id")));
        }
        if code.len() != 8 || !code.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Ok(None);
        }
        let rows = query(
            "SELECT id FROM rooms WHERE upper(left(replace(id::text, '-', ''), 8)) = $1 LIMIT 2",
        )
        .bind(code.to_ascii_uppercase())
        .fetch_all(&self.pool)
        .await?;
        Ok(if rows.len() == 1 {
            Some(rows[0].get("id"))
        } else {
            None
        })
    }

    #[cfg(test)]
    pub async fn interrupted(&self, room: Uuid) -> DbResult<bool> {
        Ok(
            query("SELECT room_id FROM room_interruptions WHERE room_id = $1")
                .bind(room)
                .fetch_optional(&self.pool)
                .await?
                .is_some(),
        )
    }

    pub async fn interruption_reason(&self, room: Uuid) -> DbResult<Option<String>> {
        Ok(
            query("SELECT reason FROM room_interruptions WHERE room_id = $1")
                .bind(room)
                .fetch_optional(&self.pool)
                .await?
                .map(|row| row.get("reason")),
        )
    }

    pub async fn retire_idle_room(
        &self,
        room: Uuid,
        hand: u64,
        completed: Option<u64>,
    ) -> DbResult<()> {
        query("INSERT INTO room_interruptions (room_id, hand_no, reason, last_completed_hand) VALUES ($1, $2, 'idle_timeout', $3) ON CONFLICT (room_id) DO NOTHING")
            .bind(room).bind(i64::try_from(hand)?).bind(completed.map(i64::try_from).transpose()?).execute(&self.pool).await?;
        Ok(())
    }

    pub async fn last_completed_deck(&self, room: Uuid) -> DbResult<Option<u64>> {
        let row = query("SELECT greatest((SELECT max(hand_no) FROM deck_transcripts WHERE room_id = $1 AND completed_at IS NOT NULL), (SELECT last_completed_hand FROM room_interruptions WHERE room_id = $1)) AS hand_no")
            .bind(room).fetch_one(&self.pool).await?;
        row.get::<Option<i64>, _>("hand_no")
            .map(u64::try_from)
            .transpose()
            .map_err(Into::into)
    }

    pub async fn ready(&self) -> bool {
        matches!(
            tokio::time::timeout(
                std::time::Duration::from_secs(2),
                query("SELECT 1").execute(&self.pool)
            )
            .await,
            Ok(Ok(_))
        )
    }

    pub async fn creation_matches(
        &self,
        id: Uuid,
        token: &[u8; 32],
        config: RoomConfig,
        mode: &str,
        name: &str,
        entropy: Option<&str>,
    ) -> DbResult<bool> {
        let row = query("SELECT r.mode, r.players, r.stack, r.small_blind, r.big_blind, r.total_hands, s.name, s.token_hash, e.share FROM rooms r JOIN seats s ON s.room_id = r.id AND s.seat = 0 LEFT JOIN hand_entropy e ON e.room_id = r.id AND e.hand_no = 0 AND e.seat = 0 WHERE r.id = $1")
            .bind(id).fetch_one(&self.pool).await?;
        let share: Option<Vec<u8>> = row.get("share");
        Ok(row.get::<String, _>("mode") == mode
            && row.get::<i32, _>("players") == config.players as i32
            && row.get::<i64, _>("stack") == i64::from(config.stack)
            && row.get::<i64, _>("small_blind") == i64::from(config.small_blind)
            && row.get::<i64, _>("big_blind") == i64::from(config.big_blind)
            && row.get::<i32, _>("total_hands") == config.hands as i32
            && row.get::<String, _>("name") == name
            && row.get::<Vec<u8>, _>("token_hash") == token
            && (mode == "single"
                || entropy
                    .and_then(crate::decode_hex)
                    .as_ref()
                    .map(|s| s.as_slice())
                    == share.as_deref()))
    }

    pub async fn join_matches(
        &self,
        id: Uuid,
        seat: usize,
        name: &str,
        share: &[u8; 32],
    ) -> DbResult<bool> {
        let row = query("SELECT s.name, e.share FROM seats s JOIN hand_entropy e ON e.room_id = s.room_id AND e.seat = s.seat AND e.hand_no = 0 WHERE s.room_id = $1 AND s.seat = $2")
            .bind(id).bind(i32::try_from(seat)?).fetch_optional(&self.pool).await?;
        Ok(row.is_some_and(|row| {
            row.get::<String, _>("name") == name && row.get::<Vec<u8>, _>("share") == share
        }))
    }

    pub async fn stage_aztec_refunds(&self) -> DbResult<u64> {
        let mut tx = self.pool.begin().await?;
        let rooms = query(
            "SELECT rooms.id, rooms.players FROM rooms \
             WHERE rooms.mode = 'aztec' \
             AND EXISTS ( \
                 SELECT 1 FROM deck_transcripts \
                 WHERE deck_transcripts.room_id = rooms.id \
                 AND deck_transcripts.completed_at IS NULL \
             ) \
             AND NOT EXISTS ( \
                 SELECT 1 FROM aztec_settlements \
                 WHERE aztec_settlements.room_id = rooms.id \
             ) \
             AND NOT EXISTS ( \
                 SELECT 1 FROM aztec_admissions \
                 WHERE aztec_admissions.room_id = rooms.id \
                 AND aztec_admissions.status IN ('reserved', 'authorized') \
             ) ORDER BY rooms.id FOR UPDATE OF rooms",
        )
        .fetch_all(&mut *tx)
        .await?;
        let mut count = 0u64;

        for room in rooms {
            let id: Uuid = room.try_get("id")?;
            let players = usize::try_from(room.try_get::<i32, _>("players")?)?;
            if !(2..=6).contains(&players) {
                return Err(io::Error::other("refund player count invalid").into());
            }

            let hand = query(
                "SELECT starting_stacks FROM hands WHERE room_id = $1 \
                 ORDER BY hand_no DESC LIMIT 1",
            )
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| io::Error::other("refund hand missing"))?;
            let stacks: Vec<i64> = hand.try_get("starting_stacks")?;
            if stacks.len() != players {
                return Err(io::Error::other("refund stacks mismatch").into());
            }

            let seats = query(
                "SELECT seats.seat, seats.aztec_account AS seat_account, \
                 seats.aztec_entry AS seat_entry, seats.aztec_amount AS seat_amount, \
                 admission.account, admission.entry_id, admission.amount, admission.table_id \
                 FROM seats JOIN aztec_admissions admission \
                 ON admission.room_id = seats.room_id AND admission.seat = seats.seat \
                 WHERE seats.room_id = $1 AND admission.status = 'confirmed' \
                 ORDER BY seats.seat",
            )
            .bind(id)
            .fetch_all(&mut *tx)
            .await?;
            if seats.len() != players {
                return Err(io::Error::other("refund seats mismatch").into());
            }

            let mut recipients: [String; 6] =
                core::array::from_fn(|_| format!("0x{}", "0".repeat(64)));
            let mut payouts = [0u32; 6];
            let mut table_id = None::<String>;
            let mut locked = 0u64;
            let mut paid = 0u64;

            for (index, seat) in seats.into_iter().enumerate() {
                if usize::try_from(seat.try_get::<i32, _>("seat")?)? != index {
                    return Err(io::Error::other("refund seat order mismatch").into());
                }

                let account: String = seat.try_get("account")?;
                let entry: String = seat.try_get("entry_id")?;
                let amount = u32::try_from(seat.try_get::<i64, _>("amount")?)?;
                let seat_account: Option<String> = seat.try_get("seat_account")?;
                let seat_entry: Option<String> = seat.try_get("seat_entry")?;
                let seat_amount: Option<i64> = seat.try_get("seat_amount")?;
                if seat_account.as_deref() != Some(account.as_str())
                    || seat_entry.as_deref() != Some(entry.as_str())
                    || seat_amount != Some(i64::from(amount))
                {
                    return Err(io::Error::other("refund seat binding mismatch").into());
                }

                let next_table: String = seat.try_get("table_id")?;
                if table_id.as_ref().is_some_and(|table| table != &next_table) {
                    return Err(io::Error::other("refund table mismatch").into());
                }
                table_id.get_or_insert(next_table);

                let payout = u32::try_from(stacks[index])?;
                recipients[index] = account;
                payouts[index] = payout;
                locked = locked
                    .checked_add(u64::from(amount))
                    .ok_or_else(|| io::Error::other("refund pool limit"))?;
                paid = paid
                    .checked_add(u64::from(payout))
                    .ok_or_else(|| io::Error::other("refund pool limit"))?;
            }

            if locked != paid {
                return Err(io::Error::other("refund pool mismatch").into());
            }
            let settlement = NewSettlement {
                room: id,
                table_id: table_id.ok_or_else(|| io::Error::other("refund table missing"))?,
                recipients,
                payouts,
            };
            insert_settlement_kind(&mut tx, &settlement, "refund").await?;
            count = count
                .checked_add(1)
                .ok_or_else(|| io::Error::other("refund count limit"))?;
        }

        tx.commit().await?;
        Ok(count)
    }

    #[cfg(test)]
    pub async fn create_room(
        &self,
        id: Uuid,
        config: RoomConfig,
        mode: RoomMode,
        token_hash: &[u8; 32],
    ) -> DbResult<()> {
        let mut tx = self.pool.begin().await?;

        query(
            "INSERT INTO rooms (id, mode, players, stack, small_blind, big_blind, total_hands, rev) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, 0)",
        )
        .bind(id)
        .bind(mode.text())
        .bind(i32::try_from(config.players)?)
        .bind(i64::from(config.stack))
        .bind(i64::from(config.small_blind))
        .bind(i64::from(config.big_blind))
        .bind(i32::try_from(config.hands)?)
        .execute(&mut *tx)
        .await?;
        query(
            "INSERT INTO seats (room_id, seat, name, token_hash) \
             VALUES ($1, 0, 'Player 1', $2)",
        )
        .bind(id)
        .bind(token_hash.as_slice())
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;
        Ok(())
    }

    #[cfg(test)]
    pub async fn join_room(
        &self,
        room: Uuid,
        seat: usize,
        token_hash: &[u8; 32],
        rev: u64,
        next_rev: u64,
        hand: Option<NewHand<'_>>,
    ) -> DbResult<()> {
        let mut tx = self.pool.begin().await?;

        query("INSERT INTO seats (room_id, seat, name, token_hash) VALUES ($1, $2, $3, $4)")
            .bind(room)
            .bind(i32::try_from(seat)?)
            .bind(format!("Player {}", seat + 1))
            .bind(token_hash.as_slice())
            .execute(&mut *tx)
            .await?;
        let changed = query("UPDATE rooms SET rev = $2 WHERE id = $1 AND rev = $3")
            .bind(room)
            .bind(i64::try_from(next_rev)?)
            .bind(i64::try_from(rev)?)
            .execute(&mut *tx)
            .await?;

        one_row(changed)?;

        if let Some(hand) = hand {
            let stacks: Vec<_> = hand.stacks.iter().copied().map(i64::from).collect();

            query(
                "INSERT INTO hands (id, room_id, hand_no, seed, dealer, starting_stacks) \
                 VALUES ($1, $2, $3, $4, $5, $6)",
            )
            .bind(hand.id)
            .bind(room)
            .bind(i64::try_from(hand.no)?)
            .bind(hand.seed.as_slice())
            .bind(i32::try_from(hand.dealer)?)
            .bind(stacks)
            .execute(&mut *tx)
            .await?;

            if hand.encrypted {
                query(
                    "INSERT INTO deck_transcripts (room_id, hand_no, hand_id) \
                     VALUES ($1, $2, $3)",
                )
                .bind(room)
                .bind(i64::try_from(hand.no)?)
                .bind(hand.id)
                .execute(&mut *tx)
                .await?;
            }
        }

        tx.commit().await?;
        Ok(())
    }

    pub async fn commit_challenge(&self, challenge: NewChallenge) -> DbResult<()> {
        let inserted = query(
            "INSERT INTO challenge_assignments \
             (room_id, hand_no, seat, version, hand_tag, commitment) \
             VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING",
        )
        .bind(challenge.room)
        .bind(i64::try_from(challenge.hand_no)?)
        .bind(i32::try_from(challenge.seat)?)
        .bind(i32::from(PROTOCOL_VERSION))
        .bind(challenge.hand_tag.as_slice())
        .bind(challenge.commitment.as_slice())
        .execute(&self.pool)
        .await?;

        if inserted.rows_affected() == 1 {
            return Ok(());
        }

        let row = query(
            "SELECT version, hand_tag, commitment, nonce FROM challenge_assignments \
             WHERE room_id = $1 AND hand_no = $2 AND seat = $3",
        )
        .bind(challenge.room)
        .bind(i64::try_from(challenge.hand_no)?)
        .bind(i32::try_from(challenge.seat)?)
        .fetch_one(&self.pool)
        .await?;

        if row.try_get::<i32, _>("version")? != i32::from(PROTOCOL_VERSION)
            || row.try_get::<Vec<u8>, _>("hand_tag")? != challenge.hand_tag
            || row.try_get::<Vec<u8>, _>("commitment")? != challenge.commitment
            || row.try_get::<Option<Vec<u8>>, _>("nonce")?.is_some()
        {
            return Err(io::Error::other("challenge commitment mismatch").into());
        }

        Ok(())
    }

    pub async fn finish_game(
        &self,
        room: Uuid,
        hand: Uuid,
        seat: usize,
        bonuses: Option<&[u32]>,
        rev: u64,
        next_rev: u64,
    ) -> DbResult<()> {
        let mut tx = self.pool.begin().await?;
        let changed = query(
            "UPDATE seats SET ready_hand = $3 \
             WHERE room_id = $1 AND seat = $2 AND ready_hand IS NULL",
        )
        .bind(room)
        .bind(i32::try_from(seat)?)
        .bind(hand)
        .execute(&mut *tx)
        .await?;
        one_row(changed)?;

        if let Some(bonuses) = bonuses {
            for (seat, bonus) in bonuses.iter().copied().enumerate() {
                let changed = query(
                    "UPDATE seats SET challenge_bonus = $3 \
                     WHERE room_id = $1 AND seat = $2 AND challenge_bonus = 0",
                )
                .bind(room)
                .bind(i32::try_from(seat)?)
                .bind(i64::from(bonus))
                .execute(&mut *tx)
                .await?;
                one_row(changed)?;
            }
            query("UPDATE seats SET ready_hand = NULL WHERE room_id = $1")
                .bind(room)
                .execute(&mut *tx)
                .await?;
        }

        let changed = if bonuses.is_some() {
            query(
                "UPDATE rooms SET rev = $2, challenge_awarded = TRUE \
                 WHERE id = $1 AND rev = $3 AND challenge_awarded = FALSE AND players = $4",
            )
            .bind(room)
            .bind(i64::try_from(next_rev)?)
            .bind(i64::try_from(rev)?)
            .bind(i32::try_from(bonuses.map_or(0, <[u32]>::len))?)
            .execute(&mut *tx)
            .await?
        } else {
            query(
                "UPDATE rooms SET rev = $2 \
                 WHERE id = $1 AND rev = $3 AND challenge_awarded = FALSE",
            )
            .bind(room)
            .bind(i64::try_from(next_rev)?)
            .bind(i64::try_from(rev)?)
            .execute(&mut *tx)
            .await?
        };
        one_row(changed)?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn assign_challenge(&self, challenge: ChallengeEntropy) -> DbResult<()> {
        let mut tx = self.pool.begin().await?;
        let changed = query(
            "UPDATE challenge_assignments SET nonce = $7, catalog_root = $8 \
             WHERE room_id = $1 AND hand_no = $2 AND seat = $3 AND version = $4 \
             AND hand_tag = $5 AND commitment = $6 AND nonce IS NULL",
        )
        .bind(challenge.room)
        .bind(i64::try_from(challenge.hand_no)?)
        .bind(i32::try_from(challenge.seat)?)
        .bind(i32::from(PROTOCOL_VERSION))
        .bind(challenge.hand_tag.as_slice())
        .bind(challenge.commitment.as_slice())
        .bind(challenge.nonce.as_slice())
        .bind(challenge.catalog_root.as_slice())
        .execute(&mut *tx)
        .await?;

        if changed.rows_affected() != 1 {
            return Err(io::Error::other("challenge assignment mismatch").into());
        }

        let changed = query("UPDATE rooms SET rev = $2 WHERE id = $1 AND rev = $3")
            .bind(challenge.room)
            .bind(i64::try_from(challenge.next_rev)?)
            .bind(i64::try_from(challenge.rev)?)
            .execute(&mut *tx)
            .await?;

        one_row(changed)?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn pending_challenge(&self) -> DbResult<Option<PendingChallenge>> {
        let row = query(
            "SELECT assignment.room_id, assignment.hand_no, assignment.seat, \
             assignment.hand_tag, assignment.commitment, rooms.rev \
             FROM challenge_assignments assignment \
             JOIN rooms ON rooms.id = assignment.room_id \
             WHERE assignment.nonce IS NULL \
             AND NOT EXISTS ( \
                 SELECT 1 FROM deck_transcripts \
                 WHERE deck_transcripts.room_id = assignment.room_id \
                 AND deck_transcripts.completed_at IS NULL \
             ) \
             AND assignment.hand_no = ( \
                 SELECT MAX(hands.hand_no) + 1 FROM hands \
                 WHERE hands.room_id = assignment.room_id \
             ) \
             ORDER BY assignment.room_id, assignment.hand_no, assignment.seat LIMIT 1",
        )
        .fetch_optional(&self.pool)
        .await?;

        row.map(|row| {
            let hand_tag = row
                .try_get::<Vec<u8>, _>("hand_tag")?
                .try_into()
                .map_err(|_| io::Error::other("invalid pending challenge"))?;
            let commitment = row
                .try_get::<Vec<u8>, _>("commitment")?
                .try_into()
                .map_err(|_| io::Error::other("invalid pending challenge"))?;

            Ok(PendingChallenge {
                room: row.try_get("room_id")?,
                hand_no: u64::try_from(row.try_get::<i64, _>("hand_no")?)?,
                seat: usize::try_from(row.try_get::<i32, _>("seat")?)?,
                hand_tag,
                commitment,
                rev: u64::try_from(row.try_get::<i64, _>("rev")?)?,
            })
        })
        .transpose()
    }

    pub async fn draw(&self, draw: DrawUpdate) -> DbResult<()> {
        let mut tx = self.pool.begin().await?;
        let changed = query(
            "UPDATE challenge_assignments \
             SET draw_proof = $4, draw_public_inputs = $5, draw_verified_at = now() \
             WHERE room_id = $1 AND hand_no = $2 AND seat = $3 \
             AND version = $6 AND hand_tag = $7 AND commitment = $8 \
             AND nonce = $9 AND catalog_root = $10 AND draw_verified_at IS NULL",
        )
        .bind(draw.room)
        .bind(i64::try_from(draw.hand_no)?)
        .bind(i32::try_from(draw.seat)?)
        .bind(draw.proof)
        .bind(draw.public_inputs)
        .bind(i32::from(PROTOCOL_VERSION))
        .bind(draw.hand_tag.as_slice())
        .bind(draw.commitment.as_slice())
        .bind(draw.nonce.as_slice())
        .bind(draw.catalog_root.as_slice())
        .execute(&mut *tx)
        .await?;

        if changed.rows_affected() != 1 {
            return Err(io::Error::other("challenge draw mismatch").into());
        }

        let changed = query("UPDATE rooms SET rev = $2 WHERE id = $1 AND rev = $3")
            .bind(draw.room)
            .bind(i64::try_from(draw.next_rev)?)
            .bind(i64::try_from(draw.rev)?)
            .execute(&mut *tx)
            .await?;

        one_row(changed)?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn claim(&self, claim: ClaimUpdate) -> DbResult<()> {
        let mut tx = self.pool.begin().await?;
        let row = query(
            "SELECT version, hand_tag, commitment, nonce, catalog_root, \
             facts_salt, facts_hash, nullifier \
             FROM challenge_assignments \
             WHERE room_id = $1 AND hand_no = $2 AND seat = $3 FOR UPDATE",
        )
        .bind(claim.room)
        .bind(i64::try_from(claim.hand_no)?)
        .bind(i32::try_from(claim.seat)?)
        .fetch_one(&mut *tx)
        .await?;

        if row.try_get::<i32, _>("version")? != i32::from(PROTOCOL_VERSION)
            || row.try_get::<Vec<u8>, _>("hand_tag")? != claim.hand_tag
            || row.try_get::<Vec<u8>, _>("commitment")? != claim.commitment
            || row.try_get::<Vec<u8>, _>("nonce")? != claim.nonce
            || row.try_get::<Vec<u8>, _>("catalog_root")? != claim.catalog_root
            || row.try_get::<Option<Vec<u8>>, _>("facts_salt")? != Some(claim.facts_salt.to_vec())
            || row.try_get::<Option<Vec<u8>>, _>("facts_hash")? != Some(claim.facts_hash.to_vec())
            || row.try_get::<Option<Vec<u8>>, _>("nullifier")?.is_some()
        {
            return Err(io::Error::other("challenge claim mismatch").into());
        }

        let changed = query(
            "UPDATE challenge_assignments \
             SET nullifier = $4, points = $5, completion_proof = $6, \
             completion_public_inputs = $7, claimed_at = now() \
             WHERE room_id = $1 AND hand_no = $2 AND seat = $3 AND nullifier IS NULL",
        )
        .bind(claim.room)
        .bind(i64::try_from(claim.hand_no)?)
        .bind(i32::try_from(claim.seat)?)
        .bind(claim.nullifier.as_slice())
        .bind(i64::from(claim.points))
        .bind(claim.proof)
        .bind(claim.public_inputs)
        .execute(&mut *tx)
        .await?;

        one_row(changed)?;

        let changed = query(
            "UPDATE seats SET proof_points = $3 \
             WHERE room_id = $1 AND seat = $2 AND proof_points = $4",
        )
        .bind(claim.room)
        .bind(i32::try_from(claim.seat)?)
        .bind(i64::try_from(claim.next_points)?)
        .bind(i64::try_from(claim.prior_points)?)
        .execute(&mut *tx)
        .await?;

        if changed.rows_affected() != 1 {
            return Err(io::Error::other("seat points mismatch").into());
        }

        if let Some(bonuses) = &claim.bonuses {
            for (seat, bonus) in bonuses.iter().copied().enumerate() {
                let changed =
                    query("UPDATE seats SET challenge_bonus = $3 WHERE room_id = $1 AND seat = $2")
                        .bind(claim.room)
                        .bind(i32::try_from(seat)?)
                        .bind(i64::from(bonus))
                        .execute(&mut *tx)
                        .await?;

                one_row(changed)?;
            }
        }

        let changed = query(
            "UPDATE rooms SET rev = $2 \
             WHERE id = $1 AND rev = $3 AND challenge_awarded = $4",
        )
        .bind(claim.room)
        .bind(i64::try_from(claim.next_rev)?)
        .bind(i64::try_from(claim.rev)?)
        .bind(claim.bonuses.is_some())
        .execute(&mut *tx)
        .await?;

        one_row(changed)?;
        tx.commit().await?;
        Ok(())
    }

    #[cfg(test)]
    pub async fn append_action(&self, action: NewAction<'_>) -> DbResult<()> {
        self.append_action_with_settlement(action, None).await
    }

    #[cfg(test)]
    pub async fn append_action_with_settlement(
        &self,
        action: NewAction<'_>,
        settlement: Option<&NewSettlement>,
    ) -> DbResult<()> {
        self.append_action_inner(action, settlement, false)
            .await
            .map(|_| ())
    }

    pub async fn append_scored_action_with_settlement(
        &self,
        action: NewAction<'_>,
        settlement: Option<&NewSettlement>,
        score_fold: bool,
    ) -> DbResult<Option<u64>> {
        self.append_action_inner(action, settlement, score_fold)
            .await
    }

    async fn append_action_inner(
        &self,
        action: NewAction<'_>,
        settlement: Option<&NewSettlement>,
        score_fold: bool,
    ) -> DbResult<Option<u64>> {
        let mut tx = self.pool.begin().await?;
        let (name, raise_to) = action_data(action.action);

        query(
            "INSERT INTO hand_actions (hand_id, seq, player, action, raise_to) \
             VALUES ($1, $2, $3, $4, $5)",
        )
        .bind(action.hand)
        .bind(i64::try_from(action.seq)?)
        .bind(i32::try_from(action.player)?)
        .bind(name)
        .bind(raise_to)
        .execute(&mut *tx)
        .await?;

        let score = if score_fold {
            let rows = query(
                "SELECT hands.hand_no FROM hand_actions \
                 JOIN hands ON hands.id = hand_actions.hand_id \
                 WHERE hands.room_id = $1 AND hand_actions.player = $2 \
                 AND hand_actions.action = 'fold' AND hands.hand_no <= $3 \
                 ORDER BY hands.hand_no DESC",
            )
            .bind(action.room)
            .bind(i32::try_from(action.player)?)
            .bind(i64::try_from(action.hand_no)?)
            .fetch_all(&mut *tx)
            .await?;
            let mut expected = i64::try_from(action.hand_no)?;
            let mut streak = 0u32;
            for row in rows {
                if row.try_get::<i64, _>("hand_no")? != expected {
                    break;
                }
                streak = streak.saturating_add(1);
                if expected == 0 {
                    break;
                }
                expected -= 1;
            }
            let penalty = fold_penalty(streak);
            let row = query(
                "UPDATE seats SET proof_points = GREATEST(0, proof_points - $3) \
                 WHERE room_id = $1 AND seat = $2 RETURNING proof_points",
            )
            .bind(action.room)
            .bind(i32::try_from(action.player)?)
            .bind(i64::try_from(penalty.min(i64::MAX as u64))?)
            .fetch_one(&mut *tx)
            .await?;
            Some(u64::try_from(row.try_get::<i64, _>("proof_points")?)?)
        } else {
            None
        };

        if let Some(facts) = action.facts {
            for fact in facts {
                let changed = query(
                    "UPDATE challenge_assignments SET facts_salt = $4, facts_hash = $5 \
                     WHERE room_id = $1 AND hand_no = $2 AND seat = $3 \
                     AND facts_hash IS NULL",
                )
                .bind(action.room)
                .bind(i64::try_from(action.hand_no)?)
                .bind(i32::try_from(fact.seat)?)
                .bind(fact.salt.as_slice())
                .bind(fact.value.as_slice())
                .execute(&mut *tx)
                .await?;

                if changed.rows_affected() != 1 {
                    return Err(io::Error::other("challenge facts mismatch").into());
                }
            }
        }

        let changed = query("UPDATE rooms SET rev = $2 WHERE id = $1 AND rev = $3")
            .bind(action.room)
            .bind(i64::try_from(action.next_rev)?)
            .bind(i64::try_from(action.rev)?)
            .execute(&mut *tx)
            .await?;

        one_row(changed)?;
        if let Some(settlement) = settlement {
            insert_settlement(&mut tx, settlement).await?;
        }
        tx.commit().await?;
        Ok(score)
    }

    pub async fn load_rooms(&self) -> DbResult<Vec<StoredRoom>> {
        let rows = query(
            "SELECT id, mode, players, stack, small_blind, big_blind, total_hands, \
             challenge_awarded, rev FROM rooms WHERE NOT EXISTS (SELECT 1 FROM room_interruptions WHERE room_interruptions.room_id = rooms.id) AND NOT EXISTS ( \
                 SELECT 1 FROM deck_transcripts \
                 WHERE deck_transcripts.room_id = rooms.id \
                 AND deck_transcripts.completed_at IS NULL \
             ) ORDER BY id",
        )
        .fetch_all(&self.pool)
        .await?;
        let mut rooms = Vec::with_capacity(rows.len());

        for row in rows {
            let id = row.try_get("id")?;
            let seats = self.load_seats(id).await?;
            let hand = self.load_hand(id).await?;
            let challenges = self.load_challenges(id).await?;
            let settlement = self.load_settlement(id).await?;

            rooms.push(StoredRoom {
                id,
                mode: row.try_get("mode")?,
                players: row.try_get("players")?,
                stack: row.try_get("stack")?,
                small_blind: row.try_get("small_blind")?,
                big_blind: row.try_get("big_blind")?,
                total_hands: row.try_get("total_hands")?,
                challenge_awarded: row.try_get("challenge_awarded")?,
                rev: row.try_get("rev")?,
                seats,
                hand,
                challenges,
                settlement,
            });
        }

        Ok(rooms)
    }

    async fn load_seats(&self, room: Uuid) -> DbResult<Vec<StoredSeat>> {
        let rows = query(
            "SELECT seat, name, token_hash, ready_hand, proof_points, challenge_bonus, \
             aztec_account, aztec_entry, aztec_amount \
             FROM seats WHERE room_id = $1 ORDER BY seat",
        )
        .bind(room)
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter()
            .map(|row| {
                Ok(StoredSeat {
                    seat: row.try_get("seat")?,
                    name: row.try_get("name")?,
                    token_hash: row.try_get("token_hash")?,
                    ready_hand: row.try_get("ready_hand")?,
                    proof_points: row.try_get("proof_points")?,
                    challenge_bonus: row.try_get("challenge_bonus")?,
                    aztec_account: row.try_get("aztec_account")?,
                    aztec_entry: row.try_get("aztec_entry")?,
                    aztec_amount: row.try_get("aztec_amount")?,
                })
            })
            .collect()
    }

    async fn load_settlement(&self, room: Uuid) -> DbResult<Option<StoredSettlement>> {
        query(
            "SELECT room_id, kind, table_id, recipients, payouts, status, tx_hash \
             FROM aztec_settlements WHERE room_id = $1",
        )
        .bind(room)
        .fetch_optional(&self.pool)
        .await?
        .map(|row| {
            Ok(StoredSettlement {
                room: row.try_get("room_id")?,
                kind: row.try_get("kind")?,
                table_id: row.try_get("table_id")?,
                recipients: row.try_get("recipients")?,
                payouts: row.try_get("payouts")?,
                status: row.try_get("status")?,
                tx_hash: row.try_get("tx_hash")?,
            })
        })
        .transpose()
    }

    async fn load_hand(&self, room: Uuid) -> DbResult<Option<StoredHand>> {
        let Some(row) = query(
            "SELECT hands.id, hands.hand_no, hands.seed, hands.dealer, hands.starting_stacks, \
            deck_transcripts.final_deck, hand_ceremonies.room_id IS NULL AS legacy_seed \
            FROM hands LEFT JOIN deck_transcripts \
             ON deck_transcripts.hand_id = hands.id \
             LEFT JOIN hand_ceremonies ON hand_ceremonies.room_id = hands.room_id \
             AND hand_ceremonies.hand_no = hands.hand_no \
             WHERE hands.room_id = $1 ORDER BY hands.hand_no DESC LIMIT 1",
        )
        .bind(room)
        .fetch_optional(&self.pool)
        .await?
        else {
            return Ok(None);
        };
        let id = row.try_get("id")?;
        let rows = query(
            "SELECT seq, player, action, raise_to FROM hand_actions \
             WHERE hand_id = $1 ORDER BY seq",
        )
        .bind(id)
        .fetch_all(&self.pool)
        .await?;
        let actions = rows
            .into_iter()
            .map(|row| {
                Ok(StoredAction {
                    seq: row.try_get("seq")?,
                    player: row.try_get("player")?,
                    action: row.try_get("action")?,
                    raise_to: row.try_get("raise_to")?,
                })
            })
            .collect::<DbResult<Vec<_>>>()?;

        Ok(Some(StoredHand {
            id,
            hand_no: row.try_get("hand_no")?,
            seed: row.try_get("seed")?,
            dealer: row.try_get("dealer")?,
            stacks: row.try_get("starting_stacks")?,
            actions,
            final_deck: row.try_get("final_deck")?,
            legacy_seed: row.try_get("legacy_seed")?,
        }))
    }

    async fn load_challenges(&self, room: Uuid) -> DbResult<Vec<StoredChallenge>> {
        let rows = query(
            "SELECT hand_no, seat, version, hand_tag, commitment, nonce, catalog_root, \
             draw_proof, draw_public_inputs, draw_verified_at IS NOT NULL AS draw_verified, \
             facts_salt, facts_hash, nullifier, points, completion_proof, completion_public_inputs, \
             claimed_at IS NOT NULL AS claimed \
             FROM challenge_assignments WHERE room_id = $1 ORDER BY hand_no, seat",
        )
        .bind(room)
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter()
            .map(|row| {
                Ok(StoredChallenge {
                    hand_no: row.try_get("hand_no")?,
                    seat: row.try_get("seat")?,
                    version: row.try_get("version")?,
                    hand_tag: row.try_get("hand_tag")?,
                    commitment: row.try_get("commitment")?,
                    nonce: row.try_get("nonce")?,
                    catalog_root: row.try_get("catalog_root")?,
                    draw_proof: row.try_get("draw_proof")?,
                    draw_public_inputs: row.try_get("draw_public_inputs")?,
                    draw_verified: row.try_get("draw_verified")?,
                    facts_salt: row.try_get("facts_salt")?,
                    facts_hash: row.try_get("facts_hash")?,
                    nullifier: row.try_get("nullifier")?,
                    points: row.try_get("points")?,
                    completion_proof: row.try_get("completion_proof")?,
                    completion_public_inputs: row.try_get("completion_public_inputs")?,
                    claimed: row.try_get("claimed")?,
                })
            })
            .collect()
    }

    pub async fn proof_receipt(&self, nullifier: &[u8; 32]) -> DbResult<Option<ProofReceipt>> {
        let row = query(
            "SELECT room_id, hand_no, hand_tag, seat, commitment, nonce, facts_hash, nullifier, \
             catalog_root, points, draw_proof, draw_public_inputs, completion_proof, \
             completion_public_inputs FROM challenge_assignments WHERE nullifier = $1",
        )
        .bind(nullifier.as_slice())
        .fetch_optional(&self.pool)
        .await?;

        row.map(|row| {
            Ok(ProofReceipt {
                room: row.try_get("room_id")?,
                hand_no: row.try_get("hand_no")?,
                hand_tag: row.try_get("hand_tag")?,
                seat: row.try_get("seat")?,
                commitment: row.try_get("commitment")?,
                nonce: row.try_get("nonce")?,
                facts_hash: row.try_get("facts_hash")?,
                nullifier: row.try_get("nullifier")?,
                catalog_root: row.try_get("catalog_root")?,
                points: row.try_get("points")?,
                draw_proof: row.try_get("draw_proof")?,
                draw_public_inputs: row.try_get("draw_public_inputs")?,
                completion_proof: row.try_get("completion_proof")?,
                completion_public_inputs: row.try_get("completion_public_inputs")?,
            })
        })
        .transpose()
    }

    pub async fn challenge_proof(
        &self,
        room: Uuid,
        hand_no: u64,
        seat: usize,
        completion: bool,
    ) -> DbResult<Option<PublishedProof>> {
        let (proof, public, published) = if completion {
            ("completion_proof", "completion_public_inputs", "claimed_at")
        } else {
            ("draw_proof", "draw_public_inputs", "draw_verified_at")
        };
        let sql = format!(
            "SELECT room_id, hand_no, seat, hand_tag, commitment, nonce, catalog_root, \
             facts_hash, nullifier, \
             {proof} AS proof, {public} AS public_inputs \
             FROM challenge_assignments WHERE room_id = $1 AND hand_no = $2 AND seat = $3 \
             AND {published} IS NOT NULL"
        );
        // accepted proof only
        let row = query(&sql)
            .bind(room)
            .bind(i64::try_from(hand_no)?)
            .bind(i32::try_from(seat)?)
            .fetch_optional(&self.pool)
            .await?;

        row.map(|row| {
            Ok(PublishedProof {
                room: row.try_get("room_id")?,
                hand_no: row.try_get("hand_no")?,
                seat: row.try_get("seat")?,
                hand_tag: row.try_get("hand_tag")?,
                commitment: row.try_get("commitment")?,
                nonce: row.try_get("nonce")?,
                catalog_root: row.try_get("catalog_root")?,
                facts_hash: row.try_get("facts_hash")?,
                nullifier: row.try_get("nullifier")?,
                proof: row.try_get("proof")?,
                public_inputs: row.try_get("public_inputs")?,
            })
        })
        .transpose()
    }

    pub async fn hand_history(&self, room: Uuid) -> DbResult<Vec<StoredHandMeta>> {
        query("SELECT hand_no, dealer FROM hands WHERE room_id = $1 ORDER BY hand_no")
            .bind(room)
            .fetch_all(&self.pool)
            .await?
            .into_iter()
            .map(|row| {
                Ok(StoredHandMeta {
                    hand_no: row.try_get("hand_no")?,
                    dealer: row.try_get("dealer")?,
                })
            })
            .collect()
    }

    pub async fn proof_history(&self, room: Uuid) -> DbResult<Vec<StoredProofMeta>> {
        query(
            "SELECT hand_no, seat, facts_hash IS NOT NULL AS finished, \
             draw_verified_at IS NOT NULL AS draw_published, \
             claimed_at IS NOT NULL AS completion_published, nullifier \
             FROM challenge_assignments WHERE room_id = $1 ORDER BY hand_no, seat",
        )
        .bind(room)
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(|row| {
            Ok(StoredProofMeta {
                hand_no: row.try_get("hand_no")?,
                seat: row.try_get("seat")?,
                finished: row.try_get("finished")?,
                draw_published: row.try_get("draw_published")?,
                completion_published: row.try_get("completion_published")?,
                nullifier: row.try_get("nullifier")?,
            })
        })
        .collect()
    }

    pub async fn pending_claim(
        &self,
        room: Uuid,
        hand_no: u64,
        seat: usize,
    ) -> DbResult<Option<StoredClaim>> {
        let row = query(
            "SELECT version, hand_tag, commitment, nonce, catalog_root, facts_salt, facts_hash, \
             nullifier IS NOT NULL AS claimed \
             FROM challenge_assignments \
             WHERE room_id = $1 AND hand_no = $2 AND seat = $3 \
             AND facts_salt IS NOT NULL AND facts_hash IS NOT NULL",
        )
        .bind(room)
        .bind(i64::try_from(hand_no)?)
        .bind(i32::try_from(seat)?)
        .fetch_optional(&self.pool)
        .await?;

        row.map(|row| {
            Ok(StoredClaim {
                version: row.try_get("version")?,
                hand_tag: row.try_get("hand_tag")?,
                commitment: row.try_get("commitment")?,
                nonce: row.try_get("nonce")?,
                catalog_root: row.try_get("catalog_root")?,
                facts_salt: row.try_get("facts_salt")?,
                facts_hash: row.try_get("facts_hash")?,
                claimed: row.try_get("claimed")?,
            })
        })
        .transpose()
    }

    pub async fn pending_draw(
        &self,
        room: Uuid,
        hand_no: u64,
        seat: usize,
    ) -> DbResult<Option<StoredDraw>> {
        let row = query(
            "SELECT version, hand_tag, commitment, nonce, catalog_root, \
             draw_verified_at IS NOT NULL AS verified \
             FROM challenge_assignments \
             WHERE room_id = $1 AND hand_no = $2 AND seat = $3 \
             AND nonce IS NOT NULL",
        )
        .bind(room)
        .bind(i64::try_from(hand_no)?)
        .bind(i32::try_from(seat)?)
        .fetch_optional(&self.pool)
        .await?;

        row.map(|row| {
            Ok(StoredDraw {
                version: row.try_get("version")?,
                hand_tag: row.try_get("hand_tag")?,
                commitment: row.try_get("commitment")?,
                nonce: row.try_get("nonce")?,
                catalog_root: row.try_get("catalog_root")?,
                verified: row.try_get("verified")?,
            })
        })
        .transpose()
    }

    pub async fn pending_aztec_settlements(&self) -> DbResult<Vec<StoredSettlement>> {
        query(
            "SELECT room_id, kind, table_id, recipients, payouts, status, tx_hash \
             FROM aztec_settlements WHERE status != 'confirmed' ORDER BY created_at",
        )
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(stored_settlement)
        .collect()
    }

    pub async fn lock_aztec_settlement(
        &self,
        room: Uuid,
    ) -> DbResult<Option<(StoredSettlement, Transaction<'static, Postgres>)>> {
        let mut db = self.pool.begin().await?;
        let row = query(
            "SELECT room_id, kind, table_id, recipients, payouts, status, tx_hash \
             FROM aztec_settlements WHERE room_id = $1 AND status != 'confirmed' \
             FOR UPDATE SKIP LOCKED",
        )
        .bind(room)
        .fetch_optional(&mut *db)
        .await?;

        match row {
            Some(row) => Ok(Some((stored_settlement(row)?, db))),
            None => {
                db.rollback().await?;
                Ok(None)
            }
        }
    }

    pub async fn fail_aztec_settlement(
        &self,
        db: &mut Transaction<'_, Postgres>,
        room: Uuid,
        error: &str,
    ) -> DbResult<()> {
        fail_settlement(db, room, error).await
    }

    pub async fn submit_aztec_settlement(
        &self,
        db: &mut Transaction<'_, Postgres>,
        room: Uuid,
        tx: &str,
    ) -> DbResult<()> {
        submit_settlement(db, room, tx).await
    }

    #[cfg(test)]
    pub async fn confirm_aztec_settlement(&self, room: Uuid, tx: &str) -> DbResult<u64> {
        let mut db = self.pool.begin().await?;
        let rev = confirm_settlement(&mut db, room, tx).await?;
        db.commit().await?;
        Ok(rev)
    }

    pub async fn confirm_locked_aztec_settlement(
        &self,
        db: &mut Transaction<'_, Postgres>,
        room: Uuid,
        tx: &str,
    ) -> DbResult<u64> {
        confirm_settlement(db, room, tx).await
    }

    pub(super) fn pool(&self) -> &PgPool {
        &self.pool
    }
}

fn stored_settlement(row: PgRow) -> DbResult<StoredSettlement> {
    Ok(StoredSettlement {
        room: row.try_get("room_id")?,
        kind: row.try_get("kind")?,
        table_id: row.try_get("table_id")?,
        recipients: row.try_get("recipients")?,
        payouts: row.try_get("payouts")?,
        status: row.try_get("status")?,
        tx_hash: row.try_get("tx_hash")?,
    })
}

async fn fail_settlement(db: &mut PgConnection, room: Uuid, error: &str) -> DbResult<()> {
    let message = error.chars().take(500).collect::<String>();
    let changed = query(
        "UPDATE aztec_settlements SET attempts = attempts + 1, last_error = $2, \
         updated_at = now() WHERE room_id = $1 AND status != 'confirmed'",
    )
    .bind(room)
    .bind(message)
    .execute(db)
    .await?;
    one_row(changed)?;
    Ok(())
}

async fn submit_settlement(db: &mut PgConnection, room: Uuid, tx: &str) -> DbResult<()> {
    let changed = query(
        "UPDATE aztec_settlements SET status = 'submitted', tx_hash = $2, \
         last_error = NULL, updated_at = now(), submitted_at = now() \
         WHERE room_id = $1 AND status IN ('pending', 'submitted')",
    )
    .bind(room)
    .bind(tx)
    .execute(db)
    .await?;
    one_row(changed)?;
    Ok(())
}

async fn confirm_settlement(db: &mut PgConnection, room: Uuid, tx: &str) -> DbResult<u64> {
    let changed = query(
        "UPDATE aztec_settlements SET status = 'confirmed', tx_hash = COALESCE(tx_hash, $2), \
         last_error = NULL, updated_at = now(), confirmed_at = now() \
         WHERE room_id = $1 AND status != 'confirmed'",
    )
    .bind(room)
    .bind(tx)
    .execute(&mut *db)
    .await?;
    one_row(changed)?;
    let row = query("UPDATE rooms SET rev = rev + 1 WHERE id = $1 RETURNING rev")
        .bind(room)
        .fetch_one(db)
        .await?;
    Ok(u64::try_from(row.try_get::<i64, _>("rev")?)?)
}

fn stored_admission(row: sqlx::postgres::PgRow) -> DbResult<StoredAdmission> {
    Ok(StoredAdmission {
        id: row.try_get("id")?,
        room: row.try_get("room_id")?,
        seat: row.try_get("seat")?,
        expired: row.try_get("expired")?,
        token_hash: row.try_get("token_hash")?,
        account: row.try_get("account")?,
        table_id: row.try_get("table_id")?,
        entry_id: row.try_get("entry_id")?,
        amount: row.try_get("amount")?,
        players: row.try_get("players")?,
        stack: row.try_get("stack")?,
        small_blind: row.try_get("small_blind")?,
        big_blind: row.try_get("big_blind")?,
        total_hands: row.try_get("total_hands")?,
        entropy: row.try_get("entropy")?,
        name: row.try_get("name")?,
        status: row.try_get("status")?,
    })
}

pub async fn insert_settlement(
    tx: &mut Transaction<'_, Postgres>,
    settlement: &NewSettlement,
) -> DbResult<()> {
    insert_settlement_kind(tx, settlement, "result").await
}

async fn insert_settlement_kind(
    tx: &mut Transaction<'_, Postgres>,
    settlement: &NewSettlement,
    kind: &str,
) -> DbResult<()> {
    let payouts = settlement
        .payouts
        .iter()
        .copied()
        .map(i64::from)
        .collect::<Vec<_>>();

    query(
        "INSERT INTO aztec_settlements (room_id, kind, table_id, recipients, payouts) \
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(settlement.room)
    .bind(kind)
    .bind(&settlement.table_id)
    .bind(settlement.recipients.as_slice())
    .bind(payouts)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

fn action_data(action: Action) -> (&'static str, Option<i64>) {
    match action {
        Action::Fold => ("fold", None),
        Action::Check => ("check", None),
        Action::Call => ("call", None),
        Action::RaiseTo(to) => ("raise_to", Some(i64::from(to))),
    }
}

fn fold_penalty(streak: u32) -> u64 {
    let base = u64::from(POINTS) / 10;
    base.checked_shl(streak.saturating_sub(1))
        .unwrap_or(u64::MAX)
}

fn one_row(result: PgQueryResult) -> DbResult<()> {
    if result.rows_affected() != 1 {
        return Err(io::Error::other("room revision mismatch").into());
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn action_values() {
        assert_eq!(action_data(Action::Fold), ("fold", None));
        assert_eq!(action_data(Action::Check), ("check", None));
        assert_eq!(action_data(Action::Call), ("call", None));
        assert_eq!(action_data(Action::RaiseTo(40)), ("raise_to", Some(40)));
    }

    #[test]
    fn consecutive_fold_penalties() {
        assert_eq!(fold_penalty(1), 2);
        assert_eq!(fold_penalty(2), 4);
        assert_eq!(fold_penalty(3), 8);
    }

    #[tokio::test]
    #[ignore = "requires TEST_DATABASE_URL"]
    async fn aztec_refund_staging() -> DbResult<()> {
        let url = std::env::var("TEST_DATABASE_URL")?;
        let db = Db::connect(&url).await?;
        let room = Uuid::new_v4();
        let hand = Uuid::new_v4();
        let table = field_id();
        let accounts = [field_id(), field_id()];
        let entries = [field_id(), field_id()];
        let tokens = [[0x11u8; 32], [0x22u8; 32]];

        let mut tx = db.pool.begin().await?;
        query(
            "INSERT INTO rooms \
             (id, mode, players, stack, small_blind, big_blind, total_hands, rev) \
             VALUES ($1, 'aztec', 2, 1000, 5, 10, 5, 0)",
        )
        .bind(room)
        .execute(&mut *tx)
        .await?;

        for seat in 0..2 {
            query(
                "INSERT INTO seats \
                 (room_id, seat, name, token_hash, aztec_account, aztec_entry, aztec_amount) \
                 VALUES ($1, $2, $3, $4, $5, $6, 1000)",
            )
            .bind(room)
            .bind(i32::try_from(seat)?)
            .bind(format!("Player {}", seat + 1))
            .bind(tokens[seat].as_slice())
            .bind(&accounts[seat])
            .bind(&entries[seat])
            .execute(&mut *tx)
            .await?;
            query(
                "INSERT INTO aztec_admissions \
                 (id, room_id, seat, token_hash, account, table_id, entry_id, amount, \
                  players, stack, small_blind, big_blind, total_hands, entropy, name, \
                  status, authorized_tx, confirmed_at) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7, 1000, 2, 1000, 5, 10, 5, \
                         $8, $9, 'confirmed', '0xtx', now())",
            )
            .bind(Uuid::new_v4())
            .bind(room)
            .bind(i32::try_from(seat)?)
            .bind(tokens[seat].as_slice())
            .bind(&accounts[seat])
            .bind(&table)
            .bind(&entries[seat])
            .bind([u8::try_from(seat)?; 32].as_slice())
            .bind(format!("Player {}", seat + 1))
            .execute(&mut *tx)
            .await?;
        }

        query(
            "INSERT INTO hands (id, room_id, hand_no, seed, dealer, starting_stacks) \
             VALUES ($1, $2, 0, $3, 0, $4)",
        )
        .bind(hand)
        .bind(room)
        .bind([0x33u8; 32].as_slice())
        .bind([1200i64, 800].as_slice())
        .execute(&mut *tx)
        .await?;
        query("INSERT INTO deck_transcripts (room_id, hand_no, hand_id) VALUES ($1, 0, $2)")
            .bind(room)
            .bind(hand)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;

        assert!(db.stage_aztec_refunds().await? >= 1);
        assert_eq!(db.stage_aztec_refunds().await?, 0);
        let stored = db.load_settlement(room).await?.expect("refund");
        assert_eq!(stored.kind, "refund");
        assert_eq!(stored.table_id, table);
        assert_eq!(&stored.recipients[..2], accounts.as_slice());
        assert_eq!(stored.payouts, vec![1200, 800, 0, 0, 0, 0]);
        assert!(
            !db.load_rooms()
                .await?
                .iter()
                .any(|stored| stored.id == room)
        );

        query("DELETE FROM aztec_admissions WHERE room_id = $1")
            .bind(room)
            .execute(&db.pool)
            .await?;
        query("DELETE FROM rooms WHERE id = $1")
            .bind(room)
            .execute(&db.pool)
            .await?;
        Ok(())
    }

    fn field_id() -> String {
        let value = Uuid::new_v4().simple().to_string();
        format!("0x{value}{value}")
    }
}
