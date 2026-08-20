const RANK_COUNT: u8 = 13;
const CARD_COUNT: u8 = 52;

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

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[repr(transparent)]
pub struct Card(u8);

impl Card {
    pub(crate) const fn new(rank: Rank, suit: Suit) -> Self {
        Self(rank as u8 + RANK_COUNT * suit as u8)
    }

    pub const fn from_id(id: u8) -> Option<Self> {
        if id < CARD_COUNT {
            Some(Self(id))
        } else {
            None
        }
    }

    pub const fn id(self) -> u8 {
        self.0
    }

    pub const fn rank(self) -> Rank {
        Rank::ALL[(self.0 % RANK_COUNT) as usize]
    }

    pub const fn suit(self) -> Suit {
        Suit::ALL[(self.0 / RANK_COUNT) as usize]
    }
}
