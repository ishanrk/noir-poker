use std::error::Error;
use std::io;

use challenge_core::PROTOCOL_VERSION;
use game_core::Action;
use sqlx::postgres::{PgPoolOptions, PgQueryResult};
use sqlx::{PgPool, Row, query};
use uuid::Uuid;

type DbResult<T> = Result<T, Box<dyn Error + Send + Sync>>;

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!();

pub struct NewHand<'a> {
    pub id: Uuid,
    pub no: u64,
    pub seed: &'a [u8; 32],
    pub dealer: usize,
    pub stacks: &'a [u32],
}

pub struct ReadyUpdate<'a> {
    pub room: Uuid,
    pub hand: Uuid,
    pub seat: usize,
    pub rev: u64,
    pub next_rev: u64,
    pub next_hand: Option<NewHand<'a>>,
}

pub struct NewChallenge {
    pub room: Uuid,
    pub hand_no: u64,
    pub seat: usize,
    pub tier: u8,
    pub hand_tag: [u8; 32],
    pub commitment: [u8; 32],
    pub nonce: [u8; 32],
    pub rev: u64,
    pub next_rev: u64,
}

pub struct ClaimUpdate {
    pub room: Uuid,
    pub hand_no: u64,
    pub seat: usize,
    pub tier: u8,
    pub hand_tag: [u8; 32],
    pub commitment: [u8; 32],
    pub nonce: [u8; 32],
    pub facts_hash: [u8; 32],
    pub nullifier: [u8; 32],
    pub points: u32,
    pub prior_points: u64,
    pub next_points: u64,
    pub rev: u64,
    pub next_rev: u64,
}

#[derive(Clone)]
pub struct FactHash {
    pub seat: usize,
    pub value: [u8; 32],
}

pub struct NewAction {
    pub room: Uuid,
    pub hand: Uuid,
    pub hand_no: u64,
    pub seq: u64,
    pub player: usize,
    pub action: Action,
    pub facts: Option<Vec<FactHash>>,
    pub rev: u64,
    pub next_rev: u64,
}

#[derive(Clone)]
pub struct StoredRoom {
    pub id: Uuid,
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
    pub tier: i32,
    pub hand_tag: Vec<u8>,
    pub commitment: Vec<u8>,
    pub nonce: Vec<u8>,
    pub facts_hash: Option<Vec<u8>>,
    pub nullifier: Option<Vec<u8>>,
    pub points: Option<i64>,
    pub claimed: bool,
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

