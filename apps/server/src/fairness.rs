use std::error::Error;
use std::io;

use deal_core::{PROTOCOL_VERSION, commitment, seed};
use sqlx::{Postgres, Row, Transaction, query};
use uuid::Uuid;

use crate::db::{Db, NewHand, StoredAction, StoredHand};
use crate::room::{Ceremony, RoomConfig, RoomMode};

type FairResult<T> = Result<T, Box<dyn Error + Send + Sync>>;

pub struct StoredAudit {
    pub config: RoomConfig,
    pub hand: StoredHand,
    pub server_secret: [u8; 32],
    pub commitment: [u8; 32],
    pub final_seed: [u8; 32],
    pub shares: Vec<[u8; 32]>,
}

pub async fn ensure_pending(db: &Db) -> FairResult<()> {
    let rows = query(
        "SELECT rooms.id, rooms.players, COALESCE(MAX(hands.hand_no) + 1, 0) AS next_hand \
         FROM rooms LEFT JOIN hands ON hands.room_id = rooms.id \
         GROUP BY rooms.id, rooms.players ORDER BY rooms.id",
    )
    .fetch_all(db.pool())
    .await?;

    for row in rows {
        let room: Uuid = row.try_get("id")?;
        let players = usize::try_from(row.try_get::<i32, _>("players")?)?;
        let hand_no = u64::try_from(row.try_get::<i64, _>("next_hand")?)?;
        let exists = query("SELECT 1 FROM hand_ceremonies WHERE room_id = $1 AND hand_no = $2")
            .bind(room)
            .bind(i64::try_from(hand_no)?)
            .fetch_optional(db.pool())
            .await?
            .is_some();

        if exists {
            continue;
        }

        let ceremony = random_ceremony(room, hand_no, players)?;
        let mut tx = db.pool().begin().await?;
        insert_ceremony(&mut tx, room, &ceremony).await?;

        if hand_no == 0 {
            let seats = query("SELECT seat FROM seats WHERE room_id = $1 ORDER BY seat")
                .bind(room)
                .fetch_all(&mut *tx)
                .await?;

            for seat in seats {
                let seat = usize::try_from(seat.try_get::<i32, _>("seat")?)?;
                let mut share = [0; 32];
                getrandom::fill(&mut share)?;
                insert_share(&mut tx, room, hand_no, seat, share).await?;
            }
        }

        tx.commit().await?;
    }

    Ok(())
}

pub fn random_ceremony(room: Uuid, hand_no: u64, players: usize) -> FairResult<Ceremony> {
    let mut server_secret = [0; 32];
    getrandom::fill(&mut server_secret)?;
    let commitment = commitment(*room.as_bytes(), hand_no, server_secret);

    Ok(Ceremony {
        hand_no,
        server_secret,
        commitment,
        shares: vec![None; players],
    })
}

