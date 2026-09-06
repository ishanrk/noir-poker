use crate::*;

pub(super) async fn current_message(
    state: &AppState,
    id: Uuid,
    seat: usize,
) -> Option<ServerMessage> {
    let room = find_room(state, id).await?;
    let room = room.lock().await;

    Some(room_message(id, &room, seat))
}

pub(super) fn room_message(id: Uuid, room: &Room, seat: usize) -> ServerMessage {
    match &room.hand {
        Some(hand) => ServerMessage::Snapshot {
            rev: room.rev,
            view: Box::new(room_view(id, room, hand, seat)),
        },
        None => match room.ceremony.as_ref() {
            Some(ceremony) => ServerMessage::WaitingFair {
                rev: room.rev,
                joined: room.seats.len(),
                players: room.config.players,
                mode: room.mode,
                deal: pending_deal_view(
                    ceremony,
                    seat,
                    room.config,
                    room.hand
                        .as_ref()
                        .map_or(0, |hand| (hand.game.dealer + 1) % room.config.players),
                ),
            },
            None => ServerMessage::Waiting {
                joined: room.seats.len(),
                players: room.config.players,
                mode: room.mode,
            },
        },
    }
}

pub(super) fn room_view(id: Uuid, room: &Room, hand: &LiveHand, seat: usize) -> SeatView {
    let mut view = seat_view(&hand.game, seat);

    view.mode = room.mode;
    view.hand_no = hand.no;
    view.deal = room.current_commitment.map(|commitment| DealView {
        protocol_version: room.current_protocol,
        config: room.config,
        dealer: hand.game.dealer,
        hand_no: hand.no,
        commitment: encode_hex(commitment),
        contributors: room.config.players,
        required: room.config.players,
        mine: true,
        state: if hand.game.settled {
            "revealed"
        } else {
            "sealed"
        },
        audit: hand.game.settled,
    });

    for (player, stored) in view.players.iter_mut().zip(&room.seats) {
        player.proof_points = stored.proof_points;
    }

    if hand.game.settled {
        view.result = Some(result_view(
            &hand.game,
            hand.result.as_ref().expect("settled result"),
        ));
        let count = room
            .seats
            .iter()
            .filter(|seat| seat.ready_hand == Some(hand.id))
            .count();

        view.ready = Some(ReadyView {
            mine: room.seats[seat].ready_hand == Some(hand.id),
            count,
            players: room.seats.len(),
            complete: count == room.seats.len(),
        });

        let next_no = hand.no.checked_add(1).expect("valid hand number");
        view.next_deal = room.ceremony.as_ref().map(|ceremony| {
            pending_deal_view(
                ceremony,
                seat,
                room.config,
                room.hand
                    .as_ref()
                    .map_or(0, |hand| (hand.game.dealer + 1) % room.config.players),
            )
        });
        view.challenge = Some(challenge_view(
            next_no,
            hand_tag(*id.as_bytes(), next_no),
            room.next_challenges[seat].as_ref(),
        ));

        if let Some(challenge) = room.current_challenges[seat].as_ref() {
            view.claim = challenge
                .facts
                .zip(challenge.facts_salt)
                .zip(challenge.facts_hash)
                .map(|((facts, salt), hash)| ClaimView {
                    hand_no: challenge.hand_no,
                    hand_tag: encode_hex(challenge.hand_tag),
                    commitment: encode_hex(challenge.commitment),
                    nonce: encode_hex(challenge.nonce),
                    catalog_root: encode_hex(challenge.catalog_root),
                    facts_salt: encode_hex(salt),
                    facts_hash: encode_hex(hash),
                    facts: facts.bytes(),
                    status: if challenge.nullifier.is_some() {
                        "claimed"
                    } else {
                        "claimable"
                    },
                    points: challenge.points,
                    nullifier: challenge.nullifier.map(encode_hex),
                });
        }
    } else if let Some(challenge) = room.current_challenges[seat].as_ref() {
        view.challenge = Some(challenge_view(
            challenge.hand_no,
            challenge.hand_tag,
            Some(challenge),
        ));
    }

    view
}

