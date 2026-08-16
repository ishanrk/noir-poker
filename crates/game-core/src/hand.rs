use crate::card::{Card, Rank};

// enum order = weak to strong
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
#[repr(u8)]
pub enum HandKind {
    HighCard,
    Pair,
    TwoPair,
    ThreeKind,
    Straight,
    Flush,
    FullHouse,
    FourKind,
    StraightFlush,
}

// pair aces king queen eight = kind Pair tie Ace King Queen Eight
// compare kind first then tie left to right
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct HandVal {
    kind: HandKind,
    // compare ranks left to right when kinds match
    tie: [Rank; 5],
}

impl HandVal {
    pub const fn kind(self) -> HandKind {
        self.kind
    }
}

// count each rank to find pairs three kind full house and four kind
// check every suit against the first card to find a flush
// check five ranks in a row with ace low as five high
// scan ranks ace to two to store groups and kickers high first
// return category and tie ranks ready for hand comparison
pub fn eval5(cards: [Card; 5]) -> HandVal {
    let mut cnt = [0u8; 13];

    for card in &cards {
        cnt[card.rank() as usize] += 1;
    }

    let flush = cards[1..].iter().all(|card| card.suit() == cards[0].suit());
    let straight = straight_high(&cnt);
    let mut high = [Rank::Two; 5];
    let mut pairs = [Rank::Two; 2];
    let mut single = [Rank::Two; 5];
    let mut high_len = 0;
    let mut pair_len = 0;
    let mut single_len = 0;
    let mut three = None;
    let mut four = None;

    for rank in Rank::ALL.into_iter().rev() {
        let n = cnt[rank as usize];

        for _ in 0..n {
            high[high_len] = rank;
            high_len += 1;
        }

        match n {
            4 => four = Some(rank),
            3 => three = Some(rank),
            2 => {
                pairs[pair_len] = rank;
                pair_len += 1;
            }
            1 => {
                single[single_len] = rank;
                single_len += 1;
            }
            _ => {}
        }
    }

    if let Some(rank) = straight
        && flush
    {
        return hand_val(HandKind::StraightFlush, &[rank]);
    }

    if let Some(rank) = four {
        return hand_val(HandKind::FourKind, &[rank, single[0]]);
    }

    if let Some(rank) = three
        && pair_len == 1
    {
        return hand_val(HandKind::FullHouse, &[rank, pairs[0]]);
    }

    if flush {
        return hand_val(HandKind::Flush, &high);
    }

    if let Some(rank) = straight {
        return hand_val(HandKind::Straight, &[rank]);
    }

    if let Some(rank) = three {
        return hand_val(HandKind::ThreeKind, &[rank, single[0], single[1]]);
    }

    if pair_len == 2 {
        return hand_val(HandKind::TwoPair, &[pairs[0], pairs[1], single[0]]);
    }

    if pair_len == 1 {
        return hand_val(HandKind::Pair, &[pairs[0], single[0], single[1], single[2]]);
    }

    hand_val(HandKind::HighCard, &high)
}

// check every way to remove two cards from seven
// eval5 ranks each remaining five card hand
// keep strongest value from all twenty one hands
pub fn eval7(cards: [Card; 7]) -> HandVal {
    let mut best = eval5([cards[0], cards[1], cards[2], cards[3], cards[4]]);

    for a in 0..6 {
        for b in a + 1..7 {
            // first hand already removes final two cards
            if a == 5 && b == 6 {
                continue;
            }

            let mut hand = [cards[0]; 5];
            let mut n = 0;

            for (i, card) in cards.iter().enumerate() {
                if i != a && i != b {
                    hand[n] = *card;
                    n += 1;
                }
            }

            let value = eval5(hand);

            if value > best {
                best = value;
            }
        }
    }

    best
}

fn straight_high(cnt: &[u8; 13]) -> Option<Rank> {
    for high in (4..Rank::ALL.len()).rev() {
        if cnt[high - 4..=high].iter().all(|&n| n == 1) {
            return Some(Rank::ALL[high]);
        }
    }

    // wheel = ace low five high
    if cnt[Rank::Ace as usize] == 1 && cnt[..4].iter().all(|&n| n == 1) {
        return Some(Rank::Five);
    }

    None
}

