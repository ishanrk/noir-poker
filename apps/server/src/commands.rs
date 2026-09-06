use crate::*;

pub(super) async fn initial_entropy(
    state: &AppState,
    id: Uuid,
    seat: usize,
    hand_no: u64,
    commitment: &str,
    entropy: &str,
) -> Result<(), &'static str> {
    let share = decode_hex(entropy).ok_or("invalid deal entropy")?;
    let room = find_room(state, id).await.ok_or("room not found")?;
    let mut room = room.lock().await;

    if room.hand.is_some() {
        return Err("deal already started");
    }
    check_ceremony(&room, hand_no, commitment)?;
    if seat >= room.seats.len() {
        return Err("invalid player");
    }

    let ceremony = room
        .ceremony
        .as_ref()
        .ok_or("deal ceremony missing")?
        .clone();

    if let Some(existing) = ceremony.shares[seat] {
        return if existing == share {
            Ok(())
        } else {
            Err("deal entropy conflict")
        };
    }
    if room.mode != RoomMode::Single {
        let final_share = room.seats.len() == room.config.players
            && ceremony
                .shares
                .iter()
                .enumerate()
                .all(|(index, stored)| index == seat || stored.is_some());
        let seed = if final_share {
            Some(ceremony.seed_with(id, seat, share)?)
        } else {
            None
        };
        let next_rev = room.rev.checked_add(1).ok_or("revision limit reached")?;
        let hand = seed.map(|seed| LiveHand {
            id: Uuid::new_v4(),
            no: ceremony.hand_no,
            seed,
            starting_stacks: vec![room.config.stack; room.config.players],
            game: start_game(room.config, seed),
            result: None,
            next_seq: 0,
            actions: Vec::new(),
        });
        let next = if final_share {
            Some(
                fairness::random_ceremony(
                    id,
                    hand_no.checked_add(1).ok_or("hand limit reached")?,
                    room.config.players,
                )
                .map_err(|_| "cannot create deal ceremony")?,
            )
        } else {
            None
        };
        fairness::contribute(
            &state.db,
            id,
            seat,
            share,
            room.rev,
            next_rev,
            &ceremony,
            hand.as_ref().map(|hand| NewHand {
                id: hand.id,
                no: hand.no,
                seed: &hand.seed,
                dealer: hand.game.dealer,
                stacks: &hand.starting_stacks,
            }),
            next.as_ref(),
        )
        .await
        .map_err(|_| "cannot persist deal contribution")?;
        room.ceremony.as_mut().expect("staged ceremony").shares[seat] = Some(share);
        if let Some(hand) = hand {
            room.current_commitment = Some(ceremony.commitment);
            room.current_protocol = ceremony.protocol_version;
            room.hand = Some(hand);
            room.ceremony = next;
        }
        room.changed(next_rev);
        return Ok(());
    }
    if seat != 0 || room.seats.len() != 1 {
        return Err("single deal unavailable");
    }

    let tokens = (1..room.config.players)
        .map(|_| room_token(&room).1)
        .collect::<Vec<_>>();
    let next_rev = room
        .rev
        .checked_add(u64::try_from(tokens.len()).map_err(|_| "revision limit reached")?)
        .ok_or("revision limit reached")?;
    let mut completed = ceremony.clone();

    completed.shares[0] = Some(share);
    for seat in 1..room.config.players {
        completed.shares[seat] = Some(fairness::bot_share(id, &ceremony, seat));
    }

    let seed = completed
        .shares
        .iter()
        .copied()
        .collect::<Option<Vec<_>>>()
        .and_then(|shares| {
            deal_core::seed(
                *id.as_bytes(),
                ceremony.hand_no,
                ceremony.server_secret,
                &shares,
            )
        })
        .ok_or("cannot derive deal seed")?;
    let stacks = vec![room.config.stack; room.config.players];
    let hand = LiveHand {
        id: Uuid::new_v4(),
        no: 0,
        seed,
        starting_stacks: stacks.clone(),
        game: start_game(room.config, seed),
        result: None,
        next_seq: 0,
        actions: Vec::new(),
    };
    let next = fairness::random_ceremony(id, 1, room.config.players)
        .map_err(|_| "cannot create deal ceremony")?;
    let new_hand = NewHand {
        id: hand.id,
        no: hand.no,
        seed: &hand.seed,
        dealer: hand.game.dealer,
        stacks: &stacks,
    };

    fairness::start_single(
        &state.db, id, &tokens, share, room.rev, next_rev, &ceremony, new_hand, &next,
    )
    .await
    .map_err(|_| "cannot start single deal")?;
    room.commit_single_start(tokens, hand, next, next_rev);
    drop(room);
    drive_bots(state, id).await
}

