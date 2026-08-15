use crate::card::{Card, Rank, Suit};

const CARD_COUNT: usize = Rank::ALL.len() * Suit::ALL.len();

#[derive(Debug, Eq, PartialEq)]
pub struct Deck {
    cards: [Card; CARD_COUNT],
}

impl Deck {
    pub fn new() -> Self {
        let cards = core::array::from_fn(|i| {
            let rank = Rank::ALL[i % Rank::ALL.len()];
            let suit = Suit::ALL[i / Rank::ALL.len()];

            Card::new(rank, suit)
        });

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

    #[test]
    fn deck_has_52_cards() {
        assert_eq!(Deck::new().cards().len(), 52);
    }

    #[test]
    fn cards_are_unique() {
        let deck = Deck::new();
        let cards: HashSet<_> = deck.cards().iter().copied().collect();

        assert_eq!(cards.len(), 52);
    }

    #[test]
    fn each_suit_has_all_ranks() {
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
    fn each_rank_has_all_suits() {
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
    fn deck_order_is_deterministic() {
        assert_eq!(Deck::new(), Deck::new());
    }
}
