use std::error::Error;
use std::io;

use challenge_core::PROTOCOL_VERSION;
use game_core::Action;
use sqlx::postgres::{PgPoolOptions, PgQueryResult};
use sqlx::{PgPool, Row, query};
use uuid::Uuid;

use crate::room::FactCommitment;
#[cfg(test)]
use crate::room::{RoomConfig, RoomMode};

type DbResult<T> = Result<T, Box<dyn Error + Send + Sync>>;

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!();

pub struct NewHand<'a> {
    pub id: Uuid,
    pub no: u64,
    pub seed: &'a [u8; 32],
    pub dealer: usize,
    pub stacks: &'a [u32],
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

#[derive(Clone)]
pub struct StoredRoom {
    pub id: Uuid,
    pub mode: String,
    pub players: i32,
    pub stack: i64,
    pub small_blind: i64,
    pub big_blind: i64,
    pub rev: i64,
    pub seats: Vec<StoredSeat>,
    pub hand: Option<StoredHand>,
    pub challenges: Vec<StoredChallenge>,
}

#[derive(Clone)]
pub struct StoredSeat {
    pub seat: i32,
    pub token_hash: Vec<u8>,
    pub ready_hand: Option<Uuid>,
    pub proof_points: i64,
}

#[derive(Clone)]
pub struct StoredHand {
    pub id: Uuid,
    pub hand_no: i64,
    pub seed: Vec<u8>,
    pub dealer: i32,
    pub stacks: Vec<i64>,
    pub actions: Vec<StoredAction>,
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
    pub draw_proof: Vec<u8>,
    pub draw_public_inputs: Vec<u8>,
    pub completion_proof: Vec<u8>,
    pub completion_public_inputs: Vec<u8>,
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
            "INSERT INTO rooms (id, mode, players, stack, small_blind, big_blind, rev) \
             VALUES ($1, $2, $3, $4, $5, $6, 0)",
        )
        .bind(id)
        .bind(mode.text())
        .bind(i32::try_from(config.players)?)
        .bind(i64::from(config.stack))
        .bind(i64::from(config.small_blind))
        .bind(i64::from(config.big_blind))
        .execute(&mut *tx)
        .await?;
        query("INSERT INTO seats (room_id, seat, token_hash) VALUES ($1, 0, $2)")
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

        query("INSERT INTO seats (room_id, seat, token_hash) VALUES ($1, $2, $3)")
            .bind(room)
            .bind(i32::try_from(seat)?)
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
             draw_verified_at IS NOT NULL AS draw_verified, \
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
            || !row.try_get::<bool, _>("draw_verified")?
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

        let changed = query("UPDATE rooms SET rev = $2 WHERE id = $1 AND rev = $3")
            .bind(claim.room)
            .bind(i64::try_from(claim.next_rev)?)
            .bind(i64::try_from(claim.rev)?)
            .execute(&mut *tx)
            .await?;

        one_row(changed)?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn append_action(&self, action: NewAction<'_>) -> DbResult<()> {
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
        tx.commit().await?;
        Ok(())
    }

    pub async fn load_rooms(&self) -> DbResult<Vec<StoredRoom>> {
        let rows = query(
            "SELECT id, mode, players, stack, small_blind, big_blind, rev FROM rooms ORDER BY id",
        )
        .fetch_all(&self.pool)
        .await?;
        let mut rooms = Vec::with_capacity(rows.len());

        for row in rows {
            let id = row.try_get("id")?;
            let seats = self.load_seats(id).await?;
            let hand = self.load_hand(id).await?;
            let challenges = self.load_challenges(id).await?;

            rooms.push(StoredRoom {
                id,
                mode: row.try_get("mode")?,
                players: row.try_get("players")?,
                stack: row.try_get("stack")?,
                small_blind: row.try_get("small_blind")?,
                big_blind: row.try_get("big_blind")?,
                rev: row.try_get("rev")?,
                seats,
                hand,
                challenges,
            });
        }

        Ok(rooms)
    }

    async fn load_seats(&self, room: Uuid) -> DbResult<Vec<StoredSeat>> {
        let rows = query(
            "SELECT seat, token_hash, ready_hand, proof_points \
             FROM seats WHERE room_id = $1 ORDER BY seat",
        )
        .bind(room)
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter()
            .map(|row| {
                Ok(StoredSeat {
                    seat: row.try_get("seat")?,
                    token_hash: row.try_get("token_hash")?,
                    ready_hand: row.try_get("ready_hand")?,
                    proof_points: row.try_get("proof_points")?,
                })
            })
            .collect()
    }

    async fn load_hand(&self, room: Uuid) -> DbResult<Option<StoredHand>> {
        let Some(row) = query(
            "SELECT id, hand_no, seed, dealer, starting_stacks FROM hands \
             WHERE room_id = $1 ORDER BY hand_no DESC LIMIT 1",
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

    pub(super) fn pool(&self) -> &PgPool {
        &self.pool
    }
}

fn action_data(action: Action) -> (&'static str, Option<i64>) {
    match action {
        Action::Fold => ("fold", None),
        Action::Check => ("check", None),
        Action::Call => ("call", None),
        Action::RaiseTo(to) => ("raise_to", Some(i64::from(to))),
    }
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
}
