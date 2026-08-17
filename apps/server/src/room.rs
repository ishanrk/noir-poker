use challenge_core::{Facts, TIER_EASY, TIER_HARD, facts_hash, hand_tag};
use game_core::{Action, ActionError, Event, NextHandError, State, Street};
use serde::Deserialize;
use tokio::sync::broadcast;
use uuid::Uuid;

pub(super) type TokenHash = [u8; 32];
pub(super) type Challenges = Vec<Option<Challenge>>;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
pub(super) struct RoomConfig {
    pub(super) players: usize,
    pub(super) stack: u32,
    pub(super) small_blind: u32,
    pub(super) big_blind: u32,
}

impl RoomConfig {
    pub(super) fn validate(self) -> Result<(), &'static str> {
        if !(2..=6).contains(&self.players) {
            return Err("players must be 2 through 6");
        }

        if self.small_blind == 0 {
            return Err("small blind must be positive");
        }

        if self.big_blind < self.small_blind {
            return Err("big blind must cover small blind");
        }

        if self.stack < self.big_blind {
            return Err("stack must cover big blind");
        }

        let total = self.players as u64 * u64::from(self.stack);

        if total > u64::from(u32::MAX) {
            return Err("total stacks exceed chip limit");
        }

        Ok(())
    }
}

pub(super) struct Room {
    pub(super) config: RoomConfig,
    pub(super) seats: Vec<Seat>,
    pub(super) hand: Option<LiveHand>,
    pub(super) current_challenges: Challenges,
    pub(super) next_challenges: Challenges,
    pub(super) rev: u64,
    pub(super) notify: broadcast::Sender<u64>,
}

impl Room {
    pub(super) fn new(config: RoomConfig, token_hash: TokenHash) -> Result<Self, &'static str> {
        config.validate()?;
        let (notify, _) = broadcast::channel(16);

