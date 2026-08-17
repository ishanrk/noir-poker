use rand::SeedableRng;
use rand::seq::SliceRandom;
use rand_chacha::ChaCha20Rng;

// seeded chacha20 rng
use crate::card::{Card, Rank, Suit};

const CARD_COUNT: usize = Rank::ALL.len() * Suit::ALL.len();

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Deck {
    cards: [Card; CARD_COUNT],
}

impl Deck {
    pub fn new() -> Self {
        // suit major ranks low to high

        // use rank all and suit all constants to add modularity for different decks
        let cards = core::array::from_fn(|i| {
            let rank = Rank::ALL[i % Rank::ALL.len()];
            let suit = Suit::ALL[i / Rank::ALL.len()];

            Card::new(rank, suit)
        });

        Self { cards }
    }

    pub fn from_seed(seed: [u8; 32]) -> Self {
        let mut deck = Self::new();
        let mut rng = ChaCha20Rng::from_seed(seed);

        deck.cards.shuffle(&mut rng);
        deck
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

    // imports all from parent module
    use super::*;

    // seed = input that picks shuffle order
    // same seed = same deck order
    // 0x11 and 0xa5 = simple different test bytes
    // repeated 32 times = required seed size
    // values have no special meaning
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
    fn ranks_per_suit() {
        let deck = Deck::new();

        for suit in Suit::ALL {
            let ranks: HashSet<_> = deck
                .cards()
                .iter()
                .filter(|card| card.suit() == suit)
                .map(|card| card.rank())
                .collect();

            assert_eq!(ranks.len(), Rank::ALL.len());
            assert!(Rank::ALL.iter().all(|rank| ranks.contains(rank)));
        }
    }

    #[test]
    fn suits_per_rank() {
        let deck = Deck::new();

        for rank in Rank::ALL {
            let suits: HashSet<_> = deck
                .cards()
                .iter()
                .filter(|card| card.rank() == rank)
                .map(|card| card.suit())
                .collect();

            assert_eq!(suits.len(), Suit::ALL.len());
            assert!(Suit::ALL.iter().all(|suit| suits.contains(suit)));
        }
    }

    #[test]
    fn canonical_order() {
        let deck = Deck::new();

        for (i, card) in deck.cards().iter().enumerate() {
            assert_eq!(card.rank(), Rank::ALL[i % Rank::ALL.len()]);
            assert_eq!(card.suit(), Suit::ALL[i / Rank::ALL.len()]);
        }

        assert_eq!(deck, Deck::new());
    }

    #[test]
    fn same_seed_order() {
        assert_eq!(Deck::from_seed(SEED_A), Deck::from_seed(SEED_A));
    }

    #[test]
    fn different_seed_order() {
        assert_ne!(Deck::from_seed(SEED_A), Deck::from_seed(SEED_B));
    }

    #[test]
    fn full_shuffle() {
        assert_eq!(Deck::from_seed(SEED_A).cards().len(), 52);
    }

    #[test]
    fn unique_shuffle() {
        let deck = Deck::from_seed(SEED_A);
        let cards: HashSet<_> = deck.cards().iter().copied().collect();

        assert_eq!(cards.len(), 52);
    }

    #[test]
    fn same_card_set() {
        let canonical: HashSet<_> = Deck::new().cards().iter().copied().collect();
        let shuffled: HashSet<_> = Deck::from_seed(SEED_A).cards().iter().copied().collect();

        assert_eq!(shuffled, canonical);
    }
}
