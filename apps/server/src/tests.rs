use crate::db::StoredSeat;
use crate::room::JoinError;
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

fn single_room() -> Room {
    let config = config(2);
    let first = hash_token(Uuid::from_u128(1));
    let share = [0x11; 32];
    let ceremony = fairness::random_ceremony(TEST_ROOM, 0, config.players).unwrap();
    let mut room = Room::new_fair(config, RoomMode::Single, first, ceremony, share).unwrap();
    let ceremony = room.ceremony.as_ref().unwrap().clone();
    let seed = ceremony.seed_with(TEST_ROOM, 1, [0x22; 32]).unwrap();
    let hand = live_hand(
        Uuid::from_u128(2),
        0,
        seed,
        0,
        vec![config.stack; config.players],
        config,
    );

    room.commit_fair_join(
        hash_token(Uuid::from_u128(3)),
        1,
        [0x22; 32],
        Some(hand),
        None,
        1,
    );
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
            room.mode,
        )?;
    }

    room.commit_action(next);
    Ok(())
}

fn stored_room() -> StoredRoom {
    StoredRoom {
        id: TEST_ROOM,
        mode: "multiplayer".to_owned(),
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
    let current = fairness::current_commitment(db, id).await.unwrap();
    room.current_commitment = current.map(|(commitment, _)| commitment);
    room.current_protocol = current.map_or(1, |(_, version)| version);
    room
}

async fn persist(db: &Db, id: Uuid, room: &mut Room, seat: usize, action: Action) {
    let mut next = room.stage_action(seat, action).unwrap();

    if next.facts.is_some() {
        bind_facts(
            &mut next,
            &room.current_challenges,
            vec![[0x55; 32]; room.config.players],
            room.mode,
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
    assert_eq!(room.mode, RoomMode::Multiplayer);
}

#[test]
fn room_modes() {
    let request: CreateRoomRequest =
        serde_json::from_str(r#"{"players":2,"stack":100,"small_blind":5,"big_blind":10}"#)
            .unwrap();

    assert_eq!(request.mode(), RoomMode::Multiplayer);

    for (text, mode) in [
        ("single", RoomMode::Single),
        ("multiplayer", RoomMode::Multiplayer),
        ("aztec", RoomMode::Aztec),
    ] {
        let request: CreateRoomRequest = serde_json::from_str(&format!(
            r#"{{"players":2,"stack":100,"small_blind":5,"big_blind":10,"mode":"{text}"}}"#
        ))
        .unwrap();

        assert_eq!(request.mode(), mode);
    }

    assert!(
        serde_json::from_str::<CreateRoomRequest>(
            r#"{"players":2,"stack":100,"small_blind":5,"big_blind":10,"mode":"invalid"}"#
        )
        .is_err()
    );
}

#[test]
fn bound_commands() {
    let mut room = started(100);
    let hand_no = room.hand.as_ref().unwrap().no;
    let rev = room.rev;
    let seat = room.hand.as_ref().unwrap().game.turn;
    let request = Uuid::new_v4();
    assert!(check_action(&room, hand_no, rev, seat, request).is_ok());
    apply(&mut room, seat, Action::Call).unwrap();
    assert_eq!(
        check_action(&room, hand_no, rev, seat, request),
        Err("stale poker action")
    );
    assert_eq!(
        check_action(&room, hand_no + 1, room.rev, seat, Uuid::new_v4()),
        Err("stale poker action")
    );
    assert!(serde_json::from_str::<ClientMessage>(r#"{"type":"call"}"#).is_err());
    assert!(
        serde_json::from_str::<CreateRoomRequest>(
            r#"{"players":2,"stack":100,"small_blind":5,"big_blind":10,"entropy":"00"}"#
        )
        .is_err()
    );
    let ceremony = fairness::random_ceremony(TEST_ROOM, 0, 2).unwrap();
    let room = Room::reserve(
        config(2),
        RoomMode::Multiplayer,
        hash_token(request),
        ceremony.clone(),
    )
    .unwrap();
    assert!(check_ceremony(&room, 0, &encode_hex(ceremony.commitment)).is_ok());
    assert!(check_ceremony(&room, 1, &encode_hex(ceremony.commitment)).is_err());
    assert!(check_ceremony(&room, 0, &encode_hex([0; 32])).is_err());
    assert_eq!(room.ceremony.as_ref().unwrap().contributors(), 0);
}

#[test]
fn single_commitment_first() {
    let config = config(2);
    let ceremony = fairness::random_ceremony(TEST_ROOM, 0, config.players).unwrap();
    let room = Room::new_pending(config, hash_token(Uuid::from_u128(1)), ceremony.clone()).unwrap();

    assert_eq!(room.mode, RoomMode::Single);
    assert!(room.hand.is_none());
    assert_eq!(
        room.ceremony.as_ref().unwrap().commitment,
        ceremony.commitment
    );
    assert!(
        room.ceremony
            .as_ref()
            .unwrap()
            .shares
            .iter()
            .all(Option::is_none)
    );
}

#[test]
fn bot_hidden_cards() {
    let mut first = State::new([1; 32], 0, &[100, 100], 5, 10);
    let mut second = State::new([2; 32], 0, &[100, 100], 5, 10);

    first.turn = 1;
    second.players = first.players.clone();
    second.hole[1] = first.hole[1];
    second.turn = first.turn;
    second.hole[0] = [Card::from_id(50).unwrap(), Card::from_id(51).unwrap()];

    assert_ne!(first.hole[0], second.hole[0]);
    assert_eq!(
        bot_action(TEST_ROOM, 0, 0, &first, 1).unwrap(),
        bot_action(TEST_ROOM, 0, 0, &second, 1).unwrap(),
    );
}

#[test]
fn bots_stop_for_human() {
    let room = single_room();

    assert!(next_bot_action(TEST_ROOM, &room).unwrap().is_none());
}

#[test]
fn bot_ready_skips_proof() {
    let mut room = single_room();

    room.hand.as_mut().unwrap().game.settled = true;

    assert_eq!(room.stage_ready(0).err(), Some("draw proof required"));
    assert!(room.stage_ready(1).is_ok());
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
    let draw =
        "{\"type\":\"challenge_draw\",\"hand_no\":1,\"proof\":\"AA==\",\"public_inputs\":\"AA==\"}";
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
async fn participant_persistence() {
    let db = Db::connect(&std::env::var("TEST_DATABASE_URL").expect("TEST_DATABASE_URL"))
        .await
        .unwrap();
    let state = AppState::test(db.clone(), HashMap::new());
    let (_, Json(first)) = create_room(
        AxumState(state.clone()),
        Json(CreateRoomRequest {
            players: 2,
            stack: 1000,
            small_blind: 5,
            big_blind: 10,
            mode: Some(RoomMode::Multiplayer),
        }),
    )
    .await
    .unwrap();
    let id = first.room;
    let room = find_room(&state, id).await.unwrap();
    room.lock().await.mode = RoomMode::Aztec;
    assert_eq!(
        join_room(AxumState(state.clone()), Path(id), Json(JoinRequest {}))
            .await
            .err(),
        Some((StatusCode::CONFLICT, "experimental aztec disabled")),
    );
    assert_eq!(reload(&db, id).await.seats.len(), 1);
    room.lock().await.mode = RoomMode::Multiplayer;
    let Json(second) = join_room(AxumState(state.clone()), Path(id), Json(JoinRequest {}))
        .await
        .unwrap();
    let reserved = reload(&db, id).await;
    assert_eq!(reserved.seats.len(), 2);
    assert_eq!(seat_for_token(&reserved, first.token), Some(0));
    assert_eq!(seat_for_token(&reserved, second.token), Some(1));
    assert!(reserved.hand.is_none());
    let ceremony = reserved.ceremony.as_ref().unwrap().clone();
    assert_eq!(ceremony.protocol_version, 2);
    assert_eq!(ceremony.contributors(), 0);
    let commitment = encode_hex(ceremony.commitment);
    let first_share = encode_hex([0x11; 32]);
    let second_share = encode_hex([0x22; 32]);
    assert_eq!(
        initial_entropy(&state, id, 0, 1, &commitment, &first_share).await,
        Err("stale deal ceremony")
    );
    assert_eq!(
        initial_entropy(&state, id, 0, 0, &encode_hex([0; 32]), &first_share).await,
        Err("stale deal ceremony")
    );
    initial_entropy(&state, id, 0, 0, &commitment, &first_share)
        .await
        .unwrap();
    let accepted = reload(&db, id).await;
    assert!(accepted.hand.is_none());
    assert_eq!(
        accepted.ceremony.as_ref().unwrap().shares,
        vec![Some([0x11; 32]), None]
    );
    initial_entropy(&state, id, 0, 0, &commitment, &first_share)
        .await
        .unwrap();
    assert_eq!(reload(&db, id).await.rev, accepted.rev);
    assert_eq!(
        initial_entropy(&state, id, 0, 0, &commitment, &second_share).await,
        Err("deal entropy conflict")
    );
    let room = find_room(&state, id).await.unwrap();
    room.lock().await.rev += 1;
    assert_eq!(
        initial_entropy(&state, id, 1, 0, &commitment, &second_share).await,
        Err("cannot persist deal contribution")
    );
    assert!(room.lock().await.hand.is_none());
    assert_eq!(reload(&db, id).await.ceremony.unwrap().shares[1], None);
    *room.lock().await = reload(&db, id).await;
    initial_entropy(&state, id, 1, 0, &commitment, &second_share)
        .await
        .unwrap();
    let restored = reload(&db, id).await;
    assert_eq!(restored.current_commitment, Some(ceremony.commitment));
    assert_eq!(restored.current_protocol, 2);
    assert_eq!(restored.hand.as_ref().unwrap().no, 0);
    assert_eq!(restored.ceremony.as_ref().unwrap().hand_no, 1);
    let rev = restored.rev;
    let turn = restored.hand.as_ref().unwrap().game.turn;
    let request = Uuid::new_v4();
    betting_command(&state, id, turn, Action::Fold, 0, rev, request)
        .await
        .unwrap();
    let settled = reload(&db, id).await;
    let stacks = settled.hand.as_ref().unwrap().game.players.clone();
    assert_eq!(
        betting_command(&state, id, turn, Action::Fold, 0, rev, request).await,
        Err("stale poker action")
    );
    assert_eq!(reload(&db, id).await.hand.unwrap().game.players, stacks);
    let Json(audit) = deal_audit(AxumState(state.clone()), Path((id, 0)))
        .await
        .unwrap();
    assert_eq!(audit.protocol_version, 2);
    assert_eq!(audit.commitment, commitment);
    assert_eq!(audit.deck.len(), 52);
    assert_eq!(audit.contributions[0].share, first_share);
    assert_eq!(audit.contributions[1].share, second_share);
    assert_eq!(
        initial_entropy(&state, id, 1, 0, &commitment, &second_share).await,
        Err("deal already started")
    );
    let restored_rooms = restore_rooms(db.load_rooms().await.unwrap()).unwrap();
    attach_fairness(&db, &restored_rooms).await.unwrap();
    let restored = restored_rooms.get(&id).unwrap().lock().await;
    assert_eq!(seat_for_token(&restored, first.token), Some(0));
    assert_eq!(restored.current_commitment, Some(ceremony.commitment));
    assert_eq!(restored.hand.as_ref().unwrap().game.players, stacks);
}

#[tokio::test]
#[ignore = "requires TEST_DATABASE_URL"]
async fn single_persistence() {
    let url = std::env::var("TEST_DATABASE_URL").expect("TEST_DATABASE_URL");
    let db = Db::connect(&url).await.unwrap();

    sqlx::query("TRUNCATE hand_entropy, hand_ceremonies, challenge_assignments, hand_actions, hands, seats, rooms")
        .execute(db.pool())
        .await
        .unwrap();

    let config = config(2);
    let id = Uuid::new_v4();
    let token = hash_token(Uuid::new_v4());
    let share = [0x31; 32];
    let ceremony = fairness::random_ceremony(id, 0, config.players).unwrap();
    let room = Room::new_pending(config, token, ceremony.clone()).unwrap();

    fairness::create_pending_room(&db, id, config, &token, &ceremony)
        .await
        .unwrap();

    let mut rooms = HashMap::new();
    rooms.insert(id, Arc::new(Mutex::new(room)));
    let state = AppState::test(db.clone(), rooms);

    single_entropy(&state, id, 0, &encode_hex(share))
        .await
        .unwrap();
    let audit = fairness::audit(&db, id, 0).await.unwrap().unwrap();

    assert_eq!(audit.commitment, ceremony.commitment);
    assert_eq!(audit.shares[1], fairness::bot_share(id, &ceremony, 1));
    apply_action(&state, id, 0, Action::Call).await.unwrap();

    let restored = reload(&db, id).await;
    let hand = restored.hand.as_ref().unwrap();

    assert!(hand.actions.iter().any(|action| action.player == 1));
    assert_eq!(restored.mode, RoomMode::Single);
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
        waiting_config,
        RoomMode::Single,
        &hash_token(waiting_first),
    )
    .await
    .unwrap();
    db.join_room(waiting_id, 1, &hash_token(waiting_second), 0, 1, None)
        .await
        .unwrap();

    let waiting = reload(&db, waiting_id).await;

    assert_eq!(waiting.seats.len(), 2);
    assert_eq!(waiting.mode, RoomMode::Single);
    assert!(waiting.hand.is_none());
    assert_eq!(waiting.rev, 1);
    assert_eq!(waiting.next_seat(), Ok(2));
    assert_eq!(seat_for_token(&waiting, waiting_first), Some(0));
    assert_eq!(seat_for_token(&waiting, waiting_second), Some(1));
    assert_eq!(
        room_message(waiting_id, &waiting, 0),
        ServerMessage::Waiting {
            joined: 2,
            players: 3,
            mode: RoomMode::Single,
        }
    );

    let config = config(2);
    let id = Uuid::new_v4();
    let first = Uuid::new_v4();
    let first_hash = hash_token(first);

    db.create_room(id, config, RoomMode::Aztec, &first_hash)
        .await
        .unwrap();

    let row =
        sqlx::query("SELECT players, stack, small_blind, big_blind, rev FROM rooms WHERE id = $1")
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

    let rows = sqlx::query("SELECT seat, token_hash FROM seats WHERE room_id = $1 ORDER BY seat")
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

    let row = sqlx::query("SELECT hand_no, seed, dealer, starting_stacks FROM hands WHERE id = $1")
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

    db.create_room(other_id, config, RoomMode::Multiplayer, &other_first)
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
        all_in_config,
        RoomMode::Multiplayer,
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
        RoomMode::Multiplayer,
        ready_first_hash,
        ready_ceremony,
        ready_first_share,
    )
    .unwrap();
    let ready_ceremony = live.ceremony.as_ref().unwrap().clone();
    let ready_seed = ready_ceremony
        .seed_with(ready_id, 1, ready_second_share)
        .unwrap();
    let ready_next_ceremony = fairness::random_ceremony(ready_id, 1, ready_config.players).unwrap();

    fairness::create_room(
        &db,
        ready_id,
        ready_config,
        RoomMode::Multiplayer,
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
        Err("deal entropy conflict")
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

    let row =
        sqlx::query("SELECT seq, player, action FROM hand_actions WHERE hand_id = $1 ORDER BY seq")
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
    let mut short = Room::new_fair(
        short_config,
        RoomMode::Multiplayer,
        short_first,
        short_ceremony,
        short_first_share,
    )
    .unwrap();
    let short_ceremony = short.ceremony.as_ref().unwrap().clone();
    let short_seed = short_ceremony
        .seed_with(short_id, 1, short_second_share)
        .unwrap();
    let short_next_ceremony = fairness::random_ceremony(short_id, 1, short_config.players).unwrap();

    fairness::create_room(
        &db,
        short_id,
        short_config,
        RoomMode::Multiplayer,
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

    db.create_room(id, config, RoomMode::Multiplayer, &hash_token(tokens[0]))
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