        Ok(Self {
            config,
            seats: vec![Seat {
                token_hash,
                ready_hand: None,
                proof_points: 0,
            }],
            hand: None,
            current_challenges: vec![None; config.players],
            next_challenges: vec![None; config.players],
            rev: 0,
            notify,
        })
    }

    pub(super) fn next_seat(&self) -> Result<usize, JoinError> {
        if self.hand.is_some() || self.seats.len() >= self.config.players {
            return Err(JoinError::Full);
        }

        Ok(self.seats.len())
    }

    pub(super) fn commit_join(&mut self, token_hash: TokenHash, hand: Option<LiveHand>, rev: u64) {
        self.seats.push(Seat {
            token_hash,
            ready_hand: None,
            proof_points: 0,
        });
        self.hand = hand;
        self.changed(rev);
    }

    pub(super) fn stage_ready(&self, seat: usize) -> Result<PendingReady, &'static str> {
        let hand = self.hand.as_ref().ok_or("game not started")?;
        let player = self.seats.get(seat).ok_or("invalid player")?;

        if !hand.game.settled {
            return Err("hand not settled");
        }

        if player.ready_hand == Some(hand.id) {
            return Err("already ready");
        }

        if self
            .next_challenges
            .get(seat)
            .and_then(Option::as_ref)
            .is_none()
        {
            return Err("challenge required");
        }

        let all = self
            .seats
            .iter()
            .enumerate()
            .all(|(i, player)| i == seat || player.ready_hand == Some(hand.id));

        Ok(PendingReady {
            hand: hand.id,
            rev: self.rev.checked_add(1).ok_or("revision limit reached")?,
            all,
        })
    }

    pub(super) fn stage_next_hand(&self, seed: [u8; 32]) -> Result<Option<LiveHand>, &'static str> {
        let hand = self.hand.as_ref().ok_or("game not started")?;
        let stacks = hand
            .game
            .players
            .iter()
            .map(|player| player.stack)
            .collect();
        let no = hand.no.checked_add(1).ok_or("hand limit reached")?;

        match hand.game.next_hand(seed) {
            Ok(game) => Ok(Some(LiveHand {
                id: Uuid::new_v4(),
                no,
                seed,
                starting_stacks: stacks,
                game,
                result: None,
                next_seq: 0,
                actions: Vec::new(),
            })),
            Err(NextHandError::CannotStart) => Ok(None),
            Err(NextHandError::NotSettled) => Err("hand not settled"),
        }
    }

    pub(super) fn commit_ready(&mut self, seat: usize, hand: Option<LiveHand>, rev: u64) {
        if let Some(hand) = hand {
            for player in &mut self.seats {
                player.ready_hand = None;
            }

            self.hand = Some(hand);
            self.current_challenges =
                std::mem::replace(&mut self.next_challenges, vec![None; self.config.players]);
        } else {
            let hand = self.hand.as_ref().expect("staged hand").id;

            self.seats[seat].ready_hand = Some(hand);
        }

        self.changed(rev);
    }

    pub(super) fn stage_challenge(
        &self,
        room: Uuid,
        seat: usize,
        hand_no: u64,
        tier: u8,
        commitment: [u8; 32],
    ) -> Result<PendingChallenge, &'static str> {
        let hand = self.hand.as_ref().ok_or("game not started")?;

        if !hand.game.settled {
            return Err("hand not settled");
        }

        let next_no = hand.no.checked_add(1).ok_or("hand limit reached")?;

        if hand_no != next_no {
            return Err("wrong challenge hand");
        }

        if tier != TIER_EASY && tier != TIER_HARD {
            return Err("invalid challenge tier");
        }

        if self
            .next_challenges
            .get(seat)
            .and_then(Option::as_ref)
            .is_some()
        {
            return Err("challenge already assigned");
        }

        Ok(PendingChallenge {
            hand_no,
            seat,
            tier,
            hand_tag: hand_tag(*room.as_bytes(), hand_no),
            commitment,
            rev: self.rev.checked_add(1).ok_or("revision limit reached")?,
        })
    }

    pub(super) fn commit_challenge(&mut self, challenge: Challenge, rev: u64) {
        let seat = challenge.seat;

        self.next_challenges[seat] = Some(challenge);
        self.changed(rev);
    }

    pub(super) fn stage_claim(
        &self,
        seat: usize,
        hand_no: u64,
    ) -> Result<PendingClaim, &'static str> {
        let hand = self.hand.as_ref().ok_or("game not started")?;

        if !hand.game.settled {
            return Err("hand not settled");
        }

        if hand.no != hand_no {
            return Err("wrong challenge hand");
        }

        let challenge = self
            .current_challenges
            .get(seat)
            .and_then(Option::as_ref)
            .ok_or("challenge missing")?;
        let facts_hash = challenge.facts_hash.ok_or("challenge facts missing")?;

        if challenge.nullifier.is_some() {
            return Err("challenge already claimed");
        }

        let points = challenge_points(challenge.tier)?;
        let prior_points = self.seats[seat].proof_points;
        let next_points = prior_points
            .checked_add(u64::from(points))
            .ok_or("proof points limit reached")?;

        Ok(PendingClaim {
            hand_no,
            seat,
            tier: challenge.tier,
            hand_tag: challenge.hand_tag,
            commitment: challenge.commitment,
            nonce: challenge.nonce,
            facts_hash,
            points,
            prior_points,
            next_points,
            rev: self.rev.checked_add(1).ok_or("revision limit reached")?,
        })
    }

    pub(super) fn commit_claim(&mut self, claim: PendingClaim, nullifier: [u8; 32]) {
        let challenge = self.current_challenges[claim.seat]
            .as_mut()
            .expect("staged challenge");

        challenge.nullifier = Some(nullifier);
        challenge.points = Some(claim.points);
        self.seats[claim.seat].proof_points = claim.next_points;
        self.changed(claim.rev);
    }

    pub(super) fn stage_action(
        &self,
        seat: usize,
        action: Action,
    ) -> Result<PendingAction, &'static str> {
        let hand = self.hand.as_ref().ok_or("game not started")?;

        // action staged on state clone
        let mut game = hand.game.clone();

        game.apply(seat, action).map_err(action_error)?;
        let result = advance(&mut game)?;

        let mut actions = hand.actions.clone();
        actions.push(PlayedAction {
            player: seat,
            action,
        });
        let facts = if game.settled && hand.no > 0 {
            let (replayed, replayed_result, facts) = replay_hand(
                self.config,
                hand.seed,
                hand.game.dealer,
                &hand.starting_stacks,
                &actions,
            )?;

            if replayed != game || replayed_result != result {
                return Err("hand replay mismatch");
            }

            Some(facts)
        } else {
            None
        };
        let fact_hashes = facts
            .as_ref()
            .map(|facts| challenge_hashes(&self.current_challenges, facts))
            .transpose()?;

        Ok(PendingAction {
            hand: hand.id,
            seq: hand.next_seq,
            next_seq: hand.next_seq.checked_add(1).ok_or("action limit reached")?,
            rev: self.rev.checked_add(1).ok_or("revision limit reached")?,
            player: seat,
            action,
            game,
            result,
            actions,
            facts,
            fact_hashes,
        })
    }

    pub(super) fn commit_action(&mut self, action: PendingAction) {
        let hand = self.hand.as_mut().expect("staged hand");

        hand.game = action.game;
        hand.result = action.result;
        hand.next_seq = action.next_seq;
        hand.actions = action.actions;

        if let Some(facts) = action.facts {
            for (seat, facts) in facts.into_iter().enumerate() {
                let challenge = self.current_challenges[seat]
                    .as_mut()
                    .expect("staged challenge");

                challenge.facts_hash = Some(facts_hash(challenge.hand_tag, seat as u8, facts));
                challenge.facts = Some(facts);
            }
        }

        self.changed(action.rev);
    }

    fn changed(&mut self, rev: u64) {
        self.rev = rev;
        let _ = self.notify.send(self.rev);
    }
}

