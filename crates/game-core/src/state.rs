use crate::{Card, Deck};


// add new enums for actions, event based on raising folding etc
// 
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Action {
    Fold,
    Check,
    Call,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Event {
    Folded { player: usize },
    Checked { player: usize },
    Called { player: usize, amount: u32 },
    BettingRoundComplete,
    WonByFold { player: usize },
}


// THE PLAYER SHOULD ONLY BE ABLE TO ACT ON LEGAL ACTIONS THRU UI
// THIS IS JUST A SAFETY MEASURE TO ENSURE ILLEGAL ACTIONS THROW ERRORS
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ActionError {
    InvalidPlayer,
    NotTurn,
    RoundComplete,
    HandComplete,
    CannotCheck,
    CannotCall,
}


#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Player {
    pub stack: u32,
    pub bet: u32,
    pub folded: bool,
    pub acted: bool,
}

#[derive(Debug, Eq, PartialEq)]
pub struct State {
    // same shuffled deck continues after hole cards
    deck: Deck,

    // now vector of players added support for more than 2
    pub players: Vec<Player>,
    pub hole: Vec<[Card; 2]>,
    pub pot: u32,
    pub dealer: usize,
    pub turn: usize,
    pub next_card: usize,
    pub round_complete: bool,
    pub winner: Option<usize>,
}

impl State {
    // MAJOR ISSUE EMBEDDED SHADOW TOKENS INTO THIS AS FAKE MONEY
    // STACKS AND BETS need to be in shadow token
    // also designing the chip bounty system
    pub fn new(seed: [u8; 32], dealer: usize, stacks: &[u32], sb: u32, bb: u32) -> Self {
        let n = stacks.len();

        assert!((2..=6).contains(&n));
        assert!(dealer < n);
        assert!(sb > 0);
        assert!(bb >= sb);
        assert!(stacks.iter().all(|&stack| stack >= bb));

        // heads up dealer bets small blind
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
                folded: false,
                acted: false,
            })
            .collect();
        let mut hole = vec![[cards[0]; 2]; n];

        players[sb_pos].stack -= sb;
        players[sb_pos].bet = sb;
        players[bb_pos].stack -= bb;
        players[bb_pos].bet = bb;

        // deal clockwise from left of dealer for two rounds
        let first = (dealer + 1) % n;

        for round in 0..2 {
            for offset in 0..n {
                let player = (first + offset) % n;
                hole[player][round] = cards[round * n + offset];
            }
        }

        Self {
            deck,
            players,
            hole,
            pot: sb + bb,
            dealer,
            turn,
            next_card: 2 * n,
            round_complete: false,
            winner: None,
        }
    }

    // update game state based off of action
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
            _ => {}
        }

        let mut events = Vec::with_capacity(2);

        match action {
            Action::Fold => {
                self.players[player].folded = true;
                self.players[player].acted = true;
                events.push(Event::Folded { player });
            }
            Action::Check => {
                self.players[player].acted = true;
                events.push(Event::Checked { player });
            }
            Action::Call => {
                let amount = current_bet - self.players[player].bet;

                self.players[player].stack -= amount;
                self.players[player].bet += amount;
                self.players[player].acted = true;
                self.pot += amount;
                events.push(Event::Called { player, amount });
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

        if self.round_done(current_bet) {
            self.round_complete = true;
            events.push(Event::BettingRoundComplete);
            return Ok(events);
        }

        self.advance_turn(player);
        Ok(events)
    }

    fn current_bet(&self) -> u32 {
        self.players.iter().map(|player| player.bet).max().unwrap()
    }

    fn round_done(&self, current_bet: u32) -> bool {
        self.players
            .iter()
            .filter(|player| !player.folded)
            .all(|player| player.acted && player.bet == current_bet)
    }

    fn advance_turn(&mut self, player: usize) {
        for offset in 1..=self.players.len() {
            let next = (player + offset) % self.players.len();

            if !self.players[next].folded && !self.players[next].acted {
                self.turn = next;
                return;
            }
        }
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
            folded: false,
            acted: false,
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
        let stacks = [1000, 1200, 900, 1500, 800, 1100];
        let mut state = State::new(SEED, 2, &stacks, 5, 10);
        let before: u64 = stacks.iter().map(|&stack| u64::from(stack)).sum();

        state.apply(5, Action::Call).unwrap();
        state.apply(0, Action::Call).unwrap();

        let after: u64 = state
            .players
            .iter()
            .map(|player| u64::from(player.stack))
            .sum();

        assert_eq!(before, after + u64::from(state.pot));
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
        assert!(state.players[0].acted);
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
        assert!(state.players[1].acted);
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
        assert!(state.players[0].acted);
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
        assert!(!state.players[2].acted);

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
}
