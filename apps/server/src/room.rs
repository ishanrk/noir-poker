use challenge_core::{Facts, facts_hash, hand_tag};
use game_core::{Action, ActionError, Event, NextHandError, State, Street};
use rand::SeedableRng;
use rand::seq::SliceRandom;
use rand_chacha::ChaCha20Rng;
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;
use uuid::Uuid;

use crate::mental::MentalDeck;

pub(super) type TokenHash = [u8; 32];
pub(super) type Challenges = Vec<Option<Challenge>>;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum RoomMode {
    Single,
    Multiplayer,
    Aztec,
}

impl RoomMode {
    pub(super) const fn text(self) -> &'static str {
        match self {
            Self::Single => "single",
            Self::Multiplayer => "multiplayer",
            Self::Aztec => "aztec",
        }
    }

    pub(super) fn parse(text: &str) -> Option<Self> {
        match text {
            "single" => Some(Self::Single),
            "multiplayer" => Some(Self::Multiplayer),
            "aztec" => Some(Self::Aztec),
            _ => None,
        }
    }

    pub(super) const fn challenges(self) -> bool {
        matches!(self, Self::Multiplayer | Self::Aztec)
    }

    const fn challenge_bonuses(self) -> bool {
        matches!(self, Self::Multiplayer)
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
pub(super) struct RoomConfig {
    pub(super) players: usize,
    pub(super) stack: u32,
    pub(super) small_blind: u32,
    pub(super) big_blind: u32,
    pub(super) hands: u32,
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

        if !(1..=20).contains(&self.hands) {
            return Err("hands must be 1 through 20");
        }

        let total = self.players as u64 * u64::from(self.stack);

        if total > u64::from(u32::MAX) {
            return Err("total stacks exceed chip limit");
        }

        Ok(())
    }

    pub(super) const fn last_hand(self, no: u64) -> bool {
        no >= self.hands as u64 - 1
    }
}

pub(super) struct Room {
    pub(super) last_activity: std::time::Instant,
    pub(super) retired: bool,
    pub(super) config: RoomConfig,
    pub(super) mode: RoomMode,
    pub(super) seats: Vec<Seat>,
    pub(super) hand: Option<LiveHand>,
    pub(super) current_commitment: Option<[u8; 32]>,
    pub(super) ceremony: Option<Ceremony>,
    pub(super) current_challenges: Challenges,
    pub(super) next_challenges: Challenges,
    pub(super) deck: Option<Box<MentalDeck>>,
    pub(super) last_deck: Option<Box<MentalDeck>>,
    pub(super) mental: bool,
    pub(super) action_pause: bool,
    pub(super) bot_running: bool,
    pub(super) bot_wake: bool,
    pub(super) challenge_awarded: bool,
    pub(super) settlement: Option<SettlementState>,
    pub(super) rev: u64,
    pub(super) notify: broadcast::Sender<u64>,
}

impl Room {
    pub(super) fn game_complete(&self) -> bool {
        self.hand
            .as_ref()
            .is_some_and(|hand| self.game_complete_with(&hand.game))
    }

    pub(super) fn game_complete_with(&self, game: &State) -> bool {
        let hand = self.hand.as_ref().expect("game complete hand");
        game.settled
            && (self.config.last_hand(hand.no)
                || game
                    .players
                    .iter()
                    .filter(|player| player.stack > 0)
                    .count()
                    < 2)
    }

