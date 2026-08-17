use crate::{Card, Deck, eval7};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Action {
    Fold,
    Check,
    Call,
    RaiseTo(u32),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RaiseRange {
    pub min_to: u32,
    pub max_to: u32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct LegalActions {
    pub fold: bool,
    pub check: bool,
    pub call: Option<u32>,
    pub raise: Option<RaiseRange>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Event {
    Folded { player: usize },
    Checked { player: usize },
    Called { player: usize, amount: u32 },
    Raised { player: usize, to: u32 },
    FlopDealt { cards: [Card; 3] },
    TurnDealt { card: Card },
    RiverDealt { card: Card },
    Awarded { player: usize, amount: u32 },
    BettingRoundComplete,
    WonByFold { player: usize },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ActionError {
    InvalidPlayer,
    NotTurn,
    RoundComplete,
    HandComplete,
    CannotCheck,
    CannotCall,
    CannotRaise,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AdvanceError {
    CannotAdvance,
    HandComplete,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SettlementError {
    NotReady,
    AlreadySettled,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NextHandError {
    NotSettled,
    CannotStart,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Street {
    Preflop,
    Flop,
    Turn,
    River,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Player {
    pub stack: u32,
    pub bet: u32,
    pub contributed: u32,
    pub folded: bool,
    pub acted_bet: Option<u32>,
}

#[derive(Debug, Eq, PartialEq)]
pub struct State {
    // same shuffled deck continues after hole cards
    deck: Deck,

    pub players: Vec<Player>,
    pub hole: Vec<[Card; 2]>,
    pub board: Vec<Card>,
    pub pot: u32,
    pub min_raise: u32,
    pub small_blind: u32,
    pub big_blind: u32,
    pub dealer: usize,
    pub turn: usize,
    pub next_card: usize,
    pub street: Street,
    pub round_complete: bool,
    pub fold_winner: Option<usize>,
    pub settled: bool,
}

impl State {
    pub fn new(seed: [u8; 32], dealer: usize, stacks: &[u32], sb: u32, bb: u32) -> Self {
        let n = stacks.len();
        let total: u64 = stacks.iter().map(|&stack| u64::from(stack)).sum();

        assert!((2..=6).contains(&n));
        assert!(dealer < n);
        assert!(sb > 0);
        assert!(bb >= sb);
        assert!(stacks.iter().all(|&stack| stack >= bb));
        assert!(total <= u64::from(u32::MAX));

        // heads up dealer posts small blind
        // three plus starts blinds left of dealer
        let sb_pos = if n == 2 { dealer } else { (dealer + 1) % n };
        let bb_pos = (sb_pos + 1) % n;
        let turn = if n == 2 { dealer } else { (bb_pos + 1) % n };
        let deck = Deck::from_seed(seed);
        let cards = deck.cards();
        let mut players: Vec<_> = stacks
            .iter()
            .map(|&stack| Player {
                stack,
                bet: 0,
                contributed: 0,
                folded: false,
                acted_bet: None,
            })
            .collect();
        let mut hole = vec![[cards[0]; 2]; n];

        players[sb_pos].stack -= sb;
        players[sb_pos].bet = sb;
        players[sb_pos].contributed = sb;
        players[bb_pos].stack -= bb;
        players[bb_pos].bet = bb;
        players[bb_pos].contributed = bb;

        // deal clockwise from left of dealer for two rounds
        let first = (dealer + 1) % n;

        for round in 0..2 {
            for offset in 0..n {
                let player = (first + offset) % n;
                hole[player][round] = cards[round * n + offset];
            }
        }

        let mut state = Self {
            deck,
            players,
            hole,
            board: Vec::with_capacity(5),
            pot: sb + bb,
            min_raise: bb,
            small_blind: sb,
            big_blind: bb,
            dealer,
            turn,
            next_card: 2 * n,
            street: Street::Preflop,
            round_complete: false,
            fold_winner: None,
            settled: false,
        };

        state.round_complete = state.round_done();
        state
    }

    pub fn legal_actions(&self, player: usize) -> Option<LegalActions> {
        let actor = self.players.get(player)?;

        if self.fold_winner.is_some()
            || self.settled
            || self.round_complete
            || self.turn != player
            || actor.folded
            || actor.stack == 0
        {
            return None;
        }

        let current_bet = self.current_bet();
        let call = (actor.bet < current_bet).then(|| actor.stack.min(current_bet - actor.bet));

        Some(LegalActions {
            fold: true,
            check: actor.bet == current_bet,
            call,
            raise: self.raise_range(player, current_bet),
        })
    }

    pub fn apply(&mut self, player: usize, action: Action) -> Result<Vec<Event>, ActionError> {
        if player >= self.players.len() {
            return Err(ActionError::InvalidPlayer);
        }

        if self.fold_winner.is_some() {
            return Err(ActionError::HandComplete);
        }

        if self.round_complete {
            return Err(ActionError::RoundComplete);
        }

        if player != self.turn {
            return Err(ActionError::NotTurn);
        }

        let current_bet = self.current_bet();

        match action {
            Action::Check if self.players[player].bet != current_bet => {
                return Err(ActionError::CannotCheck);
            }
            Action::Call if self.players[player].bet >= current_bet => {
                return Err(ActionError::CannotCall);
            }
            Action::RaiseTo(to) if !self.can_raise(player, to, current_bet) => {
                return Err(ActionError::CannotRaise);
            }
            _ => {}
        }

        let mut events = Vec::with_capacity(2);

        match action {
            Action::Fold => {
                self.players[player].folded = true;
                events.push(Event::Folded { player });
            }
            Action::Check => {
                self.players[player].acted_bet = Some(current_bet);
                events.push(Event::Checked { player });
            }
            Action::Call => {
                let owed = current_bet - self.players[player].bet;
                let amount = self.players[player].stack.min(owed);

                self.players[player].stack -= amount;
                self.players[player].bet += amount;
                self.players[player].contributed += amount;
                self.players[player].acted_bet = Some(current_bet);
                self.pot += amount;
                events.push(Event::Called { player, amount });
            }
            Action::RaiseTo(to) => {
                let amount = to - self.players[player].bet;
                let raise_size = to - current_bet;

                self.players[player].stack -= amount;
                self.players[player].bet = to;
                self.players[player].contributed += amount;
                self.players[player].acted_bet = Some(to);
                self.pot += amount;

                // short all in raises keep the last full raise size
                if raise_size >= self.min_raise {
                    self.min_raise = raise_size;
                }

                events.push(Event::Raised { player, to });
            }
        }

        if self.players.iter().filter(|player| !player.folded).count() == 1 {
            let winner = self
                .players
                .iter()
                .position(|player| !player.folded)
                .unwrap();

            self.fold_winner = Some(winner);
            events.push(Event::WonByFold { player: winner });
            return Ok(events);
        }

        if self.round_done() {
            self.round_complete = true;
            events.push(Event::BettingRoundComplete);
            return Ok(events);
        }

        self.advance_turn(player);
        Ok(events)
    }

    pub fn advance_street(&mut self) -> Result<Event, AdvanceError> {
        if self.fold_winner.is_some() {
            return Err(AdvanceError::HandComplete);
        }

        if !self.round_complete {
            return Err(AdvanceError::CannotAdvance);
        }

        let event = match self.street {
            Street::Preflop => {
                // burn next card then deal three
                let k = self.next_card;
                let cards = [
                    self.deck.cards()[k + 1],
                    self.deck.cards()[k + 2],
                    self.deck.cards()[k + 3],
                ];

                self.board.extend_from_slice(&cards);
                self.next_card += 4;
                self.street = Street::Flop;
                Event::FlopDealt { cards }
            }
            Street::Flop => {
                // burn next card then deal one
                let card = self.deck.cards()[self.next_card + 1];

                self.board.push(card);
                self.next_card += 2;
                self.street = Street::Turn;
                Event::TurnDealt { card }
            }
            Street::Turn => {
                // burn next card then deal one
                let card = self.deck.cards()[self.next_card + 1];

                self.board.push(card);
                self.next_card += 2;
                self.street = Street::River;
                Event::RiverDealt { card }
            }
            Street::River => return Err(AdvanceError::CannotAdvance),
        };

        self.start_round();
        Ok(event)
    }

    pub fn settle(&mut self) -> Result<Vec<Event>, SettlementError> {
        if self.settled {
            return Err(SettlementError::AlreadySettled);
        }

        if let Some(winner) = self.fold_winner {
            let amount = self.pot;

            self.players[winner].stack += amount;
            self.pot = 0;
            self.settled = true;

            return Ok(vec![Event::Awarded {
                player: winner,
                amount,
            }]);
        }

        if self.street != Street::River || !self.round_complete || self.board.len() != 5 {
            return Err(SettlementError::NotReady);
        }

        // rank each live hand once for all pot layers
        let mut values = vec![None; self.players.len()];

        for (i, player) in self.players.iter().enumerate() {
            if player.folded {
                continue;
            }

            let hole = self.hole[i];
            values[i] = Some(eval7([
                hole[0],
                hole[1],
                self.board[0],
                self.board[1],
                self.board[2],
                self.board[3],
                self.board[4],
            ]));
        }

        let mut levels: Vec<_> = self
            .players
            .iter()
            .map(|player| player.contributed)
            .filter(|&level| level > 0)
            .collect();

        levels.sort_unstable();
        levels.dedup();

        let mut payouts = vec![0u64; self.players.len()];
        let mut prev = 0;

        for level in levels {
            // level gap times remaining contributors makes one pot layer
            // folded players add chips but cannot win
            let contributors = self
                .players
                .iter()
                .filter(|player| player.contributed >= level)
                .count() as u64;
            let amount = u64::from(level - prev) * contributors;
            let best = self
                .players
                .iter()
                .enumerate()
                .filter(|(_, player)| !player.folded && player.contributed >= level)
                .map(|(i, _)| values[i].unwrap())
                .max()
                .unwrap();
            let winners: Vec<_> = self
                .players
                .iter()
                .enumerate()
                .filter(|(i, player)| {
                    !player.folded && player.contributed >= level && values[*i] == Some(best)
                })
                .map(|(i, _)| i)
                .collect();
            let base = amount / winners.len() as u64;
            let mut remainder = amount % winners.len() as u64;

            for &winner in &winners {
                payouts[winner] += base;
            }

            // odd chips move clockwise left of dealer
            for offset in 1..=self.players.len() {
                if remainder == 0 {
                    break;
                }

                let player = (self.dealer + offset) % self.players.len();

                if winners.contains(&player) {
                    payouts[player] += 1;
                    remainder -= 1;
                }
            }

            prev = level;
        }

        assert_eq!(payouts.iter().sum::<u64>(), u64::from(self.pot));

        let mut events = Vec::with_capacity(self.players.len());

        for (i, payout) in payouts.into_iter().enumerate() {
            if payout == 0 {
                continue;
            }

            let amount = u32::try_from(payout).unwrap();

            self.players[i].stack += amount;
            events.push(Event::Awarded { player: i, amount });
        }

        self.pot = 0;
        self.settled = true;
        Ok(events)
    }

    pub fn next_hand(&self, seed: [u8; 32]) -> Result<Self, NextHandError> {
        if !self.settled {
            return Err(NextHandError::NotSettled);
        }

        let n = self.players.len();

        if !(2..=6).contains(&n)
            || self
                .players
                .iter()
                .any(|player| player.stack < self.big_blind)
        {
            return Err(NextHandError::CannotStart);
        }

        let dealer = (self.dealer + 1) % n;
        let stacks: Vec<_> = self.players.iter().map(|player| player.stack).collect();

        Ok(Self::new(
            seed,
            dealer,
            &stacks,
            self.small_blind,
            self.big_blind,
        ))
    }

    fn start_round(&mut self) {
        self.min_raise = self.big_blind;

        for player in &mut self.players {
            player.bet = 0;
            player.acted_bet = None;
        }

        let live = self
            .players
            .iter()
            .filter(|player| !player.folded && player.stack > 0)
            .count();

        self.round_complete = live < 2;

        if !self.round_complete {
            self.turn = self.first_postflop().unwrap();
        }
    }

    fn current_bet(&self) -> u32 {
        self.players.iter().map(|player| player.bet).max().unwrap()
    }

    fn can_raise(&self, player: usize, to: u32, current_bet: u32) -> bool {
        self.raise_range(player, current_bet)
            .is_some_and(|range| to > current_bet && (range.min_to..=range.max_to).contains(&to))
    }

    fn raise_range(&self, player: usize, current_bet: u32) -> Option<RaiseRange> {
        let player = &self.players[player];
        let max_to = player.bet.checked_add(player.stack)?;

        if max_to <= current_bet {
            return None;
        }

        // raising reopens after a full raise since the last response
        if let Some(acted_bet) = player.acted_bet
            && current_bet - acted_bet < self.min_raise
        {
            return None;
        }

        let min_to = current_bet
            .checked_add(self.min_raise)
            .filter(|&to| to <= max_to)
            .unwrap_or(max_to);

        Some(RaiseRange { min_to, max_to })
    }

    fn round_done(&self) -> bool {
        let current_bet = self.current_bet();
        let live = self
            .players
            .iter()
            .filter(|player| !player.folded && player.stack > 0)
            .count();

        // one player with chips only acts when still below current bet
        if live <= 1 {
            return self
                .players
                .iter()
                .filter(|player| !player.folded && player.stack > 0)
                .all(|player| player.bet == current_bet);
        }

        self.players
            .iter()
            .filter(|player| !player.folded && player.stack > 0)
            .all(|player| player.acted_bet.is_some() && player.bet == current_bet)
    }

    fn needs_action(&self, player: usize, current_bet: u32) -> bool {
        let player = &self.players[player];

        !player.folded
            && player.stack > 0
            && (player.acted_bet.is_none() || player.bet < current_bet)
    }

    fn advance_turn(&mut self, player: usize) {
        let current_bet = self.current_bet();

        for offset in 1..=self.players.len() {
            let next = (player + offset) % self.players.len();

            if self.needs_action(next, current_bet) {
                self.turn = next;
                return;
            }
        }
    }

    fn first_postflop(&self) -> Option<usize> {
        for offset in 1..=self.players.len() {
            let player = (self.dealer + offset) % self.players.len();

            if !self.players[player].folded && self.players[player].stack > 0 {
                return Some(player);
            }
        }

        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Rank::*;
    use crate::Suit::*;
    use crate::{Rank, Suit};

    // fixed seed keeps deck order repeatable
    // repeated 0x42 fills required seed size
    const SEED: [u8; 32] = [0x42; 32];

    // separate fixed seed makes next shuffle repeatable
    const NEXT_SEED: [u8; 32] = [0x24; 32];

    fn player(stack: u32, bet: u32) -> Player {
        Player {
            stack,
            bet,
            contributed: bet,
            folded: false,
            acted_bet: None,
        }
    }

    fn contributions(state: &State) -> u64 {
        state
            .players
            .iter()
            .map(|player| u64::from(player.contributed))
            .sum()
    }

    fn finish_round(state: &mut State) {
        while !state.round_complete {
            let player = state.turn;
            let action = if state.players[player].bet == state.current_bet() {
                Action::Check
            } else {
                Action::Call
            };

            state.apply(player, action).unwrap();
        }
    }

    fn showdown(
        dealer: usize,
        contributed: &[u32],
        board: [(Rank, Suit); 5],
        hole: &[[(Rank, Suit); 2]],
    ) -> State {
        assert_eq!(contributed.len(), hole.len());

        let stacks = vec![100; contributed.len()];
        let mut state = State::new(SEED, dealer, &stacks, 5, 10);

        state.board = board.map(|(rank, suit)| Card::new(rank, suit)).to_vec();
        state.hole = hole
            .iter()
            .map(|&cards| cards.map(|(rank, suit)| Card::new(rank, suit)))
            .collect();

        for (player, &amount) in state.players.iter_mut().zip(contributed) {
            player.stack = 100 - amount;
            player.bet = 0;
            player.contributed = amount;
            player.folded = false;
            player.acted_bet = None;
        }

        state.pot = contributed.iter().sum();
        state.street = Street::River;
        state.round_complete = true;
        state.fold_winner = None;
        state.settled = false;
        state
    }

    fn stack_total(state: &State) -> u64 {
        state
            .players
            .iter()
            .map(|player| u64::from(player.stack))
            .sum()
    }

    fn finish_hand(state: &mut State) {
        finish_round(state);

        for _ in 0..3 {
            state.advance_street().unwrap();
            finish_round(state);
        }

        state.settle().unwrap();
    }

    fn unique_cards(state: &State) {
        let mut cards: Vec<_> = state.hole.iter().flatten().copied().collect();
        cards.extend(state.board.iter().copied());

        for a in 0..cards.len() {
            for b in a + 1..cards.len() {
                assert_ne!(cards[a], cards[b]);
            }
        }
    }

    fn assert_active(state: &State, total: u64) {
        assert_eq!(stack_total(state) + u64::from(state.pot), total);
        assert_eq!(contributions(state), u64::from(state.pot));
    }

    fn assert_settled(state: &State, total: u64) {
        assert!(state.settled);
        assert_eq!(state.pot, 0);
        assert_eq!(stack_total(state), total);
    }

    fn fold_hand(n: usize, dealer: usize) -> State {
        let stacks = vec![100; n];
        let mut state = State::new(SEED, dealer, &stacks, 5, 10);

        while state.fold_winner.is_none() {
            let player = state.turn;
            state.apply(player, Action::Fold).unwrap();
        }

        state.settle().unwrap();
        state
    }

    #[test]
    fn player_bounds() {
        let two = State::new(SEED, 0, &[1000; 2], 5, 10);
        let six = State::new(SEED, 0, &[1000; 6], 5, 10);

        assert_eq!(two.players.len(), 2);
        assert_eq!(two.hole.len(), 2);
        assert_eq!(six.players.len(), 6);
        assert_eq!(six.hole.len(), 6);
        assert_eq!(two.street, Street::Preflop);
        assert!(two.board.is_empty());
        assert_eq!(two.min_raise, 10);
        assert_eq!(two.small_blind, 5);
        assert_eq!(two.big_blind, 10);
        assert!(!two.round_complete);
        assert_eq!(two.fold_winner, None);
        assert!(!two.settled);
    }

    #[test]
    #[should_panic]
    fn one_player() {
        State::new(SEED, 0, &[1000], 5, 10);
    }

    #[test]
    #[should_panic]
    fn seven_players() {
        State::new(SEED, 0, &[1000; 7], 5, 10);
    }

    #[test]
    #[should_panic]
    fn chip_limit() {
        State::new(SEED, 0, &[u32::MAX, 10], 5, 10);
    }

    #[test]
    fn blind_all_in() {
        let state = State::new(SEED, 0, &[10, 100], 10, 10);

        assert_eq!(state.players[0].stack, 0);
        assert_eq!(state.players[1].acted_bet, None);
        assert!(state.round_complete);
    }

    #[test]
    fn heads_up_zero() {
        let state = State::new(SEED, 0, &[1000; 2], 5, 10);

        assert_eq!(state.players[0], player(995, 5));
        assert_eq!(state.players[1], player(990, 10));
        assert_eq!(state.pot, 15);
        assert_eq!(state.dealer, 0);
        assert_eq!(state.turn, 0);
    }

    #[test]
    fn heads_up_one() {
        let state = State::new(SEED, 1, &[1000; 2], 5, 10);

        assert_eq!(state.players[0], player(990, 10));
        assert_eq!(state.players[1], player(995, 5));
        assert_eq!(state.pot, 15);
        assert_eq!(state.dealer, 1);
        assert_eq!(state.turn, 1);
    }

    #[test]
    fn initial_contribution() {
        let state = State::new(SEED, 2, &[1000; 6], 5, 10);

        for i in [0, 1, 2, 5] {
            assert_eq!(state.players[i].contributed, 0);
        }

        assert_eq!(state.players[3].contributed, 5);
        assert_eq!(state.players[4].contributed, 10);
        assert_eq!(state.pot, 15);
        assert_eq!(contributions(&state), u64::from(state.pot));
    }

    #[test]
    fn three_positions() {
        let state = State::new(SEED, 0, &[1000; 3], 5, 10);

        assert_eq!(state.players[0], player(1000, 0));
        assert_eq!(state.players[1], player(995, 5));
        assert_eq!(state.players[2], player(990, 10));
        assert_eq!(state.turn, 0);
    }

    #[test]
    fn six_positions() {
        let state = State::new(SEED, 2, &[1000; 6], 5, 10);

        assert_eq!(state.players[3], player(995, 5));
        assert_eq!(state.players[4], player(990, 10));
        assert_eq!(state.turn, 5);
    }

    #[test]
    fn position_wrap() {
        let state = State::new(SEED, 5, &[1000; 6], 5, 10);

        assert_eq!(state.players[0], player(995, 5));
        assert_eq!(state.players[1], player(990, 10));
        assert_eq!(state.turn, 2);
    }

    #[test]
    fn non_blinds() {
        let state = State::new(SEED, 2, &[1000; 6], 5, 10);

        for i in [0, 1, 2, 5] {
            assert_eq!(state.players[i], player(1000, 0));
        }
    }

    #[test]
    fn heads_up_deal() {
        let deck = Deck::from_seed(SEED);
        let state = State::new(SEED, 0, &[1000; 2], 5, 10);

        assert_eq!(state.hole[1], [deck.cards()[0], deck.cards()[2]]);
        assert_eq!(state.hole[0], [deck.cards()[1], deck.cards()[3]]);
    }

    #[test]
    fn six_deal() {
        let deck = Deck::from_seed(SEED);
        let state = State::new(SEED, 2, &[1000; 6], 5, 10);
        let positions = [[3, 9], [4, 10], [5, 11], [0, 6], [1, 7], [2, 8]];

        for (player, [a, b]) in positions.into_iter().enumerate() {
            assert_eq!(state.hole[player], [deck.cards()[a], deck.cards()[b]]);
        }
    }

    #[test]
    fn unique_hole() {
        for n in 2..=6 {
            let stacks = vec![1000; n];
            let state = State::new(SEED, 0, &stacks, 5, 10);
            let cards: Vec<_> = state.hole.iter().flatten().copied().collect();

            assert_eq!(cards.len(), 2 * n);

            for a in 0..cards.len() {
                for b in a + 1..cards.len() {
                    assert_ne!(cards[a], cards[b]);
                }
            }
        }
    }

    #[test]
    fn deck_position() {
        for n in [2, 6] {
            let stacks = vec![1000; n];
            let state = State::new(SEED, 0, &stacks, 5, 10);
            let next = state.deck.cards()[state.next_card];

            assert_eq!(state.next_card, 2 * n);
            assert!(state.hole.iter().flatten().all(|&card| card != next));
        }
    }

    #[test]
    fn same_state() {
        let stacks = [1000, 1200, 900, 1500, 800, 1100];
        let mut a = State::new(SEED, 2, &stacks, 5, 10);
        let mut b = State::new(SEED, 2, &stacks, 5, 10);

        assert_eq!(a.apply(5, Action::Call), b.apply(5, Action::Call));
        assert_eq!(a, b);
    }

    #[test]
    fn unequal_stacks() {
        let stacks = [1000, 1200, 900, 1500, 800, 1100];
        let state = State::new(SEED, 2, &stacks, 5, 10);

        assert_eq!(
            state.players,
            vec![
                player(1000, 0),
                player(1200, 0),
                player(900, 0),
                player(1495, 5),
                player(790, 10),
                player(1100, 0)
            ]
        );
    }

    #[test]
    fn chip_total() {
        let stacks = [100, 20, 100];
        let mut state = State::new(SEED, 0, &stacks, 5, 10);
        let before: u64 = stacks.iter().map(|&stack| u64::from(stack)).sum();

        state.apply(0, Action::RaiseTo(50)).unwrap();
        state.apply(1, Action::Call).unwrap();
        state.apply(2, Action::Call).unwrap();

        let after: u64 = state
            .players
            .iter()
            .map(|player| u64::from(player.stack))
            .sum();

        assert_eq!(before, after + u64::from(state.pot));
        assert_eq!(contributions(&state), u64::from(state.pot));
    }

    #[test]
    fn contribution_total() {
        let mut state = State::new(SEED, 0, &[100; 3], 5, 10);

        state.apply(0, Action::Call).unwrap();
        assert_eq!(contributions(&state), u64::from(state.pot));
        state.apply(1, Action::RaiseTo(20)).unwrap();
        assert_eq!(contributions(&state), u64::from(state.pot));
        state.apply(2, Action::Call).unwrap();
        assert_eq!(contributions(&state), u64::from(state.pot));
        state.apply(0, Action::Call).unwrap();

        assert_eq!(
            state
                .players
                .iter()
                .map(|player| player.contributed)
                .collect::<Vec<_>>(),
            vec![20, 20, 20]
        );
        assert_eq!(state.pot, 60);
        assert_eq!(contributions(&state), u64::from(state.pot));
    }

    #[test]
    fn heads_up_actions() {
        let mut state = State::new(SEED, 0, &[1000; 2], 5, 10);

        assert_eq!(
            state.apply(0, Action::Call),
            Ok(vec![Event::Called {
                player: 0,
                amount: 5
            }])
        );
        assert_eq!(state.players[0].stack, 990);
        assert_eq!(state.players[0].bet, 10);
        assert_eq!(state.players[0].acted_bet, Some(10));
        assert_eq!(state.pot, 20);
        assert_eq!(state.turn, 1);
        assert!(!state.round_complete);

        assert_eq!(
            state.apply(1, Action::Check),
            Ok(vec![
                Event::Checked { player: 1 },
                Event::BettingRoundComplete
            ])
        );
        assert_eq!(state.players[1].acted_bet, Some(10));
        assert!(state.round_complete);
        assert_eq!(state.fold_winner, None);

        assert_eq!(
            state.apply(0, Action::Fold),
            Err(ActionError::RoundComplete)
        );
        assert!(!state.players[0].folded);
        assert_eq!(state.pot, 20);
    }

    #[test]
    fn cannot_check() {
        let mut state = State::new(SEED, 0, &[1000; 2], 5, 10);
        let same = State::new(SEED, 0, &[1000; 2], 5, 10);

        assert_eq!(state.apply(0, Action::Check), Err(ActionError::CannotCheck));
        assert_eq!(state, same);
    }

    #[test]
    fn cannot_call() {
        let mut state = State::new(SEED, 0, &[1000; 2], 5, 10);
        let mut same = State::new(SEED, 0, &[1000; 2], 5, 10);

        state.apply(0, Action::Call).unwrap();
        same.apply(0, Action::Call).unwrap();

        assert_eq!(state.apply(1, Action::Call), Err(ActionError::CannotCall));
        assert_eq!(state, same);
    }

    #[test]
    fn wrong_turn() {
        let mut state = State::new(SEED, 0, &[1000; 2], 5, 10);
        let same = State::new(SEED, 0, &[1000; 2], 5, 10);

        assert_eq!(state.apply(1, Action::Check), Err(ActionError::NotTurn));
        assert_eq!(state, same);
    }

    #[test]
    fn invalid_player() {
        let mut state = State::new(SEED, 0, &[1000; 2], 5, 10);
        let same = State::new(SEED, 0, &[1000; 2], 5, 10);

        assert_eq!(
            state.apply(2, Action::Fold),
            Err(ActionError::InvalidPlayer)
        );
        assert_eq!(state, same);
    }

    #[test]
    fn fold() {
        let mut state = State::new(SEED, 0, &[1000; 3], 5, 10);

        assert_eq!(
            state.apply(0, Action::Fold),
            Ok(vec![Event::Folded { player: 0 }])
        );
        assert!(state.players[0].folded);
        assert_eq!(state.players[0].acted_bet, None);
        assert_eq!(state.players[0].stack, 1000);
        assert_eq!(state.players[0].bet, 0);
        assert_eq!(state.pot, 15);
        assert_eq!(state.turn, 1);
        assert!(!state.players[state.turn].folded);
        assert_eq!(state.fold_winner, None);
    }

    #[test]
    fn win_by_fold() {
        let mut state = State::new(SEED, 0, &[1000; 4], 5, 10);

        state.apply(3, Action::Fold).unwrap();
        state.apply(0, Action::Fold).unwrap();

        assert_eq!(
            state.apply(1, Action::Fold),
            Ok(vec![
                Event::Folded { player: 1 },
                Event::WonByFold { player: 2 }
            ])
        );
        assert_eq!(state.fold_winner, Some(2));
        assert!(!state.round_complete);
        assert_eq!(state.players[2].stack, 990);
        assert_eq!(state.pot, 15);
        assert_eq!(
            state.apply(2, Action::Check),
            Err(ActionError::HandComplete)
        );
        assert_eq!(state.players[2].stack, 990);
        assert_eq!(state.pot, 15);
    }

    #[test]
    fn big_blind_option() {
        let mut state = State::new(SEED, 0, &[1000; 3], 5, 10);

        state.apply(0, Action::Call).unwrap();
        assert_eq!(
            state.apply(1, Action::Call),
            Ok(vec![Event::Called {
                player: 1,
                amount: 5
            }])
        );
        assert!(state.players.iter().all(|player| player.bet == 10));
        assert!(!state.round_complete);
        assert_eq!(state.turn, 2);
        assert_eq!(state.players[2].acted_bet, None);

        assert_eq!(
            state.apply(2, Action::Check),
            Ok(vec![
                Event::Checked { player: 2 },
                Event::BettingRoundComplete
            ])
        );
        assert!(state.round_complete);
    }

    #[test]
    fn multiway_round() {
        let mut state = State::new(SEED, 5, &[1000; 6], 5, 10);

        assert_eq!(
            state.apply(2, Action::Fold),
            Ok(vec![Event::Folded { player: 2 }])
        );
        assert_eq!(state.turn, 3);
        assert_eq!(
            state.apply(3, Action::Call),
            Ok(vec![Event::Called {
                player: 3,
                amount: 10
            }])
        );
        assert_eq!(state.turn, 4);
        assert_eq!(
            state.apply(4, Action::Fold),
            Ok(vec![Event::Folded { player: 4 }])
        );
        assert_eq!(state.turn, 5);
        state.apply(5, Action::Call).unwrap();
        assert_eq!(state.turn, 0);
        state.apply(0, Action::Call).unwrap();
        assert_eq!(state.turn, 1);
        assert_eq!(
            state.apply(1, Action::Check),
            Ok(vec![
                Event::Checked { player: 1 },
                Event::BettingRoundComplete
            ])
        );
        assert!(state.round_complete);
        assert_eq!(state.fold_winner, None);
        assert_eq!(state.pot, 40);
    }

    #[test]
    fn check_actions() {
        let mut state = State::new(SEED, 0, &[100; 2], 5, 10);

        state.apply(0, Action::Call).unwrap();
        state.apply(1, Action::Check).unwrap();
        state.advance_street().unwrap();

        assert_eq!(
            state.legal_actions(1),
            Some(LegalActions {
                fold: true,
                check: true,
                call: None,
                raise: Some(RaiseRange {
                    min_to: 10,
                    max_to: 90,
                }),
            })
        );
    }

    #[test]
    fn call_actions() {
        let state = State::new(SEED, 3, &[100; 6], 5, 10);

        assert_eq!(
            state.legal_actions(0),
            Some(LegalActions {
                fold: true,
                check: false,
                call: Some(10),
                raise: Some(RaiseRange {
                    min_to: 20,
                    max_to: 100,
                }),
            })
        );
    }

    #[test]
    fn short_call_actions() {
        let mut state = State::new(SEED, 0, &[100, 20, 100], 5, 10);

        state.apply(0, Action::RaiseTo(50)).unwrap();

        assert_eq!(state.legal_actions(1).unwrap().call, Some(15));
        assert_eq!(state.legal_actions(1).unwrap().raise, None);
    }

    #[test]
    fn raise_bounds() {
        let mut state = State::new(SEED, 0, &[100; 2], 5, 10);
        let range = state.legal_actions(0).unwrap().raise.unwrap();

        assert_eq!(
            range,
            RaiseRange {
                min_to: 20,
                max_to: 100,
            }
        );
        assert_eq!(
            state.apply(0, Action::RaiseTo(range.min_to - 1)),
            Err(ActionError::CannotRaise)
        );
        assert_eq!(
            state.apply(0, Action::RaiseTo(range.min_to)),
            Ok(vec![Event::Raised {
                player: 0,
                to: range.min_to,
            }])
        );
    }

    #[test]
    fn short_raise_actions() {
        let mut state = State::new(SEED, 0, &[15, 100, 100], 5, 10);
        let range = state.legal_actions(0).unwrap().raise.unwrap();

        assert_eq!(
            range,
            RaiseRange {
                min_to: 15,
                max_to: 15,
            }
        );
        assert!(state.apply(0, Action::RaiseTo(range.min_to)).is_ok());
    }

    #[test]
    fn closed_raise_actions() {
        let mut state = State::new(SEED, 0, &[100, 15, 100, 100], 5, 10);

        state.apply(3, Action::Call).unwrap();
        state.apply(0, Action::Fold).unwrap();
        state.apply(1, Action::RaiseTo(15)).unwrap();
        state.apply(2, Action::Call).unwrap();

        let actions = state.legal_actions(3).unwrap();

        assert_eq!(actions.call, Some(5));
        assert_eq!(actions.raise, None);
    }

    #[test]
    fn reopened_raise_actions() {
        let mut state = State::new(SEED, 0, &[20, 100, 100, 100, 15], 5, 10);

        state.apply(3, Action::Call).unwrap();
        state.apply(4, Action::RaiseTo(15)).unwrap();
        state.apply(0, Action::RaiseTo(20)).unwrap();
        state.apply(1, Action::Call).unwrap();
        state.apply(2, Action::Call).unwrap();

        let range = state.legal_actions(3).unwrap().raise.unwrap();

        assert_eq!(
            range,
            RaiseRange {
                min_to: 30,
                max_to: 100,
            }
        );
        assert!(state.apply(3, Action::RaiseTo(range.min_to)).is_ok());
    }

    #[test]
    fn no_actions() {
        let state = State::new(SEED, 3, &[100; 6], 5, 10);

        assert_eq!(state.legal_actions(1), None);
        assert_eq!(state.legal_actions(6), None);

        let mut terminal = State::new(SEED, 0, &[100; 2], 5, 10);
        terminal.apply(0, Action::Fold).unwrap();

        assert_eq!(terminal.legal_actions(0), None);
        assert_eq!(terminal.legal_actions(1), None);
    }

    #[test]
    fn minimum_raise() {
        let mut state = State::new(SEED, 0, &[20, 100], 5, 10);

        assert_eq!(
            state.apply(0, Action::RaiseTo(20)),
            Ok(vec![Event::Raised { player: 0, to: 20 }])
        );
        assert_eq!(state.players[0].stack, 0);
        assert_eq!(state.players[0].bet, 20);
        assert_eq!(state.players[0].acted_bet, Some(20));
        assert_eq!(state.pot, 30);
        assert_eq!(state.min_raise, 10);
        assert_eq!(state.turn, 1);
        assert!(!state.round_complete);
    }

    #[test]
    fn larger_raise() {
        let mut state = State::new(SEED, 0, &[100; 3], 5, 10);

        assert_eq!(
            state.apply(0, Action::RaiseTo(30)),
            Ok(vec![Event::Raised { player: 0, to: 30 }])
        );
        assert_eq!(state.players[0].stack, 70);
        assert_eq!(state.players[0].bet, 30);
        assert_eq!(state.pot, 45);
        assert_eq!(state.min_raise, 20);
        assert_eq!(state.turn, 1);

        let player = state.players[1];
        let pot = state.pot;

        assert_eq!(
            state.apply(1, Action::RaiseTo(40)),
            Err(ActionError::CannotRaise)
        );
        assert_eq!(state.players[1], player);
        assert_eq!(state.pot, pot);
        assert_eq!(state.min_raise, 20);
        assert_eq!(state.turn, 1);

        assert_eq!(
            state.apply(1, Action::RaiseTo(50)),
            Ok(vec![Event::Raised { player: 1, to: 50 }])
        );
        assert_eq!(state.players[1].stack, 50);
        assert_eq!(state.players[1].bet, 50);
        assert_eq!(state.pot, 90);
        assert_eq!(state.min_raise, 20);
        assert_eq!(state.turn, 2);
    }

    #[test]
    fn invalid_raise() {
        let mut state = State::new(SEED, 0, &[100; 2], 5, 10);
        let same = State::new(SEED, 0, &[100; 2], 5, 10);

        for action in [
            Action::RaiseTo(10),
            Action::RaiseTo(101),
            Action::RaiseTo(15),
        ] {
            assert_eq!(state.apply(0, action), Err(ActionError::CannotRaise));
            assert_eq!(state, same);
        }
    }

    #[test]
    fn full_reopen() {
        let mut call = State::new(SEED, 0, &[100; 4], 5, 10);
        let mut raise = State::new(SEED, 0, &[100; 4], 5, 10);

        for state in [&mut call, &mut raise] {
            state.apply(3, Action::Call).unwrap();
            state.apply(0, Action::Call).unwrap();
            state.apply(1, Action::RaiseTo(20)).unwrap();
            state.apply(2, Action::Call).unwrap();

            assert_eq!(state.turn, 3);
            assert_eq!(state.players[3].acted_bet, Some(10));
        }

        assert_eq!(
            call.apply(3, Action::Call),
            Ok(vec![Event::Called {
                player: 3,
                amount: 10
            }])
        );
        assert_eq!(
            raise.apply(3, Action::RaiseTo(30)),
            Ok(vec![Event::Raised { player: 3, to: 30 }])
        );
    }

    #[test]
    fn short_call() {
        let stacks = [100, 20, 100];
        let mut state = State::new(SEED, 0, &stacks, 5, 10);
        let before: u64 = stacks.iter().map(|&stack| u64::from(stack)).sum();

        state.apply(0, Action::RaiseTo(50)).unwrap();
        assert_eq!(
            state.apply(1, Action::Call),
            Ok(vec![Event::Called {
                player: 1,
                amount: 15
            }])
        );
        assert_eq!(state.players[1].stack, 0);
        assert_eq!(state.players[1].bet, 20);
        assert_eq!(state.players[1].acted_bet, Some(50));
        assert_eq!(state.turn, 2);

        assert_eq!(
            state.apply(2, Action::Call),
            Ok(vec![
                Event::Called {
                    player: 2,
                    amount: 40
                },
                Event::BettingRoundComplete
            ])
        );
        assert!(state.round_complete);

        let after: u64 = state
            .players
            .iter()
            .map(|player| u64::from(player.stack))
            .sum();

        assert_eq!(before, after + u64::from(state.pot));
    }

    #[test]
    fn short_raise() {
        let mut state = State::new(SEED, 0, &[15, 100, 100], 5, 10);

        assert_eq!(
            state.apply(0, Action::RaiseTo(15)),
            Ok(vec![Event::Raised { player: 0, to: 15 }])
        );
        assert_eq!(state.players[0].stack, 0);
        assert_eq!(state.players[0].bet, 15);
        assert_eq!(state.players[0].acted_bet, Some(15));
        assert_eq!(state.pot, 30);
        assert_eq!(state.min_raise, 10);
        assert_eq!(state.turn, 1);
    }

    #[test]
    fn short_closed() {
        let mut state = State::new(SEED, 0, &[100, 15, 100, 100], 5, 10);

        state.apply(3, Action::Call).unwrap();
        state.apply(0, Action::Fold).unwrap();
        state.apply(1, Action::RaiseTo(15)).unwrap();
        state.apply(2, Action::Call).unwrap();

        assert_eq!(state.turn, 3);
        assert_eq!(state.current_bet(), 15);
        assert_eq!(state.min_raise, 10);

        let player = state.players[3];
        let pot = state.pot;

        assert_eq!(
            state.apply(3, Action::RaiseTo(25)),
            Err(ActionError::CannotRaise)
        );
        assert_eq!(state.players[3], player);
        assert_eq!(state.pot, pot);
        assert_eq!(state.turn, 3);

        assert_eq!(
            state.apply(3, Action::Call),
            Ok(vec![
                Event::Called {
                    player: 3,
                    amount: 5
                },
                Event::BettingRoundComplete
            ])
        );
    }

    #[test]
    fn short_reopen() {
        let mut state = State::new(SEED, 0, &[20, 100, 100, 100, 15], 5, 10);

        state.apply(3, Action::Call).unwrap();
        state.apply(4, Action::RaiseTo(15)).unwrap();
        state.apply(0, Action::RaiseTo(20)).unwrap();
        state.apply(1, Action::Call).unwrap();
        state.apply(2, Action::Call).unwrap();

        assert_eq!(state.current_bet(), 20);
        assert_eq!(state.min_raise, 10);
        assert_eq!(state.turn, 3);
        assert_eq!(state.players[3].acted_bet, Some(10));

        assert_eq!(
            state.apply(3, Action::RaiseTo(30)),
            Ok(vec![Event::Raised { player: 3, to: 30 }])
        );
        assert_eq!(state.players[3].stack, 70);
        assert_eq!(state.players[3].bet, 30);
        assert_eq!(state.players[4].stack, 0);
        assert_eq!(state.players[0].stack, 0);
        assert_eq!(state.turn, 1);
    }

    #[test]
    fn all_in_skip() {
        let mut state = State::new(SEED, 0, &[15, 100, 100, 100], 5, 10);

        state.apply(3, Action::Call).unwrap();
        state.apply(0, Action::RaiseTo(15)).unwrap();
        state.apply(1, Action::Call).unwrap();
        state.apply(2, Action::RaiseTo(25)).unwrap();
        state.apply(3, Action::Call).unwrap();

        assert_eq!(state.players[0].stack, 0);
        assert_eq!(state.turn, 1);

        assert_eq!(
            state.apply(1, Action::Call),
            Ok(vec![
                Event::Called {
                    player: 1,
                    amount: 10
                },
                Event::BettingRoundComplete
            ])
        );
        assert!(state.round_complete);
    }

    #[test]
    fn lone_stack() {
        let mut state = State::new(SEED, 0, &[10, 10, 100], 5, 10);

        state.apply(0, Action::Call).unwrap();
        assert_eq!(state.turn, 1);

        assert_eq!(
            state.apply(1, Action::Call),
            Ok(vec![
                Event::Called {
                    player: 1,
                    amount: 5
                },
                Event::BettingRoundComplete
            ])
        );
        assert!(state.round_complete);
        assert_eq!(state.players[0].stack, 0);
        assert_eq!(state.players[1].stack, 0);
        assert_eq!(state.players[2].acted_bet, None);
    }

    #[test]
    fn cannot_advance() {
        let mut state = State::new(SEED, 0, &[100; 2], 5, 10);
        let same = State::new(SEED, 0, &[100; 2], 5, 10);

        assert_eq!(state.advance_street(), Err(AdvanceError::CannotAdvance));
        assert_eq!(state, same);
    }

    #[test]
    fn advance_fold_win() {
        let mut state = State::new(SEED, 0, &[100; 2], 5, 10);
        let mut same = State::new(SEED, 0, &[100; 2], 5, 10);

        state.apply(0, Action::Fold).unwrap();
        same.apply(0, Action::Fold).unwrap();

        assert_eq!(state.advance_street(), Err(AdvanceError::HandComplete));
        assert_eq!(state, same);
    }

    #[test]
    fn flop_deal() {
        for n in [2, 6] {
            let stacks = vec![100; n];
            let mut state = State::new(SEED, 0, &stacks, 5, 10);

            assert_eq!(state.street, Street::Preflop);
            assert!(state.board.is_empty());
            finish_round(&mut state);

            let k = state.next_card;
            let burn = state.deck.cards()[k];
            let flop = [
                state.deck.cards()[k + 1],
                state.deck.cards()[k + 2],
                state.deck.cards()[k + 3],
            ];

            assert_eq!(state.advance_street(), Ok(Event::FlopDealt { cards: flop }));
            assert_eq!(state.street, Street::Flop);
            assert_eq!(state.board.as_slice(), flop.as_slice());
            assert!(!state.board.contains(&burn));
            assert_eq!(state.next_card, k + 4);
        }
    }

    #[test]
    fn flop_reset() {
        let mut state = State::new(SEED, 0, &[100; 2], 5, 10);

        state.apply(0, Action::RaiseTo(40)).unwrap();
        state.apply(1, Action::Call).unwrap();

        let contributed: Vec<_> = state
            .players
            .iter()
            .map(|player| player.contributed)
            .collect();
        let stacks: Vec<_> = state.players.iter().map(|player| player.stack).collect();
        let pot = state.pot;

        assert_eq!(state.min_raise, 30);
        assert!(state.players.iter().all(|player| player.bet == 40));
        state.advance_street().unwrap();

        assert_eq!(state.street, Street::Flop);
        assert_eq!(state.board.len(), 3);
        assert!(state.players.iter().all(|player| player.bet == 0));
        assert!(
            state
                .players
                .iter()
                .all(|player| player.acted_bet.is_none())
        );
        assert_eq!(
            state
                .players
                .iter()
                .map(|player| player.contributed)
                .collect::<Vec<_>>(),
            contributed
        );
        assert_eq!(
            state
                .players
                .iter()
                .map(|player| player.stack)
                .collect::<Vec<_>>(),
            stacks
        );
        assert_eq!(state.pot, pot);
        assert_eq!(state.min_raise, 10);
        assert_eq!(state.big_blind, 10);
        assert_eq!(state.current_bet(), 0);
        assert_eq!(state.turn, 1);
        assert!(!state.round_complete);
        assert_eq!(contributions(&state), u64::from(state.pot));
    }

    #[test]
    fn flop_turn() {
        let mut state = State::new(SEED, 5, &[100; 6], 5, 10);

        state.apply(2, Action::Call).unwrap();
        state.apply(3, Action::Call).unwrap();
        state.apply(4, Action::Call).unwrap();
        state.apply(5, Action::Call).unwrap();
        state.apply(0, Action::Fold).unwrap();
        state.apply(1, Action::Check).unwrap();
        state.advance_street().unwrap();

        assert!(state.players[0].folded);
        assert_eq!(state.players[0].bet, 0);
        assert_eq!(state.players[0].contributed, 5);
        assert_eq!(state.turn, 1);
        assert!(!state.round_complete);
    }

    #[test]
    fn flop_all_in() {
        let mut state = State::new(SEED, 5, &[10, 100, 100, 100, 100, 100], 5, 10);

        state.apply(2, Action::Call).unwrap();
        state.apply(3, Action::Call).unwrap();
        state.apply(4, Action::Call).unwrap();
        state.apply(5, Action::Call).unwrap();
        state.apply(0, Action::Call).unwrap();
        state.apply(1, Action::Check).unwrap();
        state.advance_street().unwrap();

        assert_eq!(state.players[0].stack, 0);
        assert_eq!(state.players[0].bet, 0);
        assert_eq!(state.players[0].contributed, 10);
        assert!(!state.players[0].folded);
        assert_eq!(state.turn, 1);
        assert!(!state.round_complete);
    }

    #[test]
    fn lone_stack_runout() {
        let mut state = State::new(SEED, 0, &[10, 10, 100], 5, 10);

        state.apply(0, Action::Call).unwrap();
        state.apply(1, Action::Call).unwrap();

        assert!(state.round_complete);
        assert_eq!(state.fold_winner, None);
        state.advance_street().unwrap();
        assert_eq!(state.street, Street::Flop);
        assert_eq!(state.board.len(), 3);
        assert!(state.round_complete);
        assert_eq!(state.fold_winner, None);

        state.advance_street().unwrap();
        assert_eq!(state.street, Street::Turn);
        assert_eq!(state.board.len(), 4);
        assert!(state.round_complete);
        assert_eq!(state.fold_winner, None);

        state.advance_street().unwrap();
        assert_eq!(state.street, Street::River);
        assert_eq!(state.board.len(), 5);
        assert!(state.round_complete);
        assert_eq!(state.fold_winner, None);

        assert_eq!(state.players[0].stack, 0);
        assert_eq!(state.players[1].stack, 0);
        assert_eq!(state.players[2].stack, 90);
        assert!(state.players.iter().all(|player| !player.folded));
    }

    #[test]
    fn flop_betting() {
        let mut state = State::new(SEED, 0, &[100; 2], 5, 10);

        state.apply(0, Action::Call).unwrap();
        state.apply(1, Action::Check).unwrap();
        state.advance_street().unwrap();

        assert_eq!(state.turn, 1);
        assert_eq!(
            state.apply(1, Action::Check),
            Ok(vec![Event::Checked { player: 1 }])
        );
        assert_eq!(state.turn, 0);
        assert_eq!(
            state.apply(0, Action::RaiseTo(10)),
            Ok(vec![Event::Raised { player: 0, to: 10 }])
        );
        assert_eq!(state.turn, 1);
        assert_eq!(
            state.apply(1, Action::Call),
            Ok(vec![
                Event::Called {
                    player: 1,
                    amount: 10
                },
                Event::BettingRoundComplete
            ])
        );

        assert_eq!(state.street, Street::Flop);
        assert!(state.round_complete);
        assert_eq!(state.players[0].bet, 10);
        assert_eq!(state.players[1].bet, 10);
        assert_eq!(state.players[0].contributed, 20);
        assert_eq!(state.players[1].contributed, 20);
        assert_eq!(state.pot, 40);
        assert_eq!(contributions(&state), u64::from(state.pot));
    }

    #[test]
    fn turn_deal() {
        let mut state = State::new(SEED, 0, &[100; 2], 5, 10);

        finish_round(&mut state);
        state.advance_street().unwrap();
        finish_round(&mut state);

        let k = state.next_card;
        let burn = state.deck.cards()[k];
        let turn = state.deck.cards()[k + 1];

        assert_eq!(state.advance_street(), Ok(Event::TurnDealt { card: turn }));
        assert_eq!(state.street, Street::Turn);
        assert_eq!(state.board.len(), 4);
        assert_eq!(state.board[3], turn);
        assert!(!state.board.contains(&burn));
        assert_eq!(state.next_card, k + 2);
    }

    #[test]
    fn river_deal() {
        let mut state = State::new(SEED, 0, &[100; 2], 5, 10);

        finish_round(&mut state);
        state.advance_street().unwrap();
        finish_round(&mut state);
        state.advance_street().unwrap();
        finish_round(&mut state);

        let k = state.next_card;
        let burn = state.deck.cards()[k];
        let river = state.deck.cards()[k + 1];

        assert_eq!(
            state.advance_street(),
            Ok(Event::RiverDealt { card: river })
        );
        assert_eq!(state.street, Street::River);
        assert_eq!(state.board.len(), 5);
        assert_eq!(state.board[4], river);
        assert!(!state.board.contains(&burn));
        assert_eq!(state.next_card, k + 2);
    }

    #[test]
    fn board_positions() {
        let mut state = State::new(SEED, 0, &[100; 2], 5, 10);
        let h = state.next_card;
        let board = [
            state.deck.cards()[h + 1],
            state.deck.cards()[h + 2],
            state.deck.cards()[h + 3],
            state.deck.cards()[h + 5],
            state.deck.cards()[h + 7],
        ];

        finish_round(&mut state);
        state.advance_street().unwrap();
        finish_round(&mut state);
        state.advance_street().unwrap();
        finish_round(&mut state);
        state.advance_street().unwrap();

        assert_eq!(state.board.as_slice(), board.as_slice());
        assert_eq!(state.next_card, h + 8);
    }

    #[test]
    fn unique_runout() {
        for n in [2, 6] {
            let stacks = vec![100; n];
            let mut state = State::new(SEED, 0, &stacks, 5, 10);
            let h = state.next_card;
            let burns = [
                state.deck.cards()[h],
                state.deck.cards()[h + 4],
                state.deck.cards()[h + 6],
            ];

            finish_round(&mut state);
            state.advance_street().unwrap();
            finish_round(&mut state);
            state.advance_street().unwrap();
            finish_round(&mut state);
            state.advance_street().unwrap();

            let mut cards: Vec<_> = state.hole.iter().flatten().copied().collect();
            cards.extend(state.board.iter().copied());
            cards.extend(burns);

            assert_eq!(cards.len(), 2 * n + 8);

            for a in 0..cards.len() {
                for b in a + 1..cards.len() {
                    assert_ne!(cards[a], cards[b]);
                }
            }
        }
    }

    #[test]
    fn turn_reset() {
        let mut state = State::new(SEED, 0, &[100; 2], 5, 10);

        finish_round(&mut state);
        state.advance_street().unwrap();
        state.apply(1, Action::RaiseTo(20)).unwrap();
        state.apply(0, Action::Call).unwrap();

        let stacks: Vec<_> = state.players.iter().map(|player| player.stack).collect();
        let contributed: Vec<_> = state
            .players
            .iter()
            .map(|player| player.contributed)
            .collect();
        let folded: Vec<_> = state.players.iter().map(|player| player.folded).collect();
        let pot = state.pot;

        assert_eq!(state.min_raise, 20);
        assert!(state.players.iter().all(|player| player.bet == 20));
        assert!(
            state
                .players
                .iter()
                .all(|player| player.acted_bet.is_some())
        );
        state.advance_street().unwrap();

        assert_eq!(state.street, Street::Turn);
        assert!(state.players.iter().all(|player| player.bet == 0));
        assert!(
            state
                .players
                .iter()
                .all(|player| player.acted_bet.is_none())
        );
        assert_eq!(state.min_raise, state.big_blind);
        assert_eq!(
            state
                .players
                .iter()
                .map(|player| player.stack)
                .collect::<Vec<_>>(),
            stacks
        );
        assert_eq!(
            state
                .players
                .iter()
                .map(|player| player.contributed)
                .collect::<Vec<_>>(),
            contributed
        );
        assert_eq!(
            state
                .players
                .iter()
                .map(|player| player.folded)
                .collect::<Vec<_>>(),
            folded
        );
        assert_eq!(state.pot, pot);
    }

    #[test]
    fn river_reset() {
        let mut state = State::new(SEED, 0, &[100; 2], 5, 10);

        finish_round(&mut state);
        state.advance_street().unwrap();
        finish_round(&mut state);
        state.advance_street().unwrap();
        state.apply(1, Action::RaiseTo(20)).unwrap();
        state.apply(0, Action::Call).unwrap();

        let stacks: Vec<_> = state.players.iter().map(|player| player.stack).collect();
        let contributed: Vec<_> = state
            .players
            .iter()
            .map(|player| player.contributed)
            .collect();
        let folded: Vec<_> = state.players.iter().map(|player| player.folded).collect();
        let pot = state.pot;

        assert_eq!(state.min_raise, 20);
        assert!(state.players.iter().all(|player| player.bet == 20));
        assert!(
            state
                .players
                .iter()
                .all(|player| player.acted_bet.is_some())
        );
        state.advance_street().unwrap();

        assert_eq!(state.street, Street::River);
        assert!(state.players.iter().all(|player| player.bet == 0));
        assert!(
            state
                .players
                .iter()
                .all(|player| player.acted_bet.is_none())
        );
        assert_eq!(state.min_raise, state.big_blind);
        assert_eq!(
            state
                .players
                .iter()
                .map(|player| player.stack)
                .collect::<Vec<_>>(),
            stacks
        );
        assert_eq!(
            state
                .players
                .iter()
                .map(|player| player.contributed)
                .collect::<Vec<_>>(),
            contributed
        );
        assert_eq!(
            state
                .players
                .iter()
                .map(|player| player.folded)
                .collect::<Vec<_>>(),
            folded
        );
        assert_eq!(state.pot, pot);
    }

    #[test]
    fn street_contributions() {
        let mut state = State::new(SEED, 0, &[100; 2], 5, 10);

        state.apply(0, Action::RaiseTo(20)).unwrap();
        state.apply(1, Action::Call).unwrap();

        let before: Vec<_> = state
            .players
            .iter()
            .map(|player| player.contributed)
            .collect();
        let pot = state.pot;

        state.advance_street().unwrap();
        assert_eq!(
            state
                .players
                .iter()
                .map(|player| player.contributed)
                .collect::<Vec<_>>(),
            before
        );
        assert_eq!(state.pot, pot);
        assert_eq!(contributions(&state), u64::from(state.pot));

        state.apply(1, Action::RaiseTo(10)).unwrap();
        state.apply(0, Action::Call).unwrap();

        let before: Vec<_> = state
            .players
            .iter()
            .map(|player| player.contributed)
            .collect();
        let pot = state.pot;

        state.advance_street().unwrap();
        assert_eq!(
            state
                .players
                .iter()
                .map(|player| player.contributed)
                .collect::<Vec<_>>(),
            before
        );
        assert_eq!(state.pot, pot);
        assert_eq!(contributions(&state), u64::from(state.pot));

        state.apply(1, Action::RaiseTo(20)).unwrap();
        state.apply(0, Action::Call).unwrap();

        let before: Vec<_> = state
            .players
            .iter()
            .map(|player| player.contributed)
            .collect();
        let pot = state.pot;

        state.advance_street().unwrap();
        assert_eq!(
            state
                .players
                .iter()
                .map(|player| player.contributed)
                .collect::<Vec<_>>(),
            before
        );
        assert_eq!(state.pot, pot);
        assert_eq!(contributions(&state), u64::from(state.pot));
    }

    #[test]
    fn turn_betting() {
        let mut state = State::new(SEED, 0, &[100; 2], 5, 10);

        finish_round(&mut state);
        state.advance_street().unwrap();
        finish_round(&mut state);
        state.advance_street().unwrap();

        assert_eq!(state.turn, 1);
        assert_eq!(
            state.apply(1, Action::Check),
            Ok(vec![Event::Checked { player: 1 }])
        );
        assert_eq!(
            state.apply(0, Action::RaiseTo(10)),
            Ok(vec![Event::Raised { player: 0, to: 10 }])
        );
        assert_eq!(
            state.apply(1, Action::Call),
            Ok(vec![
                Event::Called {
                    player: 1,
                    amount: 10
                },
                Event::BettingRoundComplete
            ])
        );

        assert_eq!(state.street, Street::Turn);
        assert!(state.round_complete);
        assert_eq!(state.players[0].contributed, 20);
        assert_eq!(state.players[1].contributed, 20);
        assert_eq!(state.pot, 40);
        assert_eq!(contributions(&state), u64::from(state.pot));
    }

    #[test]
    fn river_betting() {
        let mut state = State::new(SEED, 0, &[100; 2], 5, 10);

        finish_round(&mut state);
        state.advance_street().unwrap();
        finish_round(&mut state);
        state.advance_street().unwrap();
        finish_round(&mut state);
        state.advance_street().unwrap();

        assert_eq!(state.turn, 1);
        assert_eq!(
            state.apply(1, Action::Check),
            Ok(vec![Event::Checked { player: 1 }])
        );
        assert_eq!(
            state.apply(0, Action::RaiseTo(10)),
            Ok(vec![Event::Raised { player: 0, to: 10 }])
        );
        assert_eq!(
            state.apply(1, Action::Call),
            Ok(vec![
                Event::Called {
                    player: 1,
                    amount: 10
                },
                Event::BettingRoundComplete
            ])
        );

        assert_eq!(state.street, Street::River);
        assert!(state.round_complete);
        assert_eq!(state.players[0].contributed, 20);
        assert_eq!(state.players[1].contributed, 20);
        assert_eq!(state.pot, 40);
        assert_eq!(contributions(&state), u64::from(state.pot));
    }

    #[test]
    fn postflop_actor() {
        let mut state = State::new(SEED, 0, &[100, 100, 10, 100], 5, 10);

        state.apply(3, Action::Call).unwrap();
        state.apply(0, Action::Call).unwrap();
        state.apply(1, Action::Fold).unwrap();

        state.advance_street().unwrap();
        assert_eq!(state.street, Street::Flop);
        assert_eq!(state.turn, 3);

        finish_round(&mut state);
        state.advance_street().unwrap();
        assert_eq!(state.street, Street::Turn);
        assert_eq!(state.turn, 3);

        finish_round(&mut state);
        state.advance_street().unwrap();
        assert_eq!(state.street, Street::River);
        assert_eq!(state.turn, 3);
        assert!(state.players[1].folded);
        assert_eq!(state.players[2].stack, 0);
    }

    #[test]
    fn all_in_runout() {
        let mut state = State::new(SEED, 0, &[10; 2], 5, 10);
        let h = state.next_card;
        let flop = [
            state.deck.cards()[h + 1],
            state.deck.cards()[h + 2],
            state.deck.cards()[h + 3],
        ];
        let turn = state.deck.cards()[h + 5];
        let river = state.deck.cards()[h + 7];

        finish_round(&mut state);
        assert!(state.players.iter().all(|player| player.stack == 0));

        assert_eq!(state.advance_street(), Ok(Event::FlopDealt { cards: flop }));
        assert!(state.round_complete);
        assert_eq!(state.advance_street(), Ok(Event::TurnDealt { card: turn }));
        assert!(state.round_complete);
        assert_eq!(
            state.advance_street(),
            Ok(Event::RiverDealt { card: river })
        );
        assert!(state.round_complete);
        assert_eq!(state.board.len(), 5);
        assert_eq!(state.fold_winner, None);
    }

    #[test]
    fn early_turn() {
        let mut state = State::new(SEED, 0, &[100; 2], 5, 10);
        let mut same = State::new(SEED, 0, &[100; 2], 5, 10);

        for state in [&mut state, &mut same] {
            finish_round(state);
            state.advance_street().unwrap();
        }

        assert_eq!(state.street, Street::Flop);
        assert!(!state.round_complete);
        assert_eq!(state.advance_street(), Err(AdvanceError::CannotAdvance));
        assert_eq!(state, same);
    }

    #[test]
    fn early_river() {
        let mut state = State::new(SEED, 0, &[100; 2], 5, 10);
        let mut same = State::new(SEED, 0, &[100; 2], 5, 10);

        for state in [&mut state, &mut same] {
            finish_round(state);
            state.advance_street().unwrap();
            finish_round(state);
            state.advance_street().unwrap();
        }

        assert_eq!(state.street, Street::Turn);
        assert!(!state.round_complete);
        assert_eq!(state.advance_street(), Err(AdvanceError::CannotAdvance));
        assert_eq!(state, same);
    }

    #[test]
    fn after_river() {
        let mut state = State::new(SEED, 0, &[100; 2], 5, 10);
        let mut same = State::new(SEED, 0, &[100; 2], 5, 10);

        for state in [&mut state, &mut same] {
            finish_round(state);
            state.advance_street().unwrap();
            finish_round(state);
            state.advance_street().unwrap();
            finish_round(state);
            state.advance_street().unwrap();
            finish_round(state);
        }

        assert_eq!(state.street, Street::River);
        assert!(state.round_complete);
        assert_eq!(state.advance_street(), Err(AdvanceError::CannotAdvance));
        assert_eq!(state, same);
    }

    #[test]
    fn showdown_win() {
        let mut state = showdown(
            0,
            &[10, 10],
            [
                (Two, Clubs),
                (Three, Diamonds),
                (Seven, Hearts),
                (Nine, Spades),
                (Jack, Clubs),
            ],
            &[
                [(Ace, Clubs), (Ace, Diamonds)],
                [(King, Clubs), (King, Diamonds)],
            ],
        );
        let total = stack_total(&state) + u64::from(state.pot);
        let loser = state.players[1].stack;

        assert_eq!(
            state.settle(),
            Ok(vec![Event::Awarded {
                player: 0,
                amount: 20
            }])
        );
        assert_eq!(state.players[0].stack, 110);
        assert_eq!(state.players[1].stack, loser);
        assert_eq!(state.pot, 0);
        assert!(state.settled);
        assert_eq!(stack_total(&state), total);

        let stacks: Vec<_> = state.players.iter().map(|player| player.stack).collect();

        assert_eq!(state.settle(), Err(SettlementError::AlreadySettled));
        assert_eq!(
            state
                .players
                .iter()
                .map(|player| player.stack)
                .collect::<Vec<_>>(),
            stacks
        );
    }

    #[test]
    fn board_tie() {
        let mut state = showdown(
            0,
            &[20, 20],
            [
                (Ten, Clubs),
                (Jack, Diamonds),
                (Queen, Hearts),
                (King, Spades),
                (Ace, Clubs),
            ],
            &[
                [(Two, Clubs), (Three, Clubs)],
                [(Two, Diamonds), (Three, Diamonds)],
            ],
        );
        let total = stack_total(&state) + u64::from(state.pot);

        assert_eq!(
            state.settle(),
            Ok(vec![
                Event::Awarded {
                    player: 0,
                    amount: 20
                },
                Event::Awarded {
                    player: 1,
                    amount: 20
                }
            ])
        );
        assert_eq!(
            state
                .players
                .iter()
                .map(|player| player.stack)
                .collect::<Vec<_>>(),
            vec![100, 100]
        );
        assert_eq!(state.pot, 0);
        assert!(state.settled);
        assert_eq!(stack_total(&state), total);
    }

    #[test]
    fn odd_chip() {
        let mut state = showdown(
            0,
            &[10, 10, 10, 1],
            [
                (Ten, Clubs),
                (Jack, Diamonds),
                (Queen, Hearts),
                (King, Spades),
                (Ace, Clubs),
            ],
            &[
                [(Two, Clubs), (Three, Clubs)],
                [(Four, Diamonds), (Five, Diamonds)],
                [(Six, Hearts), (Seven, Hearts)],
                [(Eight, Spades), (Nine, Spades)],
            ],
        );
        state.players[3].folded = true;
        let total = stack_total(&state) + u64::from(state.pot);

        assert_eq!(
            state.settle(),
            Ok(vec![
                Event::Awarded {
                    player: 0,
                    amount: 10
                },
                Event::Awarded {
                    player: 1,
                    amount: 11
                },
                Event::Awarded {
                    player: 2,
                    amount: 10
                }
            ])
        );
        assert_eq!(
            state
                .players
                .iter()
                .map(|player| player.stack)
                .collect::<Vec<_>>(),
            vec![100, 101, 100, 99]
        );
        assert_eq!(state.pot, 0);
        assert!(state.settled);
        assert_eq!(stack_total(&state), total);
    }

    #[test]
    fn side_pots() {
        let mut state = showdown(
            0,
            &[100, 60, 30],
            [
                (Two, Clubs),
                (Three, Diamonds),
                (Seven, Hearts),
                (Nine, Spades),
                (Jack, Clubs),
            ],
            &[
                [(Queen, Clubs), (Queen, Diamonds)],
                [(King, Clubs), (King, Diamonds)],
                [(Ace, Clubs), (Ace, Diamonds)],
            ],
        );
        let total = stack_total(&state) + u64::from(state.pot);

        assert_eq!(
            state.settle(),
            Ok(vec![
                Event::Awarded {
                    player: 0,
                    amount: 40
                },
                Event::Awarded {
                    player: 1,
                    amount: 60
                },
                Event::Awarded {
                    player: 2,
                    amount: 90
                }
            ])
        );
        assert_eq!(
            state
                .players
                .iter()
                .map(|player| player.stack)
                .collect::<Vec<_>>(),
            vec![40, 100, 160]
        );
        assert_eq!(
            state
                .players
                .iter()
                .map(|player| player.contributed)
                .collect::<Vec<_>>(),
            vec![100, 60, 30]
        );
        assert_eq!(state.pot, 0);
        assert!(state.settled);
        assert_eq!(stack_total(&state), total);
    }

    #[test]
    fn dead_money() {
        let mut state = showdown(
            0,
            &[100, 60, 30, 60],
            [
                (Two, Clubs),
                (Three, Diamonds),
                (Seven, Hearts),
                (Nine, Spades),
                (Jack, Clubs),
            ],
            &[
                [(Queen, Clubs), (Queen, Diamonds)],
                [(King, Clubs), (King, Diamonds)],
                [(Ace, Clubs), (Ace, Diamonds)],
                [(Ten, Clubs), (Ten, Diamonds)],
            ],
        );
        state.players[3].folded = true;
        let total = stack_total(&state) + u64::from(state.pot);
        let folded_stack = state.players[3].stack;

        assert_eq!(
            state.settle(),
            Ok(vec![
                Event::Awarded {
                    player: 0,
                    amount: 40
                },
                Event::Awarded {
                    player: 1,
                    amount: 90
                },
                Event::Awarded {
                    player: 2,
                    amount: 120
                }
            ])
        );
        assert_eq!(state.players[3].stack, folded_stack);
        assert_eq!(
            state
                .players
                .iter()
                .map(|player| player.stack)
                .collect::<Vec<_>>(),
            vec![40, 130, 190, 40]
        );
        assert_eq!(state.pot, 0);
        assert!(state.settled);
        assert_eq!(stack_total(&state), total);
    }

    #[test]
    fn many_side_pots() {
        let mut state = showdown(
            0,
            &[100, 80, 50, 20, 20],
            [
                (Two, Clubs),
                (Three, Diamonds),
                (Four, Hearts),
                (Seven, Spades),
                (Nine, Clubs),
            ],
            &[
                [(Jack, Clubs), (Jack, Diamonds)],
                [(Queen, Clubs), (Queen, Diamonds)],
                [(King, Clubs), (King, Diamonds)],
                [(Ten, Clubs), (Ten, Diamonds)],
                [(Ace, Hearts), (Ace, Spades)],
            ],
        );
        let total = stack_total(&state) + u64::from(state.pot);

        assert_eq!(
            state.settle(),
            Ok(vec![
                Event::Awarded {
                    player: 0,
                    amount: 20
                },
                Event::Awarded {
                    player: 1,
                    amount: 60
                },
                Event::Awarded {
                    player: 2,
                    amount: 90
                },
                Event::Awarded {
                    player: 4,
                    amount: 100
                }
            ])
        );
        assert_eq!(
            state
                .players
                .iter()
                .map(|player| player.stack)
                .collect::<Vec<_>>(),
            vec![20, 80, 140, 80, 180]
        );
        assert_eq!(state.pot, 0);
        assert!(state.settled);
        assert_eq!(stack_total(&state), total);
    }

    #[test]
    fn fold_payout() {
        let mut state = State::new(SEED, 0, &[100; 3], 5, 10);
        let total = stack_total(&state) + u64::from(state.pot);

        state.apply(0, Action::Fold).unwrap();
        state.apply(1, Action::Fold).unwrap();

        assert_eq!(state.fold_winner, Some(2));
        assert_eq!(
            state.settle(),
            Ok(vec![Event::Awarded {
                player: 2,
                amount: 15
            }])
        );
        assert_eq!(state.players[2].stack, 105);
        assert_eq!(state.pot, 0);
        assert!(state.settled);
        assert_eq!(stack_total(&state), total);

        let stacks: Vec<_> = state.players.iter().map(|player| player.stack).collect();

        assert_eq!(state.settle(), Err(SettlementError::AlreadySettled));
        assert_eq!(
            state
                .players
                .iter()
                .map(|player| player.stack)
                .collect::<Vec<_>>(),
            stacks
        );
    }

    #[test]
    fn settle_early() {
        let mut state = State::new(SEED, 0, &[100; 2], 5, 10);
        let mut same = State::new(SEED, 0, &[100; 2], 5, 10);

        assert_eq!(state.settle(), Err(SettlementError::NotReady));
        assert_eq!(state, same);

        finish_round(&mut state);
        finish_round(&mut same);
        assert_eq!(state.settle(), Err(SettlementError::NotReady));
        assert_eq!(state, same);

        for street in [Street::Flop, Street::Turn, Street::River] {
            state.advance_street().unwrap();
            same.advance_street().unwrap();

            assert_eq!(state.street, street);
            assert!(!state.round_complete);
            assert_eq!(state.settle(), Err(SettlementError::NotReady));
            assert_eq!(state, same);

            if street != Street::River {
                finish_round(&mut state);
                finish_round(&mut same);
            }
        }
    }

    #[test]
    fn two_lifecycle() {
        let mut state = State::new(SEED, 0, &[100; 2], 5, 10);
        let total = 200;

        assert_active(&state, total);
        finish_round(&mut state);
        assert_active(&state, total);

        state.advance_street().unwrap();
        assert_eq!(state.street, Street::Flop);
        assert_eq!(state.board.len(), 3);
        unique_cards(&state);
        finish_round(&mut state);
        assert_active(&state, total);

        state.advance_street().unwrap();
        assert_eq!(state.street, Street::Turn);
        assert_eq!(state.board.len(), 4);
        unique_cards(&state);
        finish_round(&mut state);
        assert_active(&state, total);

        state.advance_street().unwrap();
        assert_eq!(state.street, Street::River);
        assert_eq!(state.board.len(), 5);
        unique_cards(&state);
        finish_round(&mut state);
        assert_active(&state, total);

        state.settle().unwrap();
        assert_settled(&state, total);

        let stacks: Vec<_> = state.players.iter().map(|player| player.stack).collect();
        let hole = state.hole.clone();
        let board = state.board.clone();
        let next = state.next_hand(NEXT_SEED).unwrap();

        assert_eq!(state.hole, hole);
        assert_eq!(state.board, board);
        assert!(state.settled);

        assert_eq!(next.dealer, 1);
        assert_eq!(next.street, Street::Preflop);
        assert!(next.board.is_empty());
        assert_eq!(next.next_card, 4);
        assert_eq!(next.small_blind, 5);
        assert_eq!(next.big_blind, 10);
        assert_eq!(next.min_raise, 10);
        assert_eq!(next.pot, 15);
        assert_eq!(next.turn, 1);
        assert_eq!(next.fold_winner, None);
        assert!(!next.settled);
        assert!(next.players.iter().all(|player| !player.folded));
        assert!(next.players.iter().all(|player| player.acted_bet.is_none()));
        assert_eq!(next.players[0].stack, stacks[0] - 10);
        assert_eq!(next.players[0].bet, 10);
        assert_eq!(next.players[0].contributed, 10);
        assert_eq!(next.players[1].stack, stacks[1] - 5);
        assert_eq!(next.players[1].bet, 5);
        assert_eq!(next.players[1].contributed, 5);
        assert_ne!(next.hole, state.hole);
        unique_cards(&next);
        assert_active(&next, total);
    }

    #[test]
    fn six_hand() {
        let mut state = State::new(SEED, 0, &[100; 6], 5, 10);
        let total = 600;

        state.apply(3, Action::RaiseTo(20)).unwrap();
        state.apply(4, Action::Call).unwrap();
        state.apply(5, Action::Fold).unwrap();
        state.apply(0, Action::Call).unwrap();
        state.apply(1, Action::Call).unwrap();
        state.apply(2, Action::Call).unwrap();
        assert_active(&state, total);

        state.advance_street().unwrap();
        state.apply(1, Action::Check).unwrap();
        state.apply(2, Action::Check).unwrap();
        state.apply(3, Action::RaiseTo(20)).unwrap();
        state.apply(4, Action::Call).unwrap();
        state.apply(0, Action::Call).unwrap();
        state.apply(1, Action::Call).unwrap();
        state.apply(2, Action::Fold).unwrap();
        assert_active(&state, total);

        state.advance_street().unwrap();
        state.apply(1, Action::RaiseTo(60)).unwrap();
        state.apply(3, Action::Call).unwrap();
        state.apply(4, Action::Call).unwrap();
        state.apply(0, Action::Call).unwrap();

        assert!(state.round_complete);
        assert_eq!(
            state
                .players
                .iter()
                .filter(|player| player.stack == 0)
                .count(),
            4
        );
        assert_active(&state, total);

        state.advance_street().unwrap();
        assert_eq!(state.street, Street::River);
        assert_eq!(state.board.len(), 5);
        assert!(state.round_complete);
        assert!(state.players[2].folded);
        assert!(state.players[5].folded);
        unique_cards(&state);
        assert_active(&state, total);

        state.settle().unwrap();
        assert_settled(&state, total);
    }

    #[test]
    fn lifecycle_sweep() {
        for seed in [SEED, NEXT_SEED] {
            for n in 2..=6 {
                let stacks = vec![100; n];
                let total = 100 * n as u64;

                for dealer in 0..n {
                    let mut state = State::new(seed, dealer, &stacks, 5, 10);

                    assert_eq!(state.street, Street::Preflop);
                    assert!(state.board.is_empty());
                    unique_cards(&state);
                    assert_active(&state, total);

                    finish_round(&mut state);
                    assert!(state.round_complete);
                    assert_active(&state, total);

                    for (street, len) in [(Street::Flop, 3), (Street::Turn, 4), (Street::River, 5)]
                    {
                        state.advance_street().unwrap();

                        assert_eq!(state.street, street);
                        assert_eq!(state.board.len(), len);
                        unique_cards(&state);
                        assert_active(&state, total);

                        finish_round(&mut state);
                        assert!(state.round_complete);
                        assert_active(&state, total);
                    }

                    state.settle().unwrap();
                    assert_settled(&state, total);
                }
            }
        }
    }

    #[test]
    fn next_same() {
        let mut a = State::new(SEED, 2, &[100; 6], 5, 10);
        let mut b = State::new(SEED, 2, &[100; 6], 5, 10);

        finish_hand(&mut a);
        finish_hand(&mut b);

        assert_eq!(a, b);
        assert_eq!(a.next_hand(NEXT_SEED), b.next_hand(NEXT_SEED));
        assert_eq!(a, b);
    }

    #[test]
    fn next_early() {
        let state = State::new(SEED, 0, &[100; 2], 5, 10);
        let same = State::new(SEED, 0, &[100; 2], 5, 10);

        assert_eq!(state.next_hand(NEXT_SEED), Err(NextHandError::NotSettled));
        assert_eq!(state, same);
    }

    #[test]
    fn next_short() {
        let mut state = State::new(SEED, 0, &[10; 2], 5, 10);

        state.apply(0, Action::Fold).unwrap();
        state.settle().unwrap();

        assert_eq!(state.players[0].stack, 5);
        assert_eq!(state.next_hand(NEXT_SEED), Err(NextHandError::CannotStart));
        assert_eq!(state.players[0].stack, 5);
        assert!(state.settled);
    }

    #[test]
    fn dealer_rotation() {
        for n in 2..=6 {
            for dealer in 0..n {
                let state = fold_hand(n, dealer);
                let stacks: Vec<_> = state.players.iter().map(|player| player.stack).collect();
                let next = state.next_hand(NEXT_SEED).unwrap();
                let next_dealer = (dealer + 1) % n;
                let sb = if n == 2 {
                    next_dealer
                } else {
                    (next_dealer + 1) % n
                };
                let bb = (sb + 1) % n;
                let turn = if n == 2 { next_dealer } else { (bb + 1) % n };

                assert_eq!(next.dealer, next_dealer);
                assert_eq!(next.turn, turn);

                for (i, player) in next.players.iter().enumerate() {
                    let blind = if i == sb {
                        next.small_blind
                    } else if i == bb {
                        next.big_blind
                    } else {
                        0
                    };

                    assert_eq!(player.stack, stacks[i] - blind);
                    assert_eq!(player.bet, blind);
                    assert_eq!(player.contributed, blind);
                }

                let first = (next_dealer + 1) % n;

                for round in 0..2 {
                    for offset in 0..n {
                        let player = (first + offset) % n;
                        assert_eq!(
                            next.hole[player][round],
                            next.deck.cards()[round * n + offset]
                        );
                    }
                }
            }
        }
    }
}
