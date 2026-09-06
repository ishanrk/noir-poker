use crate::*;

pub(super) async fn attach_fairness(
    db: &Db,
    rooms: &HashMap<Uuid, Arc<Mutex<Room>>>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let entries: Vec<_> = rooms
        .iter()
        .map(|(id, room)| (*id, Arc::clone(room)))
        .collect();

    for (id, room) in entries {
        let players = room.lock().await.config.players;
        let pending = fairness::load_pending(db, id, players).await?;
        let current = fairness::current_commitment(db, id).await?;
        let mut room = room.lock().await;

        room.ceremony = pending;
        room.current_commitment = current.map(|(commitment, _)| commitment);
        room.current_protocol = current.map_or(1, |(_, version)| version);
        if room.hand.is_none() && room.ceremony.is_none() {
            return Err(recovery_error(id, "pending ceremony missing").into());
        }
    }

    Ok(())
}

pub(super) fn restore_rooms(
    stored: Vec<StoredRoom>,
) -> Result<HashMap<Uuid, Arc<Mutex<Room>>>, io::Error> {
    let mut rooms = HashMap::with_capacity(stored.len());

    for stored in stored {
        let id = stored.id;
        let room = restore_room(stored)?;

        if rooms.insert(id, Arc::new(Mutex::new(room))).is_some() {
            return Err(recovery_error(id, "duplicate room"));
        }
    }

    Ok(rooms)
}

pub(super) fn restore_room(stored: StoredRoom) -> Result<Room, io::Error> {
    let id = stored.id;
    let mode = RoomMode::parse(&stored.mode).ok_or_else(|| recovery_error(id, "invalid mode"))?;
    let config = RoomConfig {
        players: usize::try_from(stored.players)
            .map_err(|_| recovery_error(id, "invalid player count"))?,
        stack: u32::try_from(stored.stack).map_err(|_| recovery_error(id, "invalid stack"))?,
        small_blind: u32::try_from(stored.small_blind)
            .map_err(|_| recovery_error(id, "invalid small blind"))?,
        big_blind: u32::try_from(stored.big_blind)
            .map_err(|_| recovery_error(id, "invalid big blind"))?,
    };
    let rev = u64::try_from(stored.rev).map_err(|_| recovery_error(id, "invalid revision"))?;

    config
        .validate()
        .map_err(|_| recovery_error(id, "invalid room config"))?;

    if stored.seats.is_empty() || stored.seats.len() > config.players {
        return Err(recovery_error(id, "invalid seat count"));
    }

    let mut seats = Vec::with_capacity(stored.seats.len());

    for (expected, seat) in stored.seats.into_iter().enumerate() {
        let index =
            usize::try_from(seat.seat).map_err(|_| recovery_error(id, "invalid seat index"))?;
        let token_hash = seat
            .token_hash
            .try_into()
            .map_err(|_| recovery_error(id, "invalid token hash"))?;

        if index != expected {
            return Err(recovery_error(id, "seat sequence gap"));
        }

        seats.push(Seat {
            token_hash,
            ready_hand: seat.ready_hand,
            proof_points: u64::try_from(seat.proof_points)
                .map_err(|_| recovery_error(id, "invalid proof points"))?,
        });
    }

    let (hand, facts) = match stored.hand {
        Some(hand) if seats.len() == config.players => {
            let (hand, facts) = restore_hand(id, config, hand)?;

            (Some(hand), facts)
        }
        Some(_) => return Err(recovery_error(id, "hand before room full")),
        None => (None, None),
    };
    let (current_challenges, next_challenges, proof_points) = match &hand {
        Some(hand) => restore_challenges(
            id,
            hand,
            facts.as_deref(),
            stored.challenges,
            config.players,
            mode,
        )?,
        None if stored.challenges.is_empty() => (
            vec![None; config.players],
            vec![None; config.players],
            vec![0; config.players],
        ),
        None => return Err(recovery_error(id, "challenge without hand")),
    };

    if seats
        .iter()
        .zip(proof_points)
        .any(|(seat, points)| seat.proof_points != points)
    {
        return Err(recovery_error(id, "proof points mismatch"));
    }
    let ready_count = match &hand {
        Some(hand) => {
            let mut count = 0;

            for seat in &seats {
                match seat.ready_hand {
                    Some(ready) if ready == hand.id && hand.game.settled => count += 1,
                    Some(_) => return Err(recovery_error(id, "invalid ready hand")),
                    None => {}
                }
            }

            count
        }
        None if seats.iter().any(|seat| seat.ready_hand.is_some()) => {
            return Err(recovery_error(id, "ready seat without hand"));
        }
        None => 0,
    };
    let action_count = hand.as_ref().map_or(0, |hand| hand.next_seq);
    let seat_revs =
        u64::try_from(seats.len() - 1).map_err(|_| recovery_error(id, "revision limit reached"))?;
    let min_rev = seat_revs
        .checked_add(action_count)
        .and_then(|rev| rev.checked_add(ready_count))
        .and_then(|rev| {
            rev.checked_add(
                u64::try_from(
                    current_challenges.iter().flatten().count()
                        + next_challenges.iter().flatten().count(),
                )
                .ok()?,
            )
        })
        .and_then(|rev| {
            rev.checked_add(
                u64::try_from(
                    current_challenges
                        .iter()
                        .chain(&next_challenges)
                        .flatten()
                        .filter(|challenge| challenge.draw_verified)
                        .count(),
                )
                .ok()?,
            )
        })
        .and_then(|rev| {
            rev.checked_add(
                u64::try_from(
                    current_challenges
                        .iter()
                        .chain(&next_challenges)
                        .flatten()
                        .filter(|challenge| challenge.nullifier.is_some())
                        .count(),
                )
                .ok()?,
            )
        })
        .ok_or_else(|| recovery_error(id, "revision limit reached"))?;

    if rev < min_rev {
        return Err(recovery_error(id, "revision behind room state"));
    }

    let (notify, _) = broadcast::channel(16);

    Ok(Room {
        config,
        mode,
        seats,
        hand,
        current_commitment: None,
        current_protocol: 1,
        ceremony: None,
        current_challenges,
        next_challenges,
        rev,
        notify,
    })
}