    #[cfg(test)]
    pub(super) fn new(config: RoomConfig, token_hash: TokenHash) -> Result<Self, &'static str> {
        Self::new_with_mode(config, RoomMode::Multiplayer, token_hash)
    }

    fn new_with_mode(
        config: RoomConfig,
        mode: RoomMode,
        token_hash: TokenHash,
    ) -> Result<Self, &'static str> {
        config.validate()?;
        let (notify, _) = broadcast::channel(16);

        Ok(Self {
            last_activity: std::time::Instant::now(),
            retired: false,
            config,
            mode,
            seats: vec![Seat::new(token_hash, "Player 1".to_owned())],
            hand: None,
            current_commitment: None,
            ceremony: None,
            current_challenges: vec![None; config.players],
            next_challenges: vec![None; config.players],
            deck: None,
            last_deck: None,
            mental: false,
            action_pause: false,
            bot_running: false,
            bot_wake: false,
            challenge_awarded: false,
            settlement: None,
            rev: 0,
            notify,
        })
    }

    pub(super) fn new_fair(
        config: RoomConfig,
        mode: RoomMode,
        token_hash: TokenHash,
        ceremony: Ceremony,
        share: [u8; 32],
    ) -> Result<Self, &'static str> {
        let mut room = Self::new_with_mode(config, mode, token_hash)?;
        let mut ceremony = ceremony;

        ceremony.shares[0] = Some(share);
        room.ceremony = Some(ceremony);
        Ok(room)
    }

    pub(super) fn new_pending(
        config: RoomConfig,
        token_hash: TokenHash,
        ceremony: Ceremony,
    ) -> Result<Self, &'static str> {
        let mut room = Self::new_with_mode(config, RoomMode::Single, token_hash)?;

        room.ceremony = Some(ceremony);
        Ok(room)
    }

    pub(super) fn next_seat(&self) -> Result<usize, JoinError> {
        if self.hand.is_some() || self.seats.len() >= self.config.players {
            return Err(JoinError::Full);
        }

        Ok(self.seats.len())
    }

    pub(super) fn set_creator_name(&mut self, name: String) {
        self.seats[0].name = name;
    }

    #[cfg(test)]
    pub(super) fn commit_join(&mut self, token_hash: TokenHash, hand: Option<LiveHand>, rev: u64) {
        self.seats.push(Seat::new(
            token_hash,
            format!("Player {}", self.seats.len() + 1),
        ));
        self.hand = hand;
        self.changed(rev);
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn commit_fair_join(
        &mut self,
        token_hash: TokenHash,
        name: String,
        seat: usize,
        share: [u8; 32],
        hand: Option<LiveHand>,
        next: Option<Ceremony>,
        rev: u64,
    ) {
        let ceremony = self.ceremony.as_mut().expect("fair join ceremony");

        ceremony.shares[seat] = Some(share);
        self.seats.push(Seat::new(token_hash, name));

        if let Some(hand) = hand {
            self.current_commitment = Some(ceremony.commitment);
            self.hand = Some(hand);
            self.ceremony = next;
        }

        self.changed(rev);
    }

    pub(super) fn commit_single_start(
        &mut self,
        tokens: Vec<TokenHash>,
        hand: LiveHand,
        next: Option<Ceremony>,
        rev: u64,
    ) {
        let commitment = self
            .ceremony
            .as_ref()
            .expect("single deal ceremony")
            .commitment;

        for (index, token_hash) in tokens.into_iter().enumerate() {
            self.seats
                .push(Seat::new(token_hash, format!("Bot {}", index + 1)));
        }

        self.current_commitment = Some(commitment);
        self.hand = Some(hand);
        self.ceremony = next;
        self.changed(rev);
    }

    pub(super) fn stage_ready(&self, seat: usize) -> Result<PendingReady, &'static str> {
        let hand = self.hand.as_ref().ok_or("game not started")?;
        let player = self.seats.get(seat).ok_or("invalid player")?;

        if !hand.game.settled {
            return Err("hand not settled");
        }

        if self.deck.as_ref().is_some_and(|deck| !deck.complete) {
            return Err("deck opening incomplete");
        }

        if self.game_complete() {
            return Err("game complete");
        }

        if player.ready_hand == Some(hand.id) {
            return Err("already ready");
        }

        if self.mode.challenges()
            && self
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

    pub(super) fn stage_fair_ready(
        &self,
        seat: usize,
        share: [u8; 32],
    ) -> Result<PendingFairReady, &'static str> {
        let ready = self.stage_ready(seat)?;
        let ceremony = self.ceremony.as_ref().ok_or("deal ceremony missing")?;
        let hand = self.hand.as_ref().expect("ready hand");

        if ceremony.hand_no != hand.no.checked_add(1).ok_or("hand limit reached")? {
            return Err("wrong deal ceremony");
        }

        if ceremony.shares.get(seat).and_then(|share| *share).is_some() {
            return Err("deal entropy already submitted");
        }

        let all = ceremony
            .shares
            .iter()
            .enumerate()
            .all(|(index, stored)| index == seat || stored.is_some());

        Ok(PendingFairReady {
            hand: ready.hand,
            rev: ready.rev,
            all: ready.all && all,
            share,
        })
    }

    pub(super) fn stage_finish(&self, seat: usize) -> Result<PendingFinish, &'static str> {
        let hand = self.hand.as_ref().ok_or("game not started")?;
        let player = self.seats.get(seat).ok_or("invalid player")?;

        if !self.mode.challenge_bonuses() || !self.game_complete() {
            return Err("game not complete");
        }
        if self.deck.as_ref().is_some_and(|deck| !deck.complete) {
            return Err("deck opening incomplete");
        }
        if self.challenge_awarded {
            return Err("game already finished");
        }
        if player.ready_hand == Some(hand.id) {
            return Err("already finished");
        }

        let all = self
            .seats
            .iter()
            .enumerate()
            .all(|(index, player)| index == seat || player.ready_hand == Some(hand.id));

        Ok(PendingFinish {
            hand: hand.id,
            rev: self.rev.checked_add(1).ok_or("revision limit reached")?,
            bonuses: all.then(|| challenge_bonuses(self.config.stack, &self.seats)),
        })
    }

    pub(super) fn commit_finish(&mut self, seat: usize, pending: PendingFinish) {
        if let Some(bonuses) = pending.bonuses {
            for (player, bonus) in self.seats.iter_mut().zip(bonuses) {
                player.challenge_bonus = bonus;
                player.ready_hand = None;
            }
            self.challenge_awarded = true;
        } else {
            self.seats[seat].ready_hand = Some(pending.hand);
        }
        self.changed(pending.rev);
    }

    pub(super) fn stage_next_hand(&self, seed: [u8; 32]) -> Result<Option<LiveHand>, &'static str> {
        let hand = self.hand.as_ref().ok_or("game not started")?;

        if self.game_complete() {
            return Err("game complete");
        }

        let stacks = hand
            .game
            .players
            .iter()
            .map(|player| player.stack)
            .collect();
        let no = hand.no.checked_add(1).ok_or("hand limit reached")?;

        let next = if self.mental {
            hand.game.next_hidden()
        } else {
            hand.game.next_hand(seed)
        };

        match next {
            Ok(game) => Ok(Some(LiveHand {
                id: Uuid::new_v4(),
                no,
                seed,
                starting_stacks: stacks,
                game,
                result: None,
                next_seq: 0,
                actions: Vec::new(),
                notices: Vec::new(),
                last_action: None,
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

    pub(super) fn commit_fair_ready(
        &mut self,
        seat: usize,
        pending: PendingFairReady,
        hand: Option<LiveHand>,
        next: Option<Ceremony>,
    ) {
        self.ceremony.as_mut().expect("fair ready ceremony").shares[seat] = Some(pending.share);

        if let Some(hand) = hand {
            let commitment = self
                .ceremony
                .as_ref()
                .expect("fair ready ceremony")
                .commitment;

            self.commit_ready(seat, Some(hand), pending.rev);
            self.current_commitment = Some(commitment);
            self.ceremony = next;
        } else {
            self.commit_ready(seat, None, pending.rev);
        }
    }

    pub(super) fn stage_challenge(
        &self,
        room: Uuid,
        seat: usize,
        hand_no: u64,
        commitment: [u8; 32],
    ) -> Result<PendingChallenge, &'static str> {
        if !self.mode.challenges() {
            return Err("challenge unavailable");
        }

        let hand = self.hand.as_ref().ok_or("game not started")?;

        if !hand.game.settled {
            return Err("hand not settled");
        }

        if self.game_complete() {
            return Err("game complete");
        }

        let next_no = hand.no.checked_add(1).ok_or("hand limit reached")?;

        if hand_no != next_no {
            return Err("wrong challenge hand");
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

    #[cfg(test)]
    pub(super) fn stage_draw(
        &self,
        seat: usize,
        hand_no: u64,
    ) -> Result<PendingDraw, &'static str> {
        let hand = self.hand.as_ref().ok_or("game not started")?;
        let next = hand.game.settled;
        let expected = if next {
            hand.no.checked_add(1).ok_or("hand limit reached")?
        } else {
            hand.no
        };

        if expected != hand_no {
            return Err("wrong challenge hand");
        }

        let challenges = if next {
            &self.next_challenges
        } else {
            &self.current_challenges
        };
        let challenge = challenges
            .get(seat)
            .and_then(Option::as_ref)
            .ok_or("challenge missing")?;

        if challenge.draw_verified {
            return Err("draw already verified");
        }

        Ok(PendingDraw {
            hand_no,
            seat,
            hand_tag: challenge.hand_tag,
            commitment: challenge.commitment,
            nonce: challenge.nonce,
            catalog_root: challenge.catalog_root,
            rev: self.rev.checked_add(1).ok_or("revision limit reached")?,
            next,
        })
    }

    pub(super) fn commit_draw(&mut self, draw: PendingDraw) {
        let current = self.current_challenges[draw.seat]
            .as_mut()
            .filter(|challenge| challenge.hand_no == draw.hand_no);
        let challenge = current.or_else(|| {
            self.next_challenges[draw.seat]
                .as_mut()
                .filter(|challenge| challenge.hand_no == draw.hand_no)
        });

        if let Some(challenge) = challenge {
            challenge.draw_verified = true;
        }
        self.changed(draw.rev);
    }

    #[cfg(test)]
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
        let facts_salt = challenge.facts_salt.ok_or("challenge facts missing")?;
        let facts_hash = challenge.facts_hash.ok_or("challenge facts missing")?;

        if challenge.nullifier.is_some() {
            return Err("challenge already claimed");
        }

        let points = u32::from(challenge_core::POINTS);
        let prior_points = self.seats[seat].proof_points;
        let next_points = prior_points
            .checked_add(u64::from(points))
            .ok_or("challenge count limit reached")?;

        Ok(PendingClaim {
            hand_no,
            seat,
            hand_tag: challenge.hand_tag,
            commitment: challenge.commitment,
            nonce: challenge.nonce,
            catalog_root: challenge.catalog_root,
            facts_salt,
            facts_hash,
            points,
            prior_points,
            next_points,
            rev: self.rev.checked_add(1).ok_or("revision limit reached")?,
        })
    }

    pub(super) fn commit_claim(&mut self, claim: PendingClaim, nullifier: [u8; 32]) {
        if let Some(challenge) = self.current_challenges[claim.seat]
            .as_mut()
            .filter(|challenge| challenge.hand_no == claim.hand_no)
        {
            challenge.nullifier = Some(nullifier);
            challenge.points = Some(claim.points);
        }
        self.seats[claim.seat].proof_points = claim.next_points;
        if self.mode.challenge_bonuses() && self.challenge_awarded {
            let bonuses = challenge_bonuses(self.config.stack, &self.seats);
            for (seat, bonus) in self.seats.iter_mut().zip(bonuses) {
                seat.challenge_bonus = bonus;
            }
        }
        self.changed(claim.rev);
    }

    pub(super) fn stage_action(
        &self,
        seat: usize,
        action: Action,
    ) -> Result<PendingAction, &'static str> {
        let hand = self.hand.as_ref().ok_or("game not started")?;

        let amount = match action {
            Action::Call => hand
                .game
                .legal_actions(seat)
                .and_then(|actions| actions.call),
            Action::RaiseTo(to) => Some(to),
            Action::Fold | Action::Check => None,
        };

        // action staged on state clone
        let mut game = hand.game.clone();

        game.apply(seat, action).map_err(action_error)?;
        let result = if self.mental {
            advance_hidden(&mut game)?
        } else {
            advance(&mut game)?
        };

        let mut actions = hand.actions.clone();
        actions.push(PlayedAction {
            player: seat,
            action,
        });
        let facts = if !self.mental && game.settled && hand.no > 0 {
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
        Ok(PendingAction {
            hand: hand.id,
            seq: hand.next_seq,
            next_seq: hand.next_seq.checked_add(1).ok_or("action limit reached")?,
            rev: self.rev.checked_add(1).ok_or("revision limit reached")?,
            player: seat,
            action,
            notice: ActionNotice {
                seq: hand.next_seq,
                player: seat,
                action,
                amount,
            },
            game,
            result,
            actions,
            facts,
            fact_commitments: None,
        })
    }

    pub(super) fn commit_action(&mut self, action: PendingAction) {
        let hand = self.hand.as_mut().expect("staged hand");

        hand.game = action.game;
        hand.result = action.result;
        hand.next_seq = action.next_seq;
        hand.actions = action.actions;
        hand.notices.push(action.notice);
        hand.last_action = Some(action.notice);

        if let (Some(facts), Some(commits)) = (action.facts, action.fact_commitments) {
            for commit in commits {
                let facts = *facts.get(commit.seat).expect("staged facts");
                let challenge = self.current_challenges[commit.seat]
                    .as_mut()
                    .expect("staged challenge");

                challenge.facts_salt = Some(commit.salt);
                challenge.facts_hash = Some(commit.value);
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

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct Ceremony {
    pub(super) hand_no: u64,
    pub(super) server_secret: [u8; 32],
    pub(super) commitment: [u8; 32],
    pub(super) shares: Vec<Option<[u8; 32]>>,
}

impl Ceremony {
    pub(super) fn contributors(&self) -> usize {
        self.shares.iter().flatten().count()
    }

    pub(super) fn seed_with(
        &self,
        room: Uuid,
        seat: usize,
        share: [u8; 32],
    ) -> Result<[u8; 32], &'static str> {
        let mut shares = self.shares.clone();
        let slot = shares
            .get_mut(seat)
            .ok_or("invalid deal contribution seat")?;

        if slot.is_some() {
            return Err("deal entropy already submitted");
        }

        *slot = Some(share);
        let shares = shares
            .into_iter()
            .collect::<Option<Vec<_>>>()
            .ok_or("deal contributions missing")?;

        deal_core::seed(*room.as_bytes(), self.hand_no, self.server_secret, &shares)
            .ok_or("cannot derive deal seed")
    }
}

#[derive(Clone)]
pub(super) struct Seat {
    pub(super) token_hash: TokenHash,
    pub(super) name: String,
    pub(super) ready_hand: Option<Uuid>,
    pub(super) proof_points: u64,
    pub(super) challenge_bonus: u32,
    pub(super) aztec_account: Option<String>,
    pub(super) aztec_entry: Option<String>,
    pub(super) aztec_amount: Option<u32>,
}

impl Seat {
    fn new(token_hash: TokenHash, name: String) -> Self {
        Self {
            token_hash,
            name,
            ready_hand: None,
            proof_points: 0,
            challenge_bonus: 0,
            aztec_account: None,
            aztec_entry: None,
            aztec_amount: None,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum SettlementState {
    Pending,
    Returned,
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
    pub(super) notices: Vec<ActionNotice>,
    pub(super) last_action: Option<ActionNotice>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) struct ActionNotice {
    pub(super) seq: u64,
    pub(super) player: usize,
    pub(super) action: Action,
    pub(super) amount: Option<u32>,
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
    pub(super) hand_tag: [u8; 32],
    pub(super) commitment: [u8; 32],
    pub(super) nonce: [u8; 32],
    pub(super) catalog_root: [u8; 32],
    pub(super) draw_verified: bool,
    pub(super) facts_salt: Option<[u8; 32]>,
    pub(super) facts_hash: Option<[u8; 32]>,
    pub(super) facts: Option<Facts>,
    pub(super) nullifier: Option<[u8; 32]>,
    pub(super) points: Option<u32>,
}

pub(super) struct PendingChallenge {
    pub(super) hand_no: u64,
    pub(super) seat: usize,
    pub(super) hand_tag: [u8; 32],
    pub(super) commitment: [u8; 32],
    pub(super) rev: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) struct PendingDraw {
    pub(super) hand_no: u64,
    pub(super) seat: usize,
    pub(super) hand_tag: [u8; 32],
    pub(super) commitment: [u8; 32],
    pub(super) nonce: [u8; 32],
    pub(super) catalog_root: [u8; 32],
    pub(super) rev: u64,
    pub(super) next: bool,
}

pub(super) struct PendingFairReady {
    pub(super) hand: Uuid,
    pub(super) rev: u64,
    pub(super) all: bool,
    pub(super) share: [u8; 32],
}

pub(super) struct PendingReady {
    pub(super) hand: Uuid,
    pub(super) rev: u64,
    pub(super) all: bool,
}

pub(super) struct PendingFinish {
    pub(super) hand: Uuid,
    pub(super) rev: u64,
    pub(super) bonuses: Option<Vec<u32>>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) struct PendingClaim {
    pub(super) hand_no: u64,
    pub(super) seat: usize,
    pub(super) hand_tag: [u8; 32],
    pub(super) commitment: [u8; 32],
    pub(super) nonce: [u8; 32],
    pub(super) catalog_root: [u8; 32],
    pub(super) facts_salt: [u8; 32],
    pub(super) facts_hash: [u8; 32],
    pub(super) points: u32,
    pub(super) prior_points: u64,
    pub(super) next_points: u64,
    pub(super) rev: u64,
}

pub(super) fn challenge_bonuses(stack: u32, seats: &[Seat]) -> Vec<u32> {
    let mut order: Vec<_> = (0..seats.len()).collect();
    order.sort_by_key(|&seat| (std::cmp::Reverse(seats[seat].proof_points), seat));
    let ranked = (0..seats.len())
        .map(|rank| {
            let percent = 100u64.saturating_sub(16 * rank as u64);
            (u64::from(stack) * percent).div_ceil(100)
        })
        .collect::<Vec<_>>();
    let mut bonuses = vec![0; seats.len()];
    let mut start = 0;

    while start < order.len() {
        let score = seats[order[start]].proof_points;
        let mut end = start + 1;
        while end < order.len() && seats[order[end]].proof_points == score {
            end += 1;
        }
        let bonus = ranked[start..end]
            .iter()
            .sum::<u64>()
            .div_ceil((end - start) as u64);
        for &seat in &order[start..end] {
            bonuses[seat] = u32::try_from(bonus).expect("bonus within buy in");
        }
        start = end;
    }

    bonuses
}

pub(super) struct PendingAction {
    pub(super) hand: Uuid,
    pub(super) seq: u64,
    pub(super) next_seq: u64,
    pub(super) rev: u64,
    pub(super) player: usize,
    pub(super) action: Action,
    pub(super) notice: ActionNotice,
    pub(super) game: State,
    pub(super) result: Option<HandResult>,
    pub(super) actions: Vec<PlayedAction>,
    pub(super) facts: Option<Vec<Facts>>,
    pub(super) fact_commitments: Option<Vec<FactCommitment>>,
}

pub(super) struct FactCommitment {
    pub(super) seat: usize,
    pub(super) salt: [u8; 32],
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

#[cfg(test)]
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

fn advance_hidden(game: &mut State) -> Result<Option<HandResult>, &'static str> {
    if game.fold_winner.is_some() {
        settle(game).map(Some)
    } else {
        Ok(None)
    }
}

pub(super) fn replay_hand(
    config: RoomConfig,
    seed: [u8; 32],
    dealer: usize,
    stacks: &[u32],
    actions: &[PlayedAction],
) -> Result<(State, Option<HandResult>, Vec<Facts>), &'static str> {
    replay_state(
        State::new(seed, dealer, stacks, config.small_blind, config.big_blind),
        stacks,
        actions,
    )
}

pub(super) fn replay_legacy_hand(
    config: RoomConfig,
    seed: [u8; 32],
    dealer: usize,
    stacks: &[u32],
    actions: &[PlayedAction],
) -> Result<(State, Option<HandResult>, Vec<Facts>), &'static str> {
    let mut cards = core::array::from_fn(|id| game_core::Card::from_id(id as u8).unwrap());
    let mut rng = ChaCha20Rng::from_seed(seed);

    cards.shuffle(&mut rng);
    replay_deck(config, cards, dealer, stacks, actions)
}

pub(super) fn replay_deck(
    config: RoomConfig,
    cards: [game_core::Card; 52],
    dealer: usize,
    stacks: &[u32],
    actions: &[PlayedAction],
) -> Result<(State, Option<HandResult>, Vec<Facts>), &'static str> {
    let game = State::from_cards(cards, dealer, stacks, config.small_blind, config.big_blind)
        .ok_or("invalid encrypted deck")?;
    replay_state(game, stacks, actions)
}

fn replay_state(
    mut game: State,
    stacks: &[u32],
    actions: &[PlayedAction],
) -> Result<(State, Option<HandResult>, Vec<Facts>), &'static str> {
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

pub(super) fn bind_facts(
    action: &mut PendingAction,
    challenges: &[Option<Challenge>],
    salts: Vec<[u8; 32]>,
    mode: RoomMode,
) -> Result<(), &'static str> {
    let facts = action.facts.as_ref().ok_or("challenge facts missing")?;

    action.fact_commitments = Some(challenge_facts(facts, challenges, salts, mode)?);
    Ok(())
}

pub(super) fn challenge_facts(
    facts: &[Facts],
    challenges: &[Option<Challenge>],
    salts: Vec<[u8; 32]>,
    mode: RoomMode,
) -> Result<Vec<FactCommitment>, &'static str> {
    let count = if mode == RoomMode::Single {
        1
    } else {
        facts.len()
    };

    if salts.len() != count {
        return Err("challenge facts mismatch");
    }

    let mut salts = salts.into_iter();
    let mut commits = Vec::with_capacity(count);

    for (seat, (challenge, facts)) in challenges.iter().zip(facts).enumerate() {
        if mode == RoomMode::Single && seat != 0 {
            continue;
        }

        let challenge = challenge.as_ref().ok_or("challenge missing")?;

        let salt = salts.next().expect("fact salt");
        commits.push(FactCommitment {
            seat,
            salt,
            value: facts_hash(challenge.hand_tag, seat as u8, salt, *facts),
        });
    }

    Ok(commits)
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

#[cfg(test)]
mod tests {
    use game_core::{Deck, Rank, Suit};

    use super::*;

    const SEED: [u8; 32] = [0x42; 32];

    fn scored(points: u64) -> Seat {
        let mut seat = Seat::new([0; 32], "Player".to_owned());
        seat.proof_points = points;
        seat
    }

    fn settled_room(mode: RoomMode, hands: u32) -> Room {
        let config = RoomConfig {
            players: 2,
            stack: 100,
            small_blind: 5,
            big_blind: 10,
            hands,
        };
        let mut room = Room::new_with_mode(config, mode, [0; 32]).unwrap();
        let mut game = State::new(SEED, 0, &[100, 100], 5, 10);

        room.seats.push(Seat::new([1; 32], "Player 2".to_owned()));
        game.apply(0, Action::Fold).unwrap();
        settle(&mut game).unwrap();
        room.hand = Some(LiveHand {
            id: Uuid::new_v4(),
            no: 0,
            seed: SEED,
            starting_stacks: vec![100, 100],
            game,
            result: None,
            next_seq: 0,
            actions: Vec::new(),
            notices: Vec::new(),
            last_action: None,
        });
        room
    }

    fn challenge(seat: usize) -> Challenge {
        Challenge {
            hand_no: 1,
            seat,
            hand_tag: [1; 32],
            commitment: [2; 32],
            nonce: [3; 32],
            catalog_root: [4; 32],
            draw_verified: false,
            facts_salt: None,
            facts_hash: None,
            facts: None,
            nullifier: None,
            points: None,
        }
    }

    #[test]
    fn human_challenge_modes() {
        assert!(!RoomMode::Single.challenges());
        assert!(RoomMode::Multiplayer.challenges());
        assert!(RoomMode::Aztec.challenges());
    }

    #[test]
    fn aztec_challenge_gate() {
        let room_id = Uuid::new_v4();
        let aztec = settled_room(RoomMode::Aztec, 2);
        let multiplayer = settled_room(RoomMode::Multiplayer, 2);
        let single = settled_room(RoomMode::Single, 2);

        assert!(aztec.stage_challenge(room_id, 0, 1, [2; 32]).is_ok());
        assert!(multiplayer.stage_challenge(room_id, 0, 1, [2; 32]).is_ok());
        assert_eq!(
            single.stage_challenge(room_id, 0, 1, [2; 32]).err(),
            Some("challenge unavailable")
        );
    }

    #[test]
    fn aztec_ready_requires_challenge() {
        let mut room = settled_room(RoomMode::Aztec, 2);

        assert_eq!(room.stage_ready(0).err(), Some("challenge required"));
        room.next_challenges[0] = Some(challenge(0));
        assert!(room.stage_ready(0).is_ok());
        assert!(settled_room(RoomMode::Single, 2).stage_ready(0).is_ok());
    }

    #[test]
    fn aztec_claim_has_no_bonus() {
        let mut room = settled_room(RoomMode::Aztec, 1);
        let stacks: Vec<_> = room
            .hand
            .as_ref()
            .unwrap()
            .game
            .players
            .iter()
            .map(|player| player.stack)
            .collect();
        room.challenge_awarded = true;
        room.seats[0].challenge_bonus = 7;

        room.commit_claim(
            PendingClaim {
                hand_no: 0,
                seat: 0,
                hand_tag: [1; 32],
                commitment: [2; 32],
                nonce: [3; 32],
                catalog_root: [4; 32],
                facts_salt: [5; 32],
                facts_hash: [6; 32],
                points: 20,
                prior_points: 0,
                next_points: 20,
                rev: 1,
            },
            [7; 32],
        );

        assert_eq!(room.seats[0].challenge_bonus, 7);
        assert_eq!(
            room.hand
                .as_ref()
                .unwrap()
                .game
                .players
                .iter()
                .map(|player| player.stack)
                .collect::<Vec<_>>(),
            stacks
        );
        assert_eq!(room.stage_finish(0).err(), Some("game not complete"));
    }

    #[test]
    fn ranked_challenge_bonus() {
        let seats = [scored(60), scored(40), scored(20), scored(0)];

        assert_eq!(challenge_bonuses(101, &seats), vec![101, 85, 69, 53]);
    }

    #[test]
    fn tied_challenge_bonus() {
        let seats = [scored(20), scored(20), scored(0)];

        assert_eq!(challenge_bonuses(100, &seats), vec![92, 92, 68]);
    }

    #[test]
    fn fold_result() {
        let mut game = State::new(SEED, 0, &[100, 100], 5, 10);

        game.apply(0, Action::Fold).unwrap();

        assert_eq!(
            settle(&mut game).unwrap(),
            HandResult {
                kind: HandResultKind::Fold,
                awards: vec![Award {
                    player: 1,
                    amount: 15,
                }],
            }
        );
    }

    #[test]
    fn tie_result() {
        let mut game = showdown(&[20, 20]);

        game.board = vec![
            card(Rank::Ten, Suit::Clubs),
            card(Rank::Jack, Suit::Diamonds),
            card(Rank::Queen, Suit::Hearts),
            card(Rank::King, Suit::Spades),
            card(Rank::Ace, Suit::Clubs),
        ];
        game.hole = vec![
            [
                card(Rank::Two, Suit::Hearts),
                card(Rank::Three, Suit::Hearts),
            ],
            [
                card(Rank::Four, Suit::Spades),
                card(Rank::Five, Suit::Spades),
            ],
        ];

        assert_eq!(
            settle(&mut game).unwrap(),
            HandResult {
                kind: HandResultKind::Showdown,
                awards: vec![
                    Award {
                        player: 0,
                        amount: 20,
                    },
                    Award {
                        player: 1,
                        amount: 20,
                    },
                ],
            }
        );
    }

    #[test]
    fn side_pot_result() {
        let mut game = showdown(&[100, 60, 30]);

        game.board = vec![
            card(Rank::Two, Suit::Clubs),
            card(Rank::Three, Suit::Diamonds),
            card(Rank::Seven, Suit::Hearts),
            card(Rank::Nine, Suit::Spades),
            card(Rank::Jack, Suit::Clubs),
        ];
        game.hole = vec![
            [
                card(Rank::Queen, Suit::Clubs),
                card(Rank::Queen, Suit::Diamonds),
            ],
            [
                card(Rank::King, Suit::Clubs),
                card(Rank::King, Suit::Diamonds),
            ],
            [
                card(Rank::Ace, Suit::Clubs),
                card(Rank::Ace, Suit::Diamonds),
            ],
        ];

        assert_eq!(
            settle(&mut game).unwrap(),
            HandResult {
                kind: HandResultKind::Showdown,
                awards: vec![
                    Award {
                        player: 0,
                        amount: 40,
                    },
                    Award {
                        player: 1,
                        amount: 60,
                    },
                    Award {
                        player: 2,
                        amount: 90,
                    },
                ],
            }
        );
    }

    fn showdown(contributions: &[u32]) -> State {
        let stacks = vec![100; contributions.len()];
        let mut game = State::new(SEED, 0, &stacks, 5, 10);

        for (player, &amount) in game.players.iter_mut().zip(contributions) {
            player.stack = 100 - amount;
            player.bet = 0;
            player.contributed = amount;
            player.folded = false;
            player.acted_bet = None;
        }

        game.pot = contributions.iter().sum();
        game.street = Street::River;
        game.round_complete = true;
        game.fold_winner = None;
        game.settled = false;
        game
    }

    fn card(rank: Rank, suit: Suit) -> game_core::Card {
        *Deck::new()
            .cards()
            .iter()
            .find(|card| card.rank() == rank && card.suit() == suit)
            .unwrap()
    }
}