pub(super) struct Seat {
    pub(super) token_hash: TokenHash,
    pub(super) ready_hand: Option<Uuid>,
    pub(super) proof_points: u64,
}

pub(super) struct LiveHand {
    pub(super) id: Uuid,
    pub(super) no: u64,
    pub(super) seed: [u8; 32],
    pub(super) starting_stacks: Vec<u32>,
    pub(super) game: State,
    pub(super) result: Option<HandResult>,
    pub(super) next_seq: u64,
    pub(super) actions: Vec<PlayedAction>,
}

#[derive(Clone, Copy)]
pub(super) struct PlayedAction {
    pub(super) player: usize,
    pub(super) action: Action,
}

#[derive(Clone)]
pub(super) struct Challenge {
    pub(super) hand_no: u64,
    pub(super) seat: usize,
    pub(super) tier: u8,
    pub(super) hand_tag: [u8; 32],
    pub(super) commitment: [u8; 32],
    pub(super) nonce: [u8; 32],
    pub(super) facts_hash: Option<[u8; 32]>,
    pub(super) facts: Option<Facts>,
    pub(super) nullifier: Option<[u8; 32]>,
    pub(super) points: Option<u32>,
}

pub(super) struct PendingChallenge {
    pub(super) hand_no: u64,
    pub(super) seat: usize,
    pub(super) tier: u8,
    pub(super) hand_tag: [u8; 32],
    pub(super) commitment: [u8; 32],
    pub(super) rev: u64,
}

pub(super) struct PendingReady {
    pub(super) hand: Uuid,
    pub(super) rev: u64,
    pub(super) all: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) struct PendingClaim {
    pub(super) hand_no: u64,
    pub(super) seat: usize,
    pub(super) tier: u8,
    pub(super) hand_tag: [u8; 32],
    pub(super) commitment: [u8; 32],
    pub(super) nonce: [u8; 32],
    pub(super) facts_hash: [u8; 32],
    pub(super) points: u32,
    pub(super) prior_points: u64,
    pub(super) next_points: u64,
    pub(super) rev: u64,
}

pub(super) struct PendingAction {
    pub(super) hand: Uuid,
    pub(super) seq: u64,
    pub(super) next_seq: u64,
    pub(super) rev: u64,
    pub(super) player: usize,
    pub(super) action: Action,
    pub(super) game: State,
    pub(super) result: Option<HandResult>,
    pub(super) actions: Vec<PlayedAction>,
    pub(super) facts: Option<Vec<Facts>>,
    pub(super) fact_hashes: Option<Vec<FactHash>>,
}