#[cfg(test)]
pub(super) async fn apply_action(
    state: &AppState,
    id: Uuid,
    seat: usize,
    action: Action,
) -> Result<(), &'static str> {
    apply_action_once(state, id, seat, action).await?;
    drive_bots(state, id).await
}

pub(super) async fn apply_action_once(
    state: &AppState,
    id: Uuid,
    seat: usize,
    action: Action,
) -> Result<(), &'static str> {
    let room = find_room(state, id).await.ok_or("room not found")?;
    let mut room = room.lock().await;
    commit_action(state, id, &mut room, seat, action).await
}

pub(super) async fn commit_action(
    state: &AppState,
    id: Uuid,
    room: &mut Room,
    seat: usize,
    action: Action,
) -> Result<(), &'static str> {
    let mut next = room.stage_action(seat, action)?;

    if next.facts.is_some() {
        let count = if room.mode == RoomMode::Single {
            1
        } else {
            room.config.players
        };
        let salts = (0..count)
            .map(|_| secure_nonce().map_err(|_| "cannot commit challenge facts"))
            .collect::<Result<Vec<_>, _>>()?;

        bind_facts(&mut next, &room.current_challenges, salts, room.mode)?;
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

pub(super) async fn drive_bots(state: &AppState, id: Uuid) -> Result<(), &'static str> {
    // bot loop bound
    for _ in 0..128 {
        let next = {
            let room = find_room(state, id).await.ok_or("room not found")?;
            let room = room.lock().await;

            next_bot_action(id, &room)?
        };

        let Some((seat, action)) = next else {
            return Ok(());
        };

        apply_action_once(state, id, seat, action).await?;
    }

    Err("bot action limit")
}

pub(super) fn next_bot_action(
    room: Uuid,
    state: &Room,
) -> Result<Option<(usize, Action)>, &'static str> {
    if state.mode != RoomMode::Single {
        return Ok(None);
    }

    let hand = state.hand.as_ref().ok_or("game not started")?;

    if hand.game.settled || hand.game.turn == 0 {
        return Ok(None);
    }

    let seat = hand.game.turn;
    let action = bot_action(room, hand.no, hand.next_seq, &hand.game, seat)?;

    Ok(Some((seat, action)))
}

pub(super) fn bot_action(
    room: Uuid,
    hand_no: u64,
    seq: u64,
    game: &State,
    seat: usize,
) -> Result<Action, &'static str> {
    let legal = game.legal_actions(seat).ok_or("bot action unavailable")?;
    let opponents = game
        .players
        .iter()
        .enumerate()
        .filter(|(index, player)| *index != seat && !player.folded)
        .count();
    let seed = bot_seed(room, hand_no, seq, seat);

    Ok(bot::action(bot::View {
        hole: game.hole[seat],
        board: &game.board,
        pot: game.pot,
        legal,
        opponents,
        seed,
    }))
}

pub(super) fn bot_seed(room: Uuid, hand_no: u64, seq: u64, seat: usize) -> [u8; 32] {
    let mut input = Sha256::new();

    input.update(b"NPBOT02");
    input.update(room.as_bytes());
    input.update(hand_no.to_be_bytes());
    input.update(seq.to_be_bytes());
    input.update((seat as u64).to_be_bytes());
    input.finalize().into()
}