pub(super) fn restore_hand(
    id: Uuid,
    config: RoomConfig,
    stored: StoredHand,
) -> Result<(LiveHand, Option<Vec<Facts>>), io::Error> {
    let no =
        u64::try_from(stored.hand_no).map_err(|_| recovery_error(id, "invalid hand number"))?;
    let seed = stored
        .seed
        .try_into()
        .map_err(|_| recovery_error(id, "invalid hand seed"))?;
    let dealer =
        usize::try_from(stored.dealer).map_err(|_| recovery_error(id, "invalid dealer"))?;
    let stacks = stored
        .stacks
        .into_iter()
        .map(|stack| u32::try_from(stack).map_err(|_| recovery_error(id, "invalid hand stack")))
        .collect::<Result<Vec<_>, _>>()?;
    let total: u64 = stacks.iter().map(|&stack| u64::from(stack)).sum();

    if stacks.len() != config.players
        || dealer >= config.players
        || stacks.iter().any(|&stack| stack < config.big_blind)
        || total > u64::from(u32::MAX)
    {
        return Err(recovery_error(id, "invalid hand inputs"));
    }

    let next_seq = u64::try_from(stored.actions.len())
        .map_err(|_| recovery_error(id, "action limit reached"))?;
    let mut actions = Vec::with_capacity(stored.actions.len());

    // replay persisted actions
    for (expected, stored) in stored.actions.into_iter().enumerate() {
        let expected =
            u64::try_from(expected).map_err(|_| recovery_error(id, "action limit reached"))?;
        let seq =
            u64::try_from(stored.seq).map_err(|_| recovery_error(id, "invalid action sequence"))?;
        let player = usize::try_from(stored.player)
            .map_err(|_| recovery_error(id, "invalid action player"))?;
        let action = restore_action(&stored).map_err(|err| recovery_error(id, err))?;

        if seq != expected {
            return Err(recovery_error(id, "action sequence gap"));
        }

        if player >= config.players {
            return Err(recovery_error(id, "invalid action player"));
        }

        actions.push(PlayedAction { player, action });
    }

    let (game, result, facts) = replay_hand(config, seed, dealer, &stacks, &actions)
        .map_err(|_| recovery_error(id, "action replay failed"))?;
    let facts = game.settled.then_some(facts);

    Ok((
        LiveHand {
            id: stored.id,
            no,
            seed,
            starting_stacks: stacks.clone(),
            game,
            result,
            next_seq,
            actions,
        },
        facts,
    ))
}

