const RANK_COUNT: u8 = 13;

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[repr(u8)]
pub enum Rank {
    Two,
    Three,
    Four,
    Five,
    Six,
    Seven,
    Eight,
    Nine,
    Ten,
    Jack,
    Queen,
    King,
    Ace,
}

impl Rank {
    pub(crate) const ALL: [Self; RANK_COUNT as usize] = [
        Self::Two,
        Self::Three,
        Self::Four,
        Self::Five,
        Self::Six,
        Self::Seven,
        Self::Eight,
        Self::Nine,
        Self::Ten,
        Self::Jack,
        Self::Queen,
        Self::King,
        Self::Ace,
    ];
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[repr(u8)]
pub enum Suit {
    Clubs,
    Diamonds,
    Hearts,
    Spades,
}

impl Suit {
    pub(crate) const ALL: [Self; 4] = [Self::Clubs, Self::Diamonds, Self::Hearts, Self::Spades];
}

// rank = two 0 through ace 12
// suit = clubs 0 diamonds 1 hearts 2 spades 3
// card = suit * 13 + rank
// two clubs = 0 * 13 + 0 = 0
// ace spades = 3 * 13 + 12 = 51
// one byte instead of rank and suit fields
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[repr(transparent)]
pub struct Card(u8);

impl Card {
    pub(crate) const fn new(rank: Rank, suit: Suit) -> Self {
        Self(rank as u8 + RANK_COUNT * suit as u8)
    }

    pub const fn rank(self) -> Rank {
        Rank::ALL[(self.0 % RANK_COUNT) as usize]
    }

    pub const fn suit(self) -> Suit {
        Suit::ALL[(self.0 / RANK_COUNT) as usize]
    }
}
