from __future__ import annotations

import re
from pathlib import Path

path = Path("apps/server/src/main.rs")
text = path.read_text()

reload = '''    async fn reload(db: &Db, id: Uuid) -> Room {
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

'''
text, count = re.subn(
    r"    async fn reload\(db: &Db, id: Uuid\) -> Room \{.*?\n    \}\n\n(?=    async fn persist)",
    reload,
    text,
    count=1,
    flags=re.S,
)
if count != 1:
    raise RuntimeError(f"expected one reload helper found {count}")

ready = '''        let ready_stacks = vec![100, 100];
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

'''
text, count = re.subn(
    r"        let ready_stacks = vec!\[100, 100\];\n.*?\n(?=        let mut rooms = HashMap::new\(\);)",
    ready,
    text,
    count=1,
    flags=re.S,
)
if count != 1:
    raise RuntimeError(f"expected one ready persistence fixture found {count}")

short = '''        let short_stacks = vec![10, 10];
        let short_first_share = [0x71; 32];
        let short_second_share = [0x72; 32];
        let short_ceremony = fairness::random_ceremony(short_id, 0, short_config.players).unwrap();
        let mut short = Room::new_fair(
            short_config,
            short_first,
            short_ceremony,
            short_first_share,
        )
        .unwrap();
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

'''
text, count = re.subn(
    r"        let short_stacks = vec!\[10, 10\];\n.*?\n(?=        let mut rooms = HashMap::new\(\);)",
    short,
    text,
    count=1,
    flags=re.S,
)
if count != 1:
    raise RuntimeError(f"expected one short persistence fixture found {count}")

path.write_text(text)
