use crate::card::{Card, Rank, Suit};

const CARD_COUNT: usize = Rank::ALL.len() * Suit::ALL.len();

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Deck {
    cards: [Card; CARD_COUNT],
}

impl Deck {
    pub fn new() -> Self {
        let cards = core::array::from_fn(|index| {
            let rank = Rank::ALL[index % Rank::ALL.len()];
            let suit = Suit::ALL[index / Rank::ALL.len()];

            Card::new(rank, suit)
        });

        Self { cards }
    }

    pub fn from_seed(seed: [u8; 32]) -> Self {
        let cards = deal_core::shuffle(seed).map(|id| Card::from_id(id).expect("valid card id"));

        Self { cards }
    }

    pub fn cards(&self) -> &[Card; CARD_COUNT] {
        &self.cards
    }
}

impl Default for Deck {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::*;

    const SEED_A: [u8; 32] = [0x11; 32];
    const SEED_B: [u8; 32] = [0xa5; 32];

    #[test]
    fn full_deck() {
        assert_eq!(Deck::new().cards().len(), 52);
    }

    #[test]
    fn unique_deck() {
        let deck = Deck::new();
        let cards: HashSet<_> = deck.cards().iter().copied().collect();

        assert_eq!(cards.len(), 52);
    }

    #[test]
    fn canonical_order() {
        let deck = Deck::new();

        for (index, card) in deck.cards().iter().enumerate() {
            assert_eq!(card.id(), index as u8);
        }
    }

    #[test]
    fn deterministic_shuffle() {
        assert_eq!(Deck::from_seed(SEED_A), Deck::from_seed(SEED_A));
        assert_ne!(Deck::from_seed(SEED_A), Deck::from_seed(SEED_B));
    }

    #[test]
    fn same_card_set() {
        let canonical: HashSet<_> = Deck::new().cards().iter().copied().collect();
        let shuffled: HashSet<_> = Deck::from_seed(SEED_A).cards().iter().copied().collect();

        assert_eq!(shuffled, canonical);
    }
}
