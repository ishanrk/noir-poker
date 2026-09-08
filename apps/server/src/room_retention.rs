use super::*;
pub const IDLE_ROOM: Duration = Duration::from_secs(30 * 60);
pub const MAX_ORDINARY_ROOMS: usize = 128;

pub async fn run(state: AppState) {
    let mut timer = tokio::time::interval(Duration::from_secs(60));
    loop {
        timer.tick().await;
        retire_idle(&state, IDLE_ROOM).await;
    }
}

pub async fn retire_idle(state: &AppState, age: Duration) {
    let rooms = state
        .rooms
        .lock()
        .await
        .iter()
        .map(|(id, room)| (*id, room.clone()))
        .collect::<Vec<_>>();
    for (id, live) in rooms {
        let mut room = live.lock().await;
        if room.mode == RoomMode::Aztec || room.last_activity.elapsed() < age {
            continue;
        }
        let hand = room.hand.as_ref().map_or(0, |hand| hand.no);
        let completed = room.hand.as_ref().and_then(|hand| {
            if hand.game.settled && room.deck.as_ref().is_none_or(|deck| deck.complete) {
                Some(hand.no)
            } else {
                hand.no.checked_sub(1)
            }
        });
        // Persist before invalidating ownership. No synthetic winner or card opening.
        if state
            .db
            .retire_idle_room(id, hand, completed)
            .await
            .is_err()
        {
            continue;
        }
        room.retired = true;
        let _ = room.notify.send(room.rev);
        state.rooms.lock().await.remove(&id);
    }
}