fn hand_val(kind: HandKind, ranks: &[Rank]) -> HandVal {
    let mut tie = [Rank::Two; 5];
    tie[..ranks.len()].copy_from_slice(ranks);

    HandVal { kind, tie }
}

// private evaluator checks built only for cargo test
#[cfg(test)]
mod tests {
    use super::{HandKind, eval5, eval7};
    use crate::Rank::*;
    use crate::Suit::*;
    use crate::{Card, Rank, Suit};

    fn hand(cards: [(Rank, Suit); 5]) -> [Card; 5] {
        cards.map(|(rank, suit)| Card::new(rank, suit))
    }

    fn hand7(cards: [(Rank, Suit); 7]) -> [Card; 7] {
        cards.map(|(rank, suit)| Card::new(rank, suit))
    }

    #[test]
    fn high_card() {
        let value = eval5(hand([
            (Ace, Clubs),
            (King, Diamonds),
            (Nine, Hearts),
            (Five, Spades),
            (Two, Clubs),
        ]));

        assert_eq!(value.kind(), HandKind::HighCard);
    }

    #[test]
    fn one_pair() {
        let value = eval5(hand([
            (Ace, Clubs),
            (Ace, Diamonds),
            (King, Hearts),
            (Queen, Spades),
            (Eight, Clubs),
        ]));

        assert_eq!(value.kind(), HandKind::Pair);
    }

    #[test]
    fn two_pair() {
        let value = eval5(hand([
            (Ace, Clubs),
            (Ace, Diamonds),
            (King, Hearts),
            (King, Spades),
            (Queen, Clubs),
        ]));

        assert_eq!(value.kind(), HandKind::TwoPair);
    }

    #[test]
    fn three_kind() {
        let value = eval5(hand([
            (Ace, Clubs),
            (Ace, Diamonds),
            (Ace, Hearts),
            (King, Spades),
            (Queen, Clubs),
        ]));

        assert_eq!(value.kind(), HandKind::ThreeKind);
    }

    #[test]
    fn straight() {
        let value = eval5(hand([
            (Ten, Clubs),
            (Jack, Diamonds),
            (Queen, Hearts),
            (King, Spades),
            (Ace, Clubs),
        ]));

        assert_eq!(value.kind(), HandKind::Straight);
    }

    #[test]
    fn flush() {
        let value = eval5(hand([
            (Ace, Hearts),
            (Jack, Hearts),
            (Eight, Hearts),
            (Five, Hearts),
            (Two, Hearts),
        ]));

        assert_eq!(value.kind(), HandKind::Flush);
    }

    #[test]
    fn full_house() {
        let value = eval5(hand([
            (Ace, Clubs),
            (Ace, Diamonds),
            (Ace, Hearts),
            (King, Clubs),
            (King, Diamonds),
        ]));

        assert_eq!(value.kind(), HandKind::FullHouse);
    }

    #[test]
    fn four_kind() {
        let value = eval5(hand([
            (Ace, Clubs),
            (Ace, Diamonds),
            (Ace, Hearts),
            (Ace, Spades),
            (King, Clubs),
        ]));

        assert_eq!(value.kind(), HandKind::FourKind);
    }

    #[test]
    fn straight_flush() {
        let value = eval5(hand([
            (Ten, Spades),
            (Jack, Spades),
            (Queen, Spades),
            (King, Spades),
            (Ace, Spades),
        ]));

        assert_eq!(value.kind(), HandKind::StraightFlush);
    }