    pub async fn create_room(
        &self,
        id: Uuid,
        players: usize,
        stack: u32,
        small_blind: u32,
        big_blind: u32,
        token_hash: &[u8; 32],
    ) -> DbResult<()> {
        let mut tx = self.pool.begin().await?;

        query(
            "INSERT INTO rooms (id, players, stack, small_blind, big_blind, rev) \
             VALUES ($1, $2, $3, $4, $5, 0)",
        )
        .bind(id)
        .bind(i32::try_from(players)?)
        .bind(i64::from(stack))
        .bind(i64::from(small_blind))
        .bind(i64::from(big_blind))
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

    pub async fn ready(&self, ready: ReadyUpdate<'_>) -> DbResult<()> {
        let mut tx = self.pool.begin().await?;
        let changed = query(
            "UPDATE seats SET ready_hand = $3 \
             WHERE room_id = $1 AND seat = $2 AND ready_hand IS NULL",
        )
        .bind(ready.room)
        .bind(i32::try_from(ready.seat)?)
        .bind(ready.hand)
        .execute(&mut *tx)
        .await?;

        if changed.rows_affected() != 1 {
            return Err(io::Error::other("seat readiness mismatch").into());
        }

        if let Some(hand) = ready.next_hand {
            let stacks: Vec<_> = hand.stacks.iter().copied().map(i64::from).collect();

            query(
                "INSERT INTO hands (id, room_id, hand_no, seed, dealer, starting_stacks) \
                 VALUES ($1, $2, $3, $4, $5, $6)",
            )
            .bind(hand.id)
            .bind(ready.room)
            .bind(i64::try_from(hand.no)?)
            .bind(hand.seed.as_slice())
            .bind(i32::try_from(hand.dealer)?)
            .bind(stacks)
            .execute(&mut *tx)
            .await?;
            query("UPDATE seats SET ready_hand = NULL WHERE room_id = $1")
                .bind(ready.room)
                .execute(&mut *tx)
                .await?;
        }

        let changed = query("UPDATE rooms SET rev = $2 WHERE id = $1 AND rev = $3")
            .bind(ready.room)
            .bind(i64::try_from(ready.next_rev)?)
            .bind(i64::try_from(ready.rev)?)
            .execute(&mut *tx)
            .await?;

        one_row(changed)?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn add_challenge(&self, challenge: NewChallenge) -> DbResult<()> {
        let mut tx = self.pool.begin().await?;

        query(
            "INSERT INTO challenge_assignments \
             (room_id, hand_no, seat, version, tier, hand_tag, commitment, nonce) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        )
        .bind(challenge.room)
        .bind(i64::try_from(challenge.hand_no)?)
        .bind(i32::try_from(challenge.seat)?)
        .bind(i32::from(PROTOCOL_VERSION))
        .bind(i32::from(challenge.tier))
        .bind(challenge.hand_tag.as_slice())
        .bind(challenge.commitment.as_slice())
        .bind(challenge.nonce.as_slice())
        .execute(&mut *tx)
        .await?;
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

    pub async fn claim(&self, claim: ClaimUpdate) -> DbResult<()> {
        let mut tx = self.pool.begin().await?;
        let row = query(
            "SELECT version, tier, hand_tag, commitment, nonce, facts_hash, nullifier \
             FROM challenge_assignments \
             WHERE room_id = $1 AND hand_no = $2 AND seat = $3 FOR UPDATE",
        )
        .bind(claim.room)
        .bind(i64::try_from(claim.hand_no)?)
        .bind(i32::try_from(claim.seat)?)
        .fetch_one(&mut *tx)
        .await?;

        if row.try_get::<i32, _>("version")? != i32::from(PROTOCOL_VERSION)
            || row.try_get::<i32, _>("tier")? != i32::from(claim.tier)
            || row.try_get::<Vec<u8>, _>("hand_tag")? != claim.hand_tag
            || row.try_get::<Vec<u8>, _>("commitment")? != claim.commitment
            || row.try_get::<Vec<u8>, _>("nonce")? != claim.nonce
            || row.try_get::<Option<Vec<u8>>, _>("facts_hash")? != Some(claim.facts_hash.to_vec())
            || row.try_get::<Option<Vec<u8>>, _>("nullifier")?.is_some()
        {
            return Err(io::Error::other("challenge claim mismatch").into());
        }

        let changed = query(
            "UPDATE challenge_assignments \
             SET nullifier = $4, points = $5, claimed_at = now() \
             WHERE room_id = $1 AND hand_no = $2 AND seat = $3 AND nullifier IS NULL",
        )
        .bind(claim.room)
        .bind(i64::try_from(claim.hand_no)?)
        .bind(i32::try_from(claim.seat)?)
        .bind(claim.nullifier.as_slice())
        .bind(i64::from(claim.points))
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

    pub async fn append_action(&self, action: NewAction) -> DbResult<()> {
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
                    "UPDATE challenge_assignments SET facts_hash = $4 \
                     WHERE room_id = $1 AND hand_no = $2 AND seat = $3 \
                     AND facts_hash IS NULL",
                )
                .bind(action.room)
                .bind(i64::try_from(action.hand_no)?)
                .bind(i32::try_from(fact.seat)?)
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
        let rows =
            query("SELECT id, players, stack, small_blind, big_blind, rev FROM rooms ORDER BY id")
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
            "SELECT hand_no, seat, version, tier, hand_tag, commitment, nonce, facts_hash, \
             nullifier, points, claimed_at IS NOT NULL AS claimed \
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
                    tier: row.try_get("tier")?,
                    hand_tag: row.try_get("hand_tag")?,
                    commitment: row.try_get("commitment")?,
                    nonce: row.try_get("nonce")?,
                    facts_hash: row.try_get("facts_hash")?,
                    nullifier: row.try_get("nullifier")?,
                    points: row.try_get("points")?,
                    claimed: row.try_get("claimed")?,
                })
            })
            .collect()
    }

    #[cfg(test)]
    pub fn pool(&self) -> &PgPool {
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