pub(super) fn restore_challenges(
    id: Uuid,
    hand: &LiveHand,
    facts: Option<&[Facts]>,
    stored: Vec<StoredChallenge>,
    players: usize,
    mode: RoomMode,
) -> Result<(Challenges, Challenges, Vec<u64>), io::Error> {
    let mut current = vec![None; players];
    let mut next = vec![None; players];
    let mut proof_points = vec![0u64; players];
    let next_no = hand
        .no
        .checked_add(1)
        .ok_or_else(|| recovery_error(id, "hand limit reached"))?;

    for stored in stored {
        let no = u64::try_from(stored.hand_no)
            .map_err(|_| recovery_error(id, "invalid challenge hand"))?;

        if no > next_no {
            return Err(recovery_error(id, "future challenge hand"));
        }

        let seat = usize::try_from(stored.seat)
            .map_err(|_| recovery_error(id, "invalid challenge seat"))?;

        if seat >= players
            || stored.version != i32::from(PROTOCOL_VERSION)
            || mode == RoomMode::Single && seat != 0
        {
            return Err(recovery_error(id, "invalid challenge assignment"));
        }

        let tag: [u8; 32] = stored
            .hand_tag
            .try_into()
            .map_err(|_| recovery_error(id, "invalid challenge hand tag"))?;
        let commitment = stored
            .commitment
            .try_into()
            .map_err(|_| recovery_error(id, "invalid challenge commitment"))?;
        let nonce = stored
            .nonce
            .try_into()
            .map_err(|_| recovery_error(id, "invalid challenge nonce"))?;
        let root = stored
            .catalog_root
            .try_into()
            .map_err(|_| recovery_error(id, "invalid challenge catalog root"))?;
        let salt = stored
            .facts_salt
            .as_deref()
            .map(|salt| {
                salt.try_into()
                    .map_err(|_| recovery_error(id, "invalid challenge facts salt"))
            })
            .transpose()?;
        let stored_hash = stored
            .facts_hash
            .as_deref()
            .map(|hash| {
                hash.try_into()
                    .map_err(|_| recovery_error(id, "invalid challenge facts hash"))
            })
            .transpose()?;

        if tag != hand_tag(*id.as_bytes(), no) || root != catalog_root() {
            return Err(recovery_error(id, "challenge hand tag mismatch"));
        }

        let draw = match (
            &stored.draw_proof,
            &stored.draw_public_inputs,
            stored.draw_verified,
        ) {
            (Some(proof), Some(public), true) => {
                let proof = decode_bytes(proof.clone(), public.clone())
                    .map_err(|_| recovery_error(id, "invalid draw proof"))?;
                let inputs = proof.inputs;

                if inputs.mode != MODE_DRAW
                    || usize::from(inputs.seat) != seat
                    || inputs.hand_tag != tag
                    || inputs.commitment != commitment
                    || inputs.nonce != nonce
                    || inputs.catalog_root != root
                    || inputs.facts_hash != [0; 32]
                    || inputs.nullifier != [0; 32]
                {
                    return Err(recovery_error(id, "draw proof mismatch"));
                }

                true
            }
            (None, None, false) => false,
            _ => return Err(recovery_error(id, "invalid draw proof")),
        };

        if salt.is_some() != stored_hash.is_some() {
            return Err(recovery_error(id, "invalid challenge facts"));
        }

        let mut challenge = Challenge {
            hand_no: no,
            seat,
            hand_tag: tag,
            commitment,
            nonce,
            catalog_root: root,
            draw_verified: draw,
            facts_salt: salt,
            facts_hash: stored_hash,
            facts: None,
            nullifier: None,
            points: None,
        };

        match (
            &stored.nullifier,
            stored.points,
            &stored.completion_proof,
            &stored.completion_public_inputs,
            stored.claimed,
        ) {
            (Some(nullifier), Some(points), Some(proof), Some(public), true) => {
                let nullifier: [u8; 32] = nullifier
                    .as_slice()
                    .try_into()
                    .map_err(|_| recovery_error(id, "invalid challenge nullifier"))?;
                let points = u32::try_from(points)
                    .map_err(|_| recovery_error(id, "invalid challenge points"))?;
                let proof = decode_bytes(proof.clone(), public.clone())
                    .map_err(|_| recovery_error(id, "invalid completion proof"))?;
                let inputs = proof.inputs;

                if !draw
                    || points != u32::from(POINTS)
                    || inputs.mode != MODE_COMPLETE
                    || usize::from(inputs.seat) != seat
                    || inputs.hand_tag != tag
                    || inputs.commitment != commitment
                    || inputs.nonce != nonce
                    || inputs.catalog_root != root
                    || Some(inputs.facts_hash) != stored_hash
                    || inputs.nullifier != nullifier
                {
                    return Err(recovery_error(id, "completion proof mismatch"));
                }

                challenge.nullifier = Some(nullifier);
                challenge.points = Some(points);
                proof_points[seat] = proof_points[seat]
                    .checked_add(u64::from(points))
                    .ok_or_else(|| recovery_error(id, "proof points limit reached"))?;
            }
            (None, None, None, None, false) => {}
            _ => return Err(recovery_error(id, "invalid challenge claim")),
        }

        if no < hand.no {
            if !draw || salt.is_none() || stored_hash.is_none() {
                return Err(recovery_error(id, "invalid historical challenge"));
            }

            continue;
        }

        if no == hand.no {
            if hand.no == 0 || !draw || current[seat].is_some() {
                return Err(recovery_error(id, "invalid current challenge"));
            }

            match (hand.game.settled, facts, salt, stored_hash) {
                (true, Some(facts), Some(salt), Some(stored_hash)) => {
                    let expected = facts_hash(tag, seat as u8, salt, facts[seat]);

                    if stored_hash != expected {
                        return Err(recovery_error(id, "challenge facts hash mismatch"));
                    }

                    challenge.facts = Some(facts[seat]);
                }
                (false, _, None, None) if challenge.nullifier.is_none() => {}
                _ => return Err(recovery_error(id, "invalid challenge facts")),
            }

            current[seat] = Some(challenge);
        } else {
            if !hand.game.settled
                || salt.is_some()
                || stored_hash.is_some()
                || challenge.nullifier.is_some()
                || next[seat].is_some()
            {
                return Err(recovery_error(id, "invalid next challenge"));
            }

            next[seat] = Some(challenge);
        }
    }

    let missing = if mode == RoomMode::Single {
        current[0].is_none()
    } else {
        current.iter().any(Option::is_none)
    };

    if hand.no > 0 && missing {
        return Err(recovery_error(id, "current challenge missing"));
    }

    Ok((current, next, proof_points))
}