    #[test]
    fn kind_order() {
        let values = [
            eval5(hand([
                (Ace, Clubs),
                (King, Diamonds),
                (Nine, Hearts),
                (Five, Spades),
                (Two, Clubs),
            ])),
            eval5(hand([
                (Ace, Clubs),
                (Ace, Diamonds),
                (King, Hearts),
                (Queen, Spades),
                (Eight, Clubs),
            ])),
            eval5(hand([
                (Ace, Clubs),
                (Ace, Diamonds),
                (King, Hearts),
                (King, Spades),
                (Queen, Clubs),
            ])),
            eval5(hand([
                (Ace, Clubs),
                (Ace, Diamonds),
                (Ace, Hearts),
                (King, Spades),
                (Queen, Clubs),
            ])),
            eval5(hand([
                (Ten, Clubs),
                (Jack, Diamonds),
                (Queen, Hearts),
                (King, Spades),
                (Ace, Clubs),
            ])),
            eval5(hand([
                (Ace, Hearts),
                (Jack, Hearts),
                (Eight, Hearts),
                (Five, Hearts),
                (Two, Hearts),
            ])),
            eval5(hand([
                (Ace, Clubs),
                (Ace, Diamonds),
                (Ace, Hearts),
                (King, Clubs),
                (King, Diamonds),
            ])),
            eval5(hand([
                (Ace, Clubs),
                (Ace, Diamonds),
                (Ace, Hearts),
                (Ace, Spades),
                (King, Clubs),
            ])),
            eval5(hand([
                (Ten, Spades),
                (Jack, Spades),
                (Queen, Spades),
                (King, Spades),
                (Ace, Spades),
            ])),
        ];

        assert!(values.windows(2).all(|pair| pair[0] < pair[1]));
    }

    #[test]
    fn tie_breaks() {
        assert!(
            eval5(hand([
                (Ace, Clubs),
                (Ace, Diamonds),
                (King, Hearts),
                (Queen, Spades),
                (Eight, Clubs),
            ])) > eval5(hand([
                (King, Clubs),
                (King, Diamonds),
                (Ace, Hearts),
                (Queen, Spades),
                (Eight, Clubs),
            ]))
        );
        assert!(
            eval5(hand([
                (Ace, Clubs),
                (Ace, Diamonds),
                (King, Hearts),
                (Queen, Spades),
                (Eight, Clubs),
            ])) > eval5(hand([
                (Ace, Hearts),
                (Ace, Spades),
                (King, Clubs),
                (Jack, Diamonds),
                (Nine, Hearts),
            ]))
        );
        assert!(
            eval5(hand([
                (Ace, Clubs),
                (Ace, Diamonds),
                (King, Hearts),
                (King, Spades),
                (Queen, Clubs),
            ])) > eval5(hand([
                (Ace, Hearts),
                (Ace, Spades),
                (King, Clubs),
                (King, Diamonds),
                (Jack, Hearts),
            ]))
        );
        assert!(
            eval5(hand([
                (Ace, Clubs),
                (Ace, Diamonds),
                (Ace, Hearts),
                (King, Spades),
                (Queen, Clubs),
            ])) > eval5(hand([
                (Ace, Clubs),
                (Ace, Diamonds),
                (Ace, Spades),
                (King, Hearts),
                (Jack, Clubs),
            ]))
        );
        assert!(
            eval5(hand([
                (Six, Clubs),
                (Seven, Diamonds),
                (Eight, Hearts),
                (Nine, Spades),
                (Ten, Clubs),
            ])) > eval5(hand([
                (Five, Clubs),
                (Six, Diamonds),
                (Seven, Hearts),
                (Eight, Spades),
                (Nine, Clubs),
            ]))
        );
        assert!(
            eval5(hand([
                (Ace, Hearts),
                (Jack, Hearts),
                (Eight, Hearts),
                (Five, Hearts),
                (Two, Hearts),
            ])) > eval5(hand([
                (King, Spades),
                (Queen, Spades),
                (Eight, Spades),
                (Five, Spades),
                (Two, Spades),
            ]))
        );
        assert!(
            eval5(hand([
                (Ace, Clubs),
                (Ace, Diamonds),
                (Ace, Hearts),
                (King, Clubs),
                (King, Diamonds),
            ])) > eval5(hand([
                (King, Hearts),
                (King, Spades),
                (King, Clubs),
                (Ace, Hearts),
                (Ace, Spades),
            ]))
        );
        assert!(
            eval5(hand([
                (Ace, Clubs),
                (Ace, Diamonds),
                (Ace, Hearts),
                (Ace, Spades),
                (King, Clubs),
            ])) > eval5(hand([
                (King, Clubs),
                (King, Diamonds),
                (King, Hearts),
                (King, Spades),
                (Ace, Clubs),
            ]))
        );
    }