pub(super) fn pending_deal_view(
    ceremony: &Ceremony,
    seat: usize,
    config: RoomConfig,
    dealer: usize,
) -> DealView {
    DealView {
        protocol_version: ceremony.protocol_version,
        config,
        dealer,
        hand_no: ceremony.hand_no,
        commitment: encode_hex(ceremony.commitment),
        contributors: ceremony.contributors(),
        required: config.players,
        mine: ceremony
            .shares
            .get(seat)
            .is_some_and(|share| share.is_some()),
        state: "collecting",
        audit: false,
    }
}

pub(super) fn challenge_view(
    hand_no: u64,
    hand_tag: [u8; 32],
    challenge: Option<&Challenge>,
) -> ChallengeView {
    ChallengeView {
        hand_no,
        assigned: challenge.is_some(),
        draw_verified: challenge.is_some_and(|challenge| challenge.draw_verified),
        hand_tag: encode_hex(hand_tag),
        commitment: challenge.map(|challenge| encode_hex(challenge.commitment)),
        nonce: challenge.map(|challenge| encode_hex(challenge.nonce)),
        catalog_root: challenge.map(|challenge| encode_hex(challenge.catalog_root)),
    }
}

pub(super) fn result_view(game: &State, result: &HandResult) -> HandResultView {
    let revealed = game
        .players
        .iter()
        .enumerate()
        .map(|(seat, player)| match result.kind {
            HandResultKind::Showdown if !player.folded => Some(game.hole[seat].map(card_view)),
            HandResultKind::Fold | HandResultKind::Showdown => None,
        })
        .collect();

    HandResultView {
        kind: match result.kind {
            HandResultKind::Fold => "fold",
            HandResultKind::Showdown => "showdown",
        },
        awards: result
            .awards
            .iter()
            .map(|award| AwardView {
                player: award.player,
                amount: award.amount,
            })
            .collect(),
        revealed,
    }
}

pub(super) fn seat_view(game: &State, seat: usize) -> SeatView {
    let players = game
        .players
        .iter()
        .map(|player| PlayerView {
            stack: player.stack,
            bet: player.bet,
            folded: player.folded,
            proof_points: 0,
        })
        .collect();
    let turn =
        (!game.round_complete && game.fold_winner.is_none() && !game.settled).then_some(game.turn);

    SeatView {
        mode: RoomMode::Multiplayer,
        players,
        hand_no: 0,
        deal: None,
        next_deal: None,
        hole: game.hole[seat].map(card_view),
        board: game.board.iter().copied().map(card_view).collect(),
        pot: game.pot,
        dealer: game.dealer,
        turn,
        street: street_view(game.street),
        round_complete: game.round_complete,
        settled: game.settled,
        actions: game.legal_actions(seat).map(action_view),
        result: None,
        ready: None,
        challenge: None,
        claim: None,
    }
}

pub(super) fn action_view(actions: LegalActions) -> ActionView {
    ActionView {
        fold: actions.fold,
        check: actions.check,
        call: actions.call,
        raise: actions.raise.map(|range| RaiseView {
            min_to: range.min_to,
            max_to: range.max_to,
        }),
    }
}

pub(super) fn card_view(card: Card) -> CardView {
    let rank = match card.rank() {
        Rank::Two => "2",
        Rank::Three => "3",
        Rank::Four => "4",
        Rank::Five => "5",
        Rank::Six => "6",
        Rank::Seven => "7",
        Rank::Eight => "8",
        Rank::Nine => "9",
        Rank::Ten => "10",
        Rank::Jack => "J",
        Rank::Queen => "Q",
        Rank::King => "K",
        Rank::Ace => "A",
    };
    let suit = match card.suit() {
        Suit::Clubs => "♣",
        Suit::Diamonds => "♦",
        Suit::Hearts => "♥",
        Suit::Spades => "♠",
    };

    CardView {
        value: format!("{rank}{suit}"),
    }
}

pub(super) fn street_view(street: Street) -> &'static str {
    match street {
        Street::Preflop => "preflop",
        Street::Flop => "flop",
        Street::Turn => "turn",
        Street::River => "river",
    }
}
