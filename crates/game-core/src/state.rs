use crate::{Card, Deck};

// added action and event enums for game state updates
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Action {
    Fold,
    Check,
    Call,
    RaiseTo(u32),
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
    BettingRoundComplete,
    WonByFold { player: usize },
}

// tehcnically unnecessary considering the UI should only allow for legal actions
// however its useufl for testing
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
    pub big_blind: u32,
    pub dealer: usize,
    pub turn: usize,
    pub next_card: usize,
    pub street: Street,
    pub round_complete: bool,
    pub winner: Option<usize>,
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
            big_blind: bb,
            dealer,
            turn,
            next_card: 2 * n,
            street: Street::Preflop,
            round_complete: false,
            winner: None,
        };

        state.round_complete = state.round_done();
        state
    }

    pub fn apply(&mut self, player: usize, action: Action) -> Result<Vec<Event>, ActionError> {
        if player >= self.players.len() {
            return Err(ActionError::InvalidPlayer);
        }

        if self.winner.is_some() {
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

            self.winner = Some(winner);
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
        if self.winner.is_some() {
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
        let player = &self.players[player];
        let Some(max_bet) = player.bet.checked_add(player.stack) else {
            return false;
        };

        if to <= current_bet || to > max_bet {
            return false;
        }

        // raising reopens after a full raise since the last response
        if let Some(acted_bet) = player.acted_bet
            && current_bet - acted_bet < self.min_raise
        {
            return false;
        }

        let raise_size = to - current_bet;
        raise_size >= self.min_raise || to == max_bet
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

    // fixed seed keeps deck order repeatable
    // repeated 0x42 fills required seed size
    const SEED: [u8; 32] = [0x42; 32];

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
        assert_eq!(two.big_blind, 10);
        assert!(!two.round_complete);
        assert_eq!(two.winner, None);
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
        assert_eq!(state.winner, None);

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
        assert_eq!(state.winner, None);
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
        assert_eq!(state.winner, Some(2));
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
        assert_eq!(state.winner, None);
        assert_eq!(state.pot, 40);
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
    fn advance_winner() {
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
        assert_eq!(state.winner, None);
        state.advance_street().unwrap();
        assert_eq!(state.street, Street::Flop);
        assert_eq!(state.board.len(), 3);
        assert!(state.round_complete);
        assert_eq!(state.winner, None);

        state.advance_street().unwrap();
        assert_eq!(state.street, Street::Turn);
        assert_eq!(state.board.len(), 4);
        assert!(state.round_complete);
        assert_eq!(state.winner, None);

        state.advance_street().unwrap();
        assert_eq!(state.street, Street::River);
        assert_eq!(state.board.len(), 5);
        assert!(state.round_complete);
        assert_eq!(state.winner, None);

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
        assert_eq!(state.winner, None);
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
}
