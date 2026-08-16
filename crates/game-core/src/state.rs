use crate::{Card, Deck};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Player {
    pub stack: u32,
    pub bet: u32,
}

#[derive(Debug, Eq, PartialEq)]
pub struct State {
    // same shuffled deck continues after hole cards
    deck: Deck,
    pub players: [Player; 2],
    pub hole: [[Card; 2]; 2],
    pub pot: u32,
    pub dealer: usize,
    pub turn: usize,
    pub next_card: usize,
}

impl State {
    // heads up dealer posts small blind and acts first preflop
    // deal one card each starting with dealer then repeat
    pub fn new(seed: [u8; 32], dealer: usize, stack: u32, sb: u32, bb: u32) -> Self {
        assert!(dealer < 2);
        assert!(sb > 0);
        assert!(bb >= sb);
        assert!(stack >= bb);

        let other = 1 - dealer;
        let deck = Deck::from_seed(seed);
        let cards = deck.cards();
        let mut players = [Player { stack, bet: 0 }; 2];
        let mut hole = [[cards[0]; 2]; 2];

        players[dealer].stack -= sb;
        players[dealer].bet = sb;
        players[other].stack -= bb;
        players[other].bet = bb;

        hole[dealer] = [cards[0], cards[2]];
        hole[other] = [cards[1], cards[3]];

        Self {
            deck,
            players,
            hole,
            pot: sb + bb,
            dealer,
            turn: dealer,
            next_card: 4,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // fixed seed keeps deck order repeatable
    // repeated 0x42 fills required seed size
    const SEED: [u8; 32] = [0x42; 32];

    #[test]
    fn dealer_zero() {
        let state = State::new(SEED, 0, 1000, 5, 10);

        assert_eq!(state.players[0], Player { stack: 995, bet: 5 });
        assert_eq!(
            state.players[1],
            Player {
                stack: 990,
                bet: 10
            }
        );
        assert_eq!(state.pot, 15);
        assert_eq!(state.dealer, 0);
        assert_eq!(state.turn, 0);
    }

    #[test]
    fn dealer_one() {
        let state = State::new(SEED, 1, 1000, 5, 10);

        assert_eq!(
            state.players[0],
            Player {
                stack: 990,
                bet: 10
            }
        );
        assert_eq!(state.players[1], Player { stack: 995, bet: 5 });
        assert_eq!(state.pot, 15);
        assert_eq!(state.dealer, 1);
        assert_eq!(state.turn, 1);
    }

    #[test]
    fn deal_order() {
        let deck = Deck::from_seed(SEED);
        let state = State::new(SEED, 1, 1000, 5, 10);

        assert_eq!(state.hole[1][0], deck.cards()[0]);
        assert_eq!(state.hole[0][0], deck.cards()[1]);
        assert_eq!(state.hole[1][1], deck.cards()[2]);
        assert_eq!(state.hole[0][1], deck.cards()[3]);
        assert_eq!(state.next_card, 4);
    }

    #[test]
    fn unique_hole() {
        let state = State::new(SEED, 0, 1000, 5, 10);
        let cards = [
            state.hole[0][0],
            state.hole[0][1],
            state.hole[1][0],
            state.hole[1][1],
        ];

        for a in 0..cards.len() {
            for b in a + 1..cards.len() {
                assert_ne!(cards[a], cards[b]);
            }
        }
    }

    #[test]
    fn same_state() {
        assert_eq!(
            State::new(SEED, 0, 1000, 5, 10),
            State::new(SEED, 0, 1000, 5, 10)
        );
    }

    #[test]
    fn chip_total() {
        let state = State::new(SEED, 0, 1000, 5, 10);
        let total = state.players[0].stack + state.players[1].stack + state.pot;

        assert_eq!(total, 2000);
    }

    #[test]
    fn deck_position() {
        let state = State::new(SEED, 0, 1000, 5, 10);
        let next = state.deck.cards()[state.next_card];

        assert_eq!(state.next_card, 4);
        assert!(state.hole.iter().flatten().all(|&card| card != next));
    }
}