pub async fn create_room(
    db: &Db,
    id: Uuid,
    config: RoomConfig,
    mode: RoomMode,
    token_hash: &[u8; 32],
    ceremony: &Ceremony,
    share: [u8; 32],
) -> FairResult<()> {
    let mut tx = db.pool().begin().await?;

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
    insert_ceremony(&mut tx, id, ceremony).await?;
    insert_share(&mut tx, id, ceremony.hand_no, 0, share).await?;
    tx.commit().await?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub async fn join_room(
    db: &Db,
    room: Uuid,
    seat: usize,
    token_hash: &[u8; 32],
    share: [u8; 32],
    rev: u64,
    next_rev: u64,
    ceremony: &Ceremony,
    hand: Option<NewHand<'_>>,
    next: Option<&Ceremony>,
) -> FairResult<()> {
    let mut tx = db.pool().begin().await?;

    query("INSERT INTO seats (room_id, seat, token_hash) VALUES ($1, $2, $3)")
        .bind(room)
        .bind(i32::try_from(seat)?)
        .bind(token_hash.as_slice())
        .execute(&mut *tx)
        .await?;
    insert_share(&mut tx, room, ceremony.hand_no, seat, share).await?;

    if let Some(hand) = hand {
        let completed = ceremony_with_share(ceremony, seat, share)?;
        finalize_ceremony(&mut tx, room, &completed, hand.seed).await?;
        insert_hand(&mut tx, room, &hand).await?;
        insert_ceremony(
            &mut tx,
            room,
            next.ok_or_else(|| io::Error::other("next deal ceremony missing"))?,
        )
        .await?;
    }

    update_rev(&mut tx, room, rev, next_rev).await?;
    tx.commit().await?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub async fn ready(
    db: &Db,
    room: Uuid,
    hand_id: Uuid,
    seat: usize,
    share: [u8; 32],
    rev: u64,
    next_rev: u64,
    ceremony: &Ceremony,
    hand: Option<NewHand<'_>>,
    next: Option<&Ceremony>,
) -> FairResult<()> {
    let mut tx = db.pool().begin().await?;
    let changed = query(
        "UPDATE seats SET ready_hand = $3 \
         WHERE room_id = $1 AND seat = $2 AND ready_hand IS NULL",
    )
    .bind(room)
    .bind(i32::try_from(seat)?)
    .bind(hand_id)
    .execute(&mut *tx)
    .await?;

    if changed.rows_affected() != 1 {
        return Err(io::Error::other("seat readiness mismatch").into());
    }

    insert_share(&mut tx, room, ceremony.hand_no, seat, share).await?;

    if let Some(hand) = hand {
        let completed = ceremony_with_share(ceremony, seat, share)?;
        finalize_ceremony(&mut tx, room, &completed, hand.seed).await?;
        insert_hand(&mut tx, room, &hand).await?;
        insert_ceremony(
            &mut tx,
            room,
            next.ok_or_else(|| io::Error::other("next deal ceremony missing"))?,
        )
        .await?;
        query("UPDATE seats SET ready_hand = NULL WHERE room_id = $1")
            .bind(room)
            .execute(&mut *tx)
            .await?;
    }

    update_rev(&mut tx, room, rev, next_rev).await?;
    tx.commit().await?;
    Ok(())
}

pub async fn load_pending(db: &Db, room: Uuid, players: usize) -> FairResult<Option<Ceremony>> {
    let Some(row) = query(
        "SELECT hand_no, server_secret, commitment FROM hand_ceremonies \
         WHERE room_id = $1 AND final_seed IS NULL ORDER BY hand_no DESC LIMIT 1",
    )
    .bind(room)
    .fetch_optional(db.pool())
    .await?
    else {
        return Ok(None);
    };
    let hand_no = u64::try_from(row.try_get::<i64, _>("hand_no")?)?;
    let server_secret = bytes(row.try_get("server_secret")?)?;
    let commitment = bytes(row.try_get("commitment")?)?;
    let mut shares = vec![None; players];
    let rows = query(
        "SELECT seat, share FROM hand_entropy \
         WHERE room_id = $1 AND hand_no = $2 ORDER BY seat",
    )
    .bind(room)
    .bind(i64::try_from(hand_no)?)
    .fetch_all(db.pool())
    .await?;

    for row in rows {
        let seat = usize::try_from(row.try_get::<i32, _>("seat")?)?;
        let slot = shares
            .get_mut(seat)
            .ok_or_else(|| io::Error::other("invalid deal contribution seat"))?;
        *slot = Some(bytes(row.try_get("share")?)?);
    }

    Ok(Some(Ceremony {
        hand_no,
        server_secret,
        commitment,
        shares,
    }))
}

pub async fn current_commitment(db: &Db, room: Uuid) -> FairResult<Option<[u8; 32]>> {
    let row = query(
        "SELECT ceremony.commitment FROM hands \
         JOIN hand_ceremonies ceremony \
           ON ceremony.room_id = hands.room_id AND ceremony.hand_no = hands.hand_no \
         WHERE hands.room_id = $1 ORDER BY hands.hand_no DESC LIMIT 1",
    )
    .bind(room)
    .fetch_optional(db.pool())
    .await?;

    row.map(|row| bytes(row.try_get("commitment")?)).transpose()
}

pub async fn audit(db: &Db, room: Uuid, hand_no: u64) -> FairResult<Option<StoredAudit>> {
    let Some(row) = query(
        "SELECT rooms.players, rooms.stack, rooms.small_blind, rooms.big_blind, \
         hands.id, hands.seed, hands.dealer, hands.starting_stacks, \
         ceremony.server_secret, ceremony.commitment, ceremony.final_seed \
         FROM rooms JOIN hands ON hands.room_id = rooms.id \
         JOIN hand_ceremonies ceremony \
           ON ceremony.room_id = hands.room_id AND ceremony.hand_no = hands.hand_no \
         WHERE rooms.id = $1 AND hands.hand_no = $2",
    )
    .bind(room)
    .bind(i64::try_from(hand_no)?)
    .fetch_optional(db.pool())
    .await?
    else {
        return Ok(None);
    };
    let id: Uuid = row.try_get("id")?;
    let actions = query(
        "SELECT seq, player, action, raise_to FROM hand_actions \
         WHERE hand_id = $1 ORDER BY seq",
    )
    .bind(id)
    .fetch_all(db.pool())
    .await?
    .into_iter()
    .map(|row| {
        Ok(StoredAction {
            seq: row.try_get("seq")?,
            player: row.try_get("player")?,
            action: row.try_get("action")?,
            raise_to: row.try_get("raise_to")?,
        })
    })
    .collect::<FairResult<Vec<_>>>()?;
    let shares = query(
        "SELECT seat, share FROM hand_entropy \
         WHERE room_id = $1 AND hand_no = $2 ORDER BY seat",
    )
    .bind(room)
    .bind(i64::try_from(hand_no)?)
    .fetch_all(db.pool())
    .await?
    .into_iter()
    .enumerate()
    .map(|(expected, row)| {
        let seat = usize::try_from(row.try_get::<i32, _>("seat")?)?;

        if seat != expected {
            return Err(io::Error::other("deal contribution sequence gap").into());
        }

        bytes(row.try_get("share")?)
    })
    .collect::<FairResult<Vec<_>>>()?;
    let players = usize::try_from(row.try_get::<i32, _>("players")?)?;

    if shares.len() != players {
        return Err(io::Error::other("deal contributions missing").into());
    }

    Ok(Some(StoredAudit {
        config: RoomConfig {
            players,
            stack: u32::try_from(row.try_get::<i64, _>("stack")?)?,
            small_blind: u32::try_from(row.try_get::<i64, _>("small_blind")?)?,
            big_blind: u32::try_from(row.try_get::<i64, _>("big_blind")?)?,
        },
        hand: StoredHand {
            id,
            hand_no: i64::try_from(hand_no)?,
            seed: row.try_get("seed")?,
            dealer: row.try_get("dealer")?,
            stacks: row.try_get("starting_stacks")?,
            actions,
        },
        server_secret: bytes(row.try_get("server_secret")?)?,
        commitment: bytes(row.try_get("commitment")?)?,
        final_seed: bytes(
            row.try_get::<Option<Vec<u8>>, _>("final_seed")?
                .ok_or_else(|| io::Error::other("deal is not final"))?,
        )?,
        shares,
    }))
}

async fn insert_ceremony(
    tx: &mut Transaction<'_, Postgres>,
    room: Uuid,
    ceremony: &Ceremony,
) -> FairResult<()> {
    query(
        "INSERT INTO hand_ceremonies \
         (room_id, hand_no, version, server_secret, commitment) \
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(room)
    .bind(i64::try_from(ceremony.hand_no)?)
    .bind(i32::from(PROTOCOL_VERSION))
    .bind(ceremony.server_secret.as_slice())
    .bind(ceremony.commitment.as_slice())
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn insert_share(
    tx: &mut Transaction<'_, Postgres>,
    room: Uuid,
    hand_no: u64,
    seat: usize,
    share: [u8; 32],
) -> FairResult<()> {
    query("INSERT INTO hand_entropy (room_id, hand_no, seat, share) VALUES ($1, $2, $3, $4)")
        .bind(room)
        .bind(i64::try_from(hand_no)?)
        .bind(i32::try_from(seat)?)
        .bind(share.as_slice())
        .execute(&mut **tx)
        .await?;
    Ok(())
}

fn ceremony_with_share(ceremony: &Ceremony, seat: usize, share: [u8; 32]) -> FairResult<Ceremony> {
    let mut completed = ceremony.clone();
    let slot = completed
        .shares
        .get_mut(seat)
        .ok_or_else(|| io::Error::other("invalid deal contribution seat"))?;

    if slot.is_some() {
        return Err(io::Error::other("deal contribution already submitted").into());
    }

    *slot = Some(share);
    Ok(completed)
}

async fn finalize_ceremony(
    tx: &mut Transaction<'_, Postgres>,
    room: Uuid,
    ceremony: &Ceremony,
    final_seed: &[u8; 32],
) -> FairResult<()> {
    let shares = ceremony
        .shares
        .iter()
        .copied()
        .collect::<Option<Vec<_>>>()
        .ok_or_else(|| io::Error::other("deal contributions missing"))?;
    let expected = seed(
        *room.as_bytes(),
        ceremony.hand_no,
        ceremony.server_secret,
        &shares,
    )
    .ok_or_else(|| io::Error::other("cannot derive deal seed"))?;

    if expected != *final_seed
        || commitment(*room.as_bytes(), ceremony.hand_no, ceremony.server_secret)
            != ceremony.commitment
    {
        return Err(io::Error::other("deal transcript mismatch").into());
    }

    let changed = query(
        "UPDATE hand_ceremonies SET final_seed = $3 \
         WHERE room_id = $1 AND hand_no = $2 AND final_seed IS NULL",
    )
    .bind(room)
    .bind(i64::try_from(ceremony.hand_no)?)
    .bind(final_seed.as_slice())
    .execute(&mut **tx)
    .await?;

    one_row(changed.rows_affected(), "deal finalization mismatch")
}

async fn insert_hand(
    tx: &mut Transaction<'_, Postgres>,
    room: Uuid,
    hand: &NewHand<'_>,
) -> FairResult<()> {
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
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn update_rev(
    tx: &mut Transaction<'_, Postgres>,
    room: Uuid,
    rev: u64,
    next_rev: u64,
) -> FairResult<()> {
    let changed = query("UPDATE rooms SET rev = $2 WHERE id = $1 AND rev = $3")
        .bind(room)
        .bind(i64::try_from(next_rev)?)
        .bind(i64::try_from(rev)?)
        .execute(&mut **tx)
        .await?;

    one_row(changed.rows_affected(), "room revision mismatch")
}

fn one_row(rows: u64, message: &'static str) -> FairResult<()> {
    if rows != 1 {
        return Err(io::Error::other(message).into());
    }

    Ok(())
}

fn bytes(value: Vec<u8>) -> FairResult<[u8; 32]> {
    value
        .try_into()
        .map_err(|_| io::Error::other("invalid deal transcript bytes").into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ceremony_binds_context() {
        let room = Uuid::from_u128(1);
        let first = Ceremony {
            hand_no: 4,
            server_secret: [7; 32],
            commitment: commitment(*room.as_bytes(), 4, [7; 32]),
            shares: vec![Some([1; 32]), Some([2; 32])],
        };

        assert_ne!(
            first.commitment,
            commitment(*Uuid::from_u128(2).as_bytes(), 4, [7; 32])
        );
        assert_ne!(first.commitment, commitment(*room.as_bytes(), 5, [7; 32]));
    }
}