pub(super) fn restore_action(stored: &StoredAction) -> Result<Action, &'static str> {
    match (stored.action.as_str(), stored.raise_to) {
        ("fold", None) => Ok(Action::Fold),
        ("check", None) => Ok(Action::Check),
        ("call", None) => Ok(Action::Call),
        ("raise_to", Some(to)) => u32::try_from(to)
            .map(Action::RaiseTo)
            .map_err(|_| "invalid raise target"),
        ("fold" | "check" | "call" | "raise_to", _) => Err("invalid action value"),
        _ => Err("unknown action"),
    }
}

pub(super) fn recovery_error(room: Uuid, message: &str) -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidData,
        format!("cannot restore room {room}: {message}"),
    )
}

pub(super) async fn finish_pending_challenges(
    db: &Db,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    while let Some(pending) = db.pending_challenge().await? {
        let nonce = secure_nonce()?;
        let next_rev = pending
            .rev
            .checked_add(1)
            .ok_or_else(|| io::Error::other("revision limit reached"))?;

        db.assign_challenge(ChallengeEntropy {
            room: pending.room,
            hand_no: pending.hand_no,
            seat: pending.seat,
            hand_tag: pending.hand_tag,
            commitment: pending.commitment,
            nonce,
            catalog_root: catalog_root(),
            rev: pending.rev,
            next_rev,
        })
        .await?;
    }

    Ok(())
}