    #[test]
    fn wheel() {
        let wheel = eval5(hand([
            (Ace, Clubs),
            (Two, Diamonds),
            (Three, Hearts),
            (Four, Spades),
            (Five, Clubs),
        ]));
        let six = eval5(hand([
            (Two, Clubs),
            (Three, Diamonds),
            (Four, Hearts),
            (Five, Spades),
            (Six, Clubs),
        ]));
        let wheel_flush = eval5(hand([
            (Ace, Hearts),
            (Two, Hearts),
            (Three, Hearts),
            (Four, Hearts),
            (Five, Hearts),
        ]));
        let six_flush = eval5(hand([
            (Two, Spades),
            (Three, Spades),
            (Four, Spades),
            (Five, Spades),
            (Six, Spades),
        ]));

        assert_eq!(wheel.kind(), HandKind::Straight);
        assert_eq!(wheel_flush.kind(), HandKind::StraightFlush);
        assert!(six > wheel);
        assert!(six_flush > wheel_flush);
    }

    #[test]
    fn input_order() {
        let a = eval5(hand([
            (Ace, Clubs),
            (King, Diamonds),
            (Queen, Hearts),
            (Jack, Spades),
            (Ten, Clubs),
        ]));
        let b = eval5(hand([
            (Queen, Hearts),
            (Ten, Clubs),
            (Ace, Clubs),
            (Jack, Spades),
            (King, Diamonds),
        ]));

        assert_eq!(a, b);
    }

    #[test]
    fn best_straight_flush() {
        let cards = hand7([
            (Ace, Spades),
            (King, Spades),
            (Queen, Spades),
            (Jack, Spades),
            (Ten, Spades),
            (Two, Diamonds),
            (Three, Clubs),
        ]);
        let best = hand([
            (Ace, Spades),
            (King, Spades),
            (Queen, Spades),
            (Jack, Spades),
            (Ten, Spades),
        ]);

        assert_eq!(eval7(cards), eval5(best));
    }

    #[test]
    fn best_four_kind() {
        let cards = hand7([
            (Ace, Clubs),
            (Ace, Diamonds),
            (Ace, Hearts),
            (Ace, Spades),
            (King, Clubs),
            (Queen, Diamonds),
            (Jack, Hearts),
        ]);
        let best = hand([
            (Ace, Clubs),
            (Ace, Diamonds),
            (Ace, Hearts),
            (Ace, Spades),
            (King, Clubs),
        ]);

        assert_eq!(eval7(cards), eval5(best));
    }

    #[test]
    fn best_full_house() {
        let cards = hand7([
            (Ace, Clubs),
            (Ace, Diamonds),
            (Ace, Hearts),
            (King, Clubs),
            (King, Diamonds),
            (King, Hearts),
            (Two, Spades),
        ]);
        let best = hand([
            (Ace, Clubs),
            (Ace, Diamonds),
            (Ace, Hearts),
            (King, Clubs),
            (King, Diamonds),
        ]);

        assert_eq!(eval7(cards), eval5(best));
    }

    #[test]
    fn best_flush() {
        let cards = hand7([
            (Ace, Spades),
            (King, Spades),
            (Jack, Spades),
            (Nine, Spades),
            (Five, Spades),
            (Two, Spades),
            (Queen, Hearts),
        ]);
        let best = hand([
            (Ace, Spades),
            (King, Spades),
            (Jack, Spades),
            (Nine, Spades),
            (Five, Spades),
        ]);

        assert_eq!(eval7(cards), eval5(best));
    }

    #[test]
    fn best_straight() {
        let cards = hand7([
            (Four, Clubs),
            (Five, Diamonds),
            (Six, Hearts),
            (Seven, Spades),
            (Eight, Clubs),
            (Nine, Diamonds),
            (King, Hearts),
        ]);
        let best = hand([
            (Five, Diamonds),
            (Six, Hearts),
            (Seven, Spades),
            (Eight, Clubs),
            (Nine, Diamonds),
        ]);

        assert_eq!(eval7(cards), eval5(best));
    }