pub(super) async fn challenge_room(
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

pub(super) async fn claim_room(
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
            if err
                .downcast_ref::<io::Error>()
                .is_some_and(|err| err.kind() == io::ErrorKind::WouldBlock)
            {
                return Err("proof verifier busy");
            }
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

pub(super) async fn draw_room(
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
            if err
                .downcast_ref::<io::Error>()
                .is_some_and(|err| err.kind() == io::ErrorKind::WouldBlock)
            {
                return Err("proof verifier busy");
            }
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

pub(super) fn draw_matches(inputs: ProofInputs, draw: PendingDraw) -> bool {
    inputs.mode == MODE_DRAW
        && usize::from(inputs.seat) == draw.seat
        && inputs.hand_tag == draw.hand_tag
        && inputs.commitment == draw.commitment
        && inputs.nonce == draw.nonce
        && inputs.catalog_root == draw.catalog_root
        && inputs.facts_hash == [0; 32]
        && inputs.nullifier == [0; 32]
}

pub(super) fn claim_matches(inputs: ProofInputs, claim: PendingClaim) -> bool {
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
pub(super) async fn ready_room(
    state: &AppState,
    id: Uuid,
    seat: usize,
) -> Result<(), &'static str> {
    let share = secure_nonce().map_err(|_| "cannot create deal entropy")?;
    ready_room_entropy(state, id, seat, &encode_hex(share)).await
}

#[cfg(test)]
pub(super) async fn ready_room_entropy(
    state: &AppState,
    id: Uuid,
    seat: usize,
    entropy: &str,
) -> Result<(), &'static str> {
    ready_room_entropy_once(state, id, seat, entropy, None).await?;
    drive_bot_ready(state, id).await?;
    drive_bots(state, id).await
}

pub(super) async fn ready_room_entropy_once(
    state: &AppState,
    id: Uuid,
    seat: usize,
    entropy: &str,
    binding: Option<(u64, &str)>,
) -> Result<(), &'static str> {
    let share = decode_hex(entropy).ok_or("invalid deal entropy")?;
    let room = find_room(state, id).await.ok_or("room not found")?;
    let mut room = room.lock().await;
    if let Some((hand_no, commitment)) = binding {
        check_ceremony(&room, hand_no, commitment)?;
    }
    let ceremony = room.ceremony.as_ref().ok_or("deal ceremony missing")?;
    if let Some(existing) = ceremony.shares.get(seat).copied().flatten() {
        return if existing == share {
            Ok(())
        } else {
            Err("deal entropy conflict")
        };
    }

    if room.mode == RoomMode::Single
        && seat != 0
        && share != fairness::bot_share(id, ceremony, seat)
    {
        return Err("invalid bot entropy");
    }

    let pending = room.stage_fair_ready(seat, share)?;
    let seed = if pending.all {
        Some(ceremony.seed_with(id, seat, share)?)
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

pub(super) async fn drive_bot_ready(state: &AppState, id: Uuid) -> Result<(), &'static str> {
    for _ in 0..6 {
        let (seat, share) = {
            let room = find_room(state, id).await.ok_or("room not found")?;
            let room = room.lock().await;
            let hand = room.hand.as_ref().ok_or("game not started")?;

            if room.mode != RoomMode::Single
                || !hand.game.settled
                || room.seats[0].ready_hand != Some(hand.id)
            {
                return Ok(());
            }

            match room
                .seats
                .iter()
                .enumerate()
                .skip(1)
                .find(|(_, player)| player.ready_hand != Some(hand.id))
            {
                Some((seat, _)) => {
                    let ceremony = room.ceremony.as_ref().ok_or("deal ceremony missing")?;

                    (seat, fairness::bot_share(id, ceremony, seat))
                }
                None => return Ok(()),
            }
        };

        ready_room_entropy_once(state, id, seat, &encode_hex(share), None).await?;
    }

    Err("bot ready limit")
}

pub(super) fn check_ceremony(
    room: &Room,
    hand_no: u64,
    commitment: &str,
) -> Result<(), &'static str> {
    let ceremony = room.ceremony.as_ref().ok_or("deal ceremony missing")?;
    if ceremony.hand_no != hand_no || Some(ceremony.commitment) != decode_hex(commitment) {
        return Err("stale deal ceremony");
    }
    Ok(())
}

pub(super) async fn ready_bound(
    state: &AppState,
    id: Uuid,
    seat: usize,
    hand_no: u64,
    commitment: &str,
    entropy: &str,
) -> Result<(), &'static str> {
    ready_room_entropy_once(state, id, seat, entropy, Some((hand_no, commitment))).await?;
    drive_bot_ready(state, id).await?;
    drive_bots(state, id).await
}

#[allow(clippy::too_many_arguments)]
pub(super) async fn betting_command(
    state: &AppState,
    id: Uuid,
    seat: usize,
    action: Action,
    hand_no: u64,
    rev: u64,
    request_id: Uuid,
) -> Result<(), &'static str> {
    let room = find_room(state, id).await.ok_or("room not found")?;
    let mut room = room.lock().await;
    check_action(&room, hand_no, rev, seat, request_id)?;
    commit_action(state, id, &mut room, seat, action).await?;
    drop(room);
    drive_bots(state, id).await
}

pub(super) fn check_action(
    room: &Room,
    hand_no: u64,
    rev: u64,
    seat: usize,
    request_id: Uuid,
) -> Result<(), &'static str> {
    let hand = room.hand.as_ref().ok_or("game not started")?;
    if request_id.is_nil()
        || hand.no != hand_no
        || room.rev != rev
        || hand.game.turn != seat
        || hand.game.settled
    {
        return Err("stale poker action");
    }
    Ok(())
}

#[cfg(test)]
pub(super) async fn single_entropy(
    state: &AppState,
    id: Uuid,
    seat: usize,
    entropy: &str,
) -> Result<(), &'static str> {
    let (hand_no, commitment) = {
        let room = find_room(state, id).await.ok_or("room not found")?;
        let room = room.lock().await;
        let ceremony = room.ceremony.as_ref().ok_or("deal ceremony missing")?;
        (ceremony.hand_no, encode_hex(ceremony.commitment))
    };
    initial_entropy(state, id, seat, hand_no, &commitment, entropy).await
}
