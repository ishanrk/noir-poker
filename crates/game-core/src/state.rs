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
    pub players: Vec<Player>,
    pub hole: Vec<[Card; 2]>,
    pub pot: u32,
    pub dealer: usize,
    pub turn: usize,
    pub next_card: usize,
}

impl State {
    // MAJOR ISSUE EMBEDDED SHADOW TOKENS INTO THIS AS FAKE MONEY
    pub fn new(seed: [u8; 32], dealer: usize, stacks: &[u32], sb: u32, bb: u32) -> Self {
        let n = stacks.len();

        assert!((2..=6).contains(&n));
        assert!(dealer < n);
        assert!(sb > 0);
        assert!(bb >= sb);
        assert!(stacks.iter().all(|&stack| stack >= bb));

        // heads up dealer posts small blind
        // three plus starts blinds left of dealer
        let sb_pos = if n == 2 { dealer } else { (dealer + 1) % n };
        let bb_pos = (sb_pos + 1) % n;
        let turn = if n == 2 { dealer } else { (bb_pos + 1) % n };
        let deck = Deck::from_seed(seed);
        let cards = deck.cards();
        let mut players: Vec<_> = stacks
            .iter()
            .map(|&stack| Player { stack, bet: 0 })
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
    fn player_bounds() {
        let two = State::new(SEED, 0, &[1000; 2], 5, 10);
        let six = State::new(SEED, 0, &[1000; 6], 5, 10);

        assert_eq!(two.players.len(), 2);
        assert_eq!(two.hole.len(), 2);
        assert_eq!(six.players.len(), 6);
        assert_eq!(six.hole.len(), 6);
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
    fn heads_up_one() {
        let state = State::new(SEED, 1, &[1000; 2], 5, 10);

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
    fn three_positions() {
        let state = State::new(SEED, 0, &[1000; 3], 5, 10);

        assert_eq!(
            state.players[0],
            Player {
                stack: 1000,
                bet: 0
            }
        );
        assert_eq!(state.players[1], Player { stack: 995, bet: 5 });
        assert_eq!(
            state.players[2],
            Player {
                stack: 990,
                bet: 10
            }
        );
        assert_eq!(state.turn, 0);
    }

    #[test]
    fn six_positions() {
        let state = State::new(SEED, 2, &[1000; 6], 5, 10);

        assert_eq!(state.players[3], Player { stack: 995, bet: 5 });
        assert_eq!(
            state.players[4],
            Player {
                stack: 990,
                bet: 10
            }
        );
        assert_eq!(state.turn, 5);
    }

    #[test]
    fn position_wrap() {
        let state = State::new(SEED, 5, &[1000; 6], 5, 10);

        assert_eq!(state.players[0], Player { stack: 995, bet: 5 });
        assert_eq!(
            state.players[1],
            Player {
                stack: 990,
                bet: 10
            }
        );
        assert_eq!(state.turn, 2);
    }

    #[test]
    fn non_blinds() {
        let state = State::new(SEED, 2, &[1000; 6], 5, 10);

        for i in [0, 1, 2, 5] {
            assert_eq!(
                state.players[i],
                Player {
                    stack: 1000,
                    bet: 0
                }
            );
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

        assert_eq!(
            State::new(SEED, 2, &stacks, 5, 10),
            State::new(SEED, 2, &stacks, 5, 10)
        );
    }

    #[test]
    fn unequal_stacks() {
        let stacks = [1000, 1200, 900, 1500, 800, 1100];
        let state = State::new(SEED, 2, &stacks, 5, 10);

        assert_eq!(
            state.players,
            vec![
                Player {
                    stack: 1000,
                    bet: 0
                },
                Player {
                    stack: 1200,
                    bet: 0
                },
                Player { stack: 900, bet: 0 },
                Player {
                    stack: 1495,
                    bet: 5
                },
                Player {
                    stack: 790,
                    bet: 10
                },
                Player {
                    stack: 1100,
                    bet: 0
                }
            ]
        );
    }

    #[test]
    fn chip_total() {
        let stacks = [1000, 1200, 900, 1500, 800, 1100];
        let state = State::new(SEED, 2, &stacks, 5, 10);
        let before: u64 = stacks.iter().map(|&stack| u64::from(stack)).sum();
        let after: u64 = state
            .players
            .iter()
            .map(|player| u64::from(player.stack))
            .sum();

        assert_eq!(before, after + u64::from(state.pot));
    }
}
