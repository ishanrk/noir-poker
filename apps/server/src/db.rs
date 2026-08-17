use std::error::Error;
use std::io;

use game_core::Action;
use sqlx::postgres::{PgPoolOptions, PgQueryResult};
use sqlx::{PgPool, Row, query};
use uuid::Uuid;

type DbResult<T> = Result<T, Box<dyn Error + Send + Sync>>;

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!();

pub struct NewHand<'a> {
    pub id: Uuid,
    pub seed: &'a [u8; 32],
    pub dealer: usize,
    pub stacks: &'a [u32],
}

pub struct NewAction {
    pub room: Uuid,
    pub hand: Uuid,
    pub seq: u64,
    pub player: usize,
    pub action: Action,
    pub rev: u64,
    pub next_rev: u64,
}

pub struct StoredRoom {
    pub id: Uuid,
    pub players: i32,
    pub stack: i64,
    pub small_blind: i64,
    pub big_blind: i64,
    pub rev: i64,
    pub seats: Vec<StoredSeat>,
    pub hand: Option<StoredHand>,
}

pub struct StoredSeat {
    pub seat: i32,
    pub token_hash: Vec<u8>,
}

pub struct StoredHand {
    pub id: Uuid,
    pub hand_no: i64,
    pub seed: Vec<u8>,
    pub dealer: i32,
    pub stacks: Vec<i64>,
    pub actions: Vec<StoredAction>,
}

pub struct StoredAction {
    pub seq: i64,
    pub player: i32,
    pub action: String,
    pub raise_to: Option<i64>,
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
                 VALUES ($1, $2, 0, $3, $4, $5)",
            )
            .bind(hand.id)
            .bind(room)
            .bind(hand.seed.as_slice())
            .bind(i32::try_from(hand.dealer)?)
            .bind(stacks)
            .execute(&mut *tx)
            .await?;
        }

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

            rooms.push(StoredRoom {
                id,
                players: row.try_get("players")?,
                stack: row.try_get("stack")?,
                small_blind: row.try_get("small_blind")?,
                big_blind: row.try_get("big_blind")?,
                rev: row.try_get("rev")?,
                seats,
                hand,
            });
        }

        Ok(rooms)
    }

    async fn load_seats(&self, room: Uuid) -> DbResult<Vec<StoredSeat>> {
        let rows = query("SELECT seat, token_hash FROM seats WHERE room_id = $1 ORDER BY seat")
            .bind(room)
            .fetch_all(&self.pool)
            .await?;

        rows.into_iter()
            .map(|row| {
                Ok(StoredSeat {
                    seat: row.try_get("seat")?,
                    token_hash: row.try_get("token_hash")?,
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
