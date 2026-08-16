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

// kind first = category before tie ranks
// tie ranks = strongest first
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct HandValue {
    kind: HandKind,
    tie: [Rank; 5],
}

impl HandValue {
    pub const fn kind(self) -> HandKind {
        self.kind
    }
}

pub fn eval5(cards: [Card; 5]) -> HandValue {
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
        return value(HandKind::StraightFlush, &[rank]);
    }

    if let Some(rank) = four {
        return value(HandKind::FourKind, &[rank, single[0]]);
    }

    if let Some(rank) = three
        && pair_len == 1
    {
        return value(HandKind::FullHouse, &[rank, pairs[0]]);
    }

    if flush {
        return value(HandKind::Flush, &high);
    }

    if let Some(rank) = straight {
        return value(HandKind::Straight, &[rank]);
    }

    if let Some(rank) = three {
        return value(HandKind::ThreeKind, &[rank, single[0], single[1]]);
    }

    if pair_len == 2 {
        return value(HandKind::TwoPair, &[pairs[0], pairs[1], single[0]]);
    }

    if pair_len == 1 {
        return value(HandKind::Pair, &[pairs[0], single[0], single[1], single[2]]);
    }

    value(HandKind::HighCard, &high)
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

fn value(kind: HandKind, ranks: &[Rank]) -> HandValue {
    let mut tie = [Rank::Two; 5];
    tie[..ranks.len()].copy_from_slice(ranks);

    HandValue { kind, tie }
}

#[cfg(test)]
mod tests {
    use super::{HandKind, eval5};
    use crate::Rank::*;
    use crate::Suit::*;
    use crate::{Card, Rank, Suit};

    fn hand(cards: [(Rank, Suit); 5]) -> [Card; 5] {
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
}