    #[test]
    fn seven_wheel() {
        let wheel = hand7([
            (Ace, Clubs),
            (Two, Diamonds),
            (Three, Hearts),
            (Four, Spades),
            (Five, Clubs),
            (Nine, Diamonds),
            (King, Hearts),
        ]);
        let both = hand7([
            (Ace, Clubs),
            (Two, Diamonds),
            (Three, Hearts),
            (Four, Spades),
            (Five, Clubs),
            (Six, Diamonds),
            (King, Hearts),
        ]);
        let five_high = hand([
            (Ace, Clubs),
            (Two, Diamonds),
            (Three, Hearts),
            (Four, Spades),
            (Five, Clubs),
        ]);
        let six_high = hand([
            (Two, Diamonds),
            (Three, Hearts),
            (Four, Spades),
            (Five, Clubs),
            (Six, Diamonds),
        ]);

        assert_eq!(eval7(wheel), eval5(five_high));
        assert_eq!(eval7(both), eval5(six_high));
    }

    #[test]
    fn best_two_pair() {
        let cards = hand7([
            (Ace, Clubs),
            (Ace, Diamonds),
            (King, Hearts),
            (King, Spades),
            (Queen, Clubs),
            (Jack, Diamonds),
            (Two, Hearts),
        ]);
        let best = hand([
            (Ace, Clubs),
            (Ace, Diamonds),
            (King, Hearts),
            (King, Spades),
            (Queen, Clubs),
        ]);

        assert_eq!(eval7(cards), eval5(best));
    }

    #[test]
    fn three_pairs() {
        let cards = hand7([
            (Ace, Clubs),
            (Ace, Diamonds),
            (King, Hearts),
            (King, Spades),
            (Queen, Clubs),
            (Queen, Diamonds),
            (Two, Hearts),
        ]);
        let best = hand([
            (Ace, Clubs),
            (Ace, Diamonds),
            (King, Hearts),
            (King, Spades),
            (Queen, Clubs),
        ]);

        assert_eq!(eval7(cards), eval5(best));
    }

    #[test]
    fn flush_over_straight() {
        let cards = hand7([
            (Ace, Hearts),
            (King, Hearts),
            (Queen, Hearts),
            (Seven, Hearts),
            (Two, Hearts),
            (Jack, Clubs),
            (Ten, Diamonds),
        ]);
        let value = eval7(cards);

        assert_eq!(value.kind(), HandKind::Flush);
    }

    #[test]
    fn seven_order() {
        let a = hand7([
            (Ace, Clubs),
            (Ace, Diamonds),
            (King, Hearts),
            (King, Spades),
            (Queen, Clubs),
            (Queen, Diamonds),
            (Two, Hearts),
        ]);
        let b = hand7([
            (Queen, Diamonds),
            (Two, Hearts),
            (King, Spades),
            (Ace, Clubs),
            (Queen, Clubs),
            (Ace, Diamonds),
            (King, Hearts),
        ]);

        assert_eq!(eval7(a), eval7(b));
    }

    #[test]
    fn subset_max() {
        let cards = hand7([
            (Ace, Clubs),
            (Ace, Diamonds),
            (King, Hearts),
            (King, Spades),
            (Queen, Clubs),
            (Queen, Diamonds),
            (Two, Hearts),
        ]);
        let aa_kk = eval5(hand([
            (Ace, Clubs),
            (Ace, Diamonds),
            (King, Hearts),
            (King, Spades),
            (Queen, Clubs),
        ]));
        let aa_qq = eval5(hand([
            (Ace, Clubs),
            (Ace, Diamonds),
            (Queen, Clubs),
            (Queen, Diamonds),
            (King, Hearts),
        ]));
        let kk_qq = eval5(hand([
            (King, Hearts),
            (King, Spades),
            (Queen, Clubs),
            (Queen, Diamonds),
            (Ace, Clubs),
        ]));
        let best = aa_kk.max(aa_qq).max(kk_qq);

        assert_eq!(eval7(cards), best);
    }
}