pub(super) struct FactHash {
    pub(super) seat: usize,
    pub(super) value: [u8; 32],
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct HandResult {
    pub(super) kind: HandResultKind,
    pub(super) awards: Vec<Award>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum HandResultKind {
    Fold,
    Showdown,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) struct Award {
    pub(super) player: usize,
    pub(super) amount: u32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum JoinError {
    Full,
}

pub(super) fn start_game(config: RoomConfig, seed: [u8; 32]) -> State {
    let stacks = vec![config.stack; config.players];

    State::new(seed, 0, &stacks, config.small_blind, config.big_blind)
}

// advance finished streets
fn advance(game: &mut State) -> Result<Option<HandResult>, &'static str> {
    if game.fold_winner.is_some() {
        return settle(game).map(Some);
    }

    while game.round_complete && !game.settled {
        if game.street == Street::River {
            return settle(game).map(Some);
        } else {
            game.advance_street().map_err(|_| "cannot advance hand")?;
        }
    }

    Ok(None)
}

pub(super) fn replay_hand(
    config: RoomConfig,
    seed: [u8; 32],
    dealer: usize,
    stacks: &[u32],
    actions: &[PlayedAction],
) -> Result<(State, Option<HandResult>, Vec<Facts>), &'static str> {
    let mut game = State::new(seed, dealer, stacks, config.small_blind, config.big_blind);
    let mut facts = vec![empty_facts(); stacks.len()];
    let mut result = None;

    for action in actions {
        let street = game.street;

        game.apply(action.player, action.action)
            .map_err(|_| "action replay rejected")?;

        match (street, action.action) {
            (Street::Preflop, Action::RaiseTo(_)) => {
                facts[action.player].raised_preflop = true;
            }
            (Street::Preflop, Action::Call) => {
                facts[action.player].called_preflop = true;
            }
            (Street::Flop, Action::Check) => {
                facts[action.player].checked_flop = true;
            }
            _ => {}
        }

        if street == Street::Preflop && game.round_complete && game.fold_winner.is_none() {
            for (seat, player) in game.players.iter().enumerate() {
                facts[seat].saw_flop = !player.folded;
            }
        }

        if let Some(settled) = advance(&mut game)? {
            result = Some(settled);
        }
    }

    if game.settled != result.is_some() {
        return Err("settlement result missing");
    }

    if game.settled {
        for (seat, player) in game.players.iter().enumerate() {
            facts[seat].reached_showdown = game.fold_winner.is_none() && !player.folded;
            facts[seat].net_profit = player.stack > stacks[seat];
        }
    }

    Ok((game, result, facts))
}

fn settle(game: &mut State) -> Result<HandResult, &'static str> {
    let kind = if game.fold_winner.is_some() {
        HandResultKind::Fold
    } else {
        HandResultKind::Showdown
    };
    let awards = game
        .settle()
        .map_err(|_| "cannot settle hand")?
        .into_iter()
        .map(|event| match event {
            Event::Awarded { player, amount } => Ok(Award { player, amount }),
            _ => Err("invalid settlement event"),
        })
        .collect::<Result<Vec<_>, _>>()?;

    if awards.is_empty() {
        return Err("settlement awards missing");
    }

    Ok(HandResult { kind, awards })
}

const fn empty_facts() -> Facts {
    Facts {
        saw_flop: false,
        raised_preflop: false,
        called_preflop: false,
        checked_flop: false,
        reached_showdown: false,
        net_profit: false,
    }
}

fn challenge_hashes(
    challenges: &[Option<Challenge>],
    facts: &[Facts],
) -> Result<Vec<FactHash>, &'static str> {
    challenges
        .iter()
        .zip(facts)
        .enumerate()
        .map(|(seat, (challenge, facts))| {
            let challenge = challenge.as_ref().ok_or("challenge missing")?;

            Ok(FactHash {
                seat,
                value: facts_hash(challenge.hand_tag, seat as u8, *facts),
            })
        })
        .collect()
}

pub(super) fn challenge_points(tier: u8) -> Result<u32, &'static str> {
    match tier {
        TIER_EASY => Ok(10),
        TIER_HARD => Ok(25),
        _ => Err("invalid challenge tier"),
    }
}

fn action_error(err: ActionError) -> &'static str {
    match err {
        ActionError::InvalidPlayer => "invalid player",
        ActionError::NotTurn => "not your turn",
        ActionError::RoundComplete => "betting round complete",
        ActionError::HandComplete => "hand complete",
        ActionError::CannotCheck => "cannot check",
        ActionError::CannotCall => "cannot call",
        ActionError::CannotRaise => "cannot raise",
    }
}
