use game_core::{Card, Rank, State, Street, Suit};
use serde::Serialize;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Game {
    state: State,
    viewer: usize,
}

#[wasm_bindgen]
impl Game {
    #[wasm_bindgen(constructor)]
    pub fn new(
        seed: &[u8],
        dealer: usize,
        stacks: &[u32],
        sb: u32,
        bb: u32,
        viewer: usize,
    ) -> Result<Self, JsError> {
        create(seed, dealer, stacks, sb, bb, viewer).map_err(JsError::new)
    }

    pub fn view(&self) -> Result<JsValue, JsError> {
        serde_wasm_bindgen::to_value(&state_view(&self.state, self.viewer))
            .map_err(|err| JsError::new(&err.to_string()))
    }
}

#[derive(Debug, Eq, PartialEq, Serialize)]
struct View {
    players: Vec<PlayerView>,
    hole: [CardView; 2],
    board: Vec<CardView>,
    pot: u32,
    dealer: usize,
    turn: Option<usize>,
    street: &'static str,
    round_complete: bool,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
struct PlayerView {
    stack: u32,
    bet: u32,
    folded: bool,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
struct CardView {
    value: String,
}

fn create(
    seed: &[u8],
    dealer: usize,
    stacks: &[u32],
    sb: u32,
    bb: u32,
    viewer: usize,
) -> Result<Game, &'static str> {
    let seed: [u8; 32] = seed.try_into().map_err(|_| "seed must contain 32 bytes")?;
    let n = stacks.len();

    if !(2..=6).contains(&n) {
        return Err("player count must be 2 through 6");
    }

    if dealer >= n {
        return Err("dealer must be a player index");
    }

    if viewer >= n {
        return Err("viewer must be a player index");
    }

    if sb == 0 {
        return Err("small blind must be positive");
    }

    if bb < sb {
        return Err("big blind must cover small blind");
    }

    if stacks.iter().any(|&stack| stack < bb) {
        return Err("every stack must cover big blind");
    }

    let total: u64 = stacks.iter().map(|&stack| u64::from(stack)).sum();

    if total > u64::from(u32::MAX) {
        return Err("total stacks exceed chip limit");
    }

    Ok(Game {
        state: State::new(seed, dealer, stacks, sb, bb),
        viewer,
    })
}

fn state_view(state: &State, viewer: usize) -> View {
    let players = state
        .players
        .iter()
        .map(|player| PlayerView {
            stack: player.stack,
            bet: player.bet,
            folded: player.folded,
        })
        .collect();
    let turn = (!state.round_complete && state.fold_winner.is_none() && !state.settled)
        .then_some(state.turn);

    View {
        players,
        hole: state.hole[viewer].map(card_view),
        board: state.board.iter().copied().map(card_view).collect(),
        pot: state.pot,
        dealer: state.dealer,
        turn,
        street: street_view(state.street),
        round_complete: state.round_complete,
    }
}

fn card_view(card: Card) -> CardView {
    let rank = match card.rank() {
        Rank::Two => "2",
        Rank::Three => "3",
        Rank::Four => "4",
        Rank::Five => "5",
        Rank::Six => "6",
        Rank::Seven => "7",
        Rank::Eight => "8",
        Rank::Nine => "9",
        Rank::Ten => "10",
        Rank::Jack => "J",
        Rank::Queen => "Q",
        Rank::King => "K",
        Rank::Ace => "A",
    };
    let suit = match card.suit() {
        Suit::Clubs => "♣",
        Suit::Diamonds => "♦",
        Suit::Hearts => "♥",
        Suit::Spades => "♠",
    };

    CardView {
        value: format!("{rank}{suit}"),
    }
}

fn street_view(street: Street) -> &'static str {
    match street {
        Street::Preflop => "preflop",
        Street::Flop => "flop",
        Street::Turn => "turn",
        Street::River => "river",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use game_core::{Action, Deck};

    const SEED: [u8; 32] = [0x42; 32];

    #[test]
    fn six_view() {
        let game = create(&SEED, 2, &[1000, 1200, 900, 1500, 800, 1100], 5, 10, 0).unwrap();
        let view = state_view(&game.state, game.viewer);

        assert_eq!(view.players.len(), 6);

        for (actual, player) in view.players.iter().zip(&game.state.players) {
            assert_eq!(actual.stack, player.stack);
            assert_eq!(actual.bet, player.bet);
            assert_eq!(actual.folded, player.folded);
        }

        assert_eq!(view.pot, game.state.pot);
        assert_eq!(view.dealer, game.state.dealer);
        assert_eq!(view.turn, Some(game.state.turn));
        assert_eq!(view.street, "preflop");
        assert!(view.board.is_empty());
        assert!(!view.round_complete);
    }

    #[test]
    fn private_hole() {
        let game = create(&SEED, 0, &[1000; 6], 5, 10, 0).unwrap();
        let view0 = state_view(&game.state, 0);
        let view1 = state_view(&game.state, 1);

        assert_eq!(view0.hole, game.state.hole[0].map(card_view));
        assert_eq!(view1.hole, game.state.hole[1].map(card_view));
        assert_ne!(view0.hole, view1.hole);
    }

    #[test]
    fn same_view() {
        let game = create(&SEED, 1, &[1000; 4], 5, 10, 2).unwrap();

        assert_eq!(
            state_view(&game.state, game.viewer),
            state_view(&game.state, game.viewer)
        );
    }

    #[test]
    fn no_terminal_turn() {
        let mut round = create(&SEED, 0, &[100; 2], 5, 10, 0).unwrap();
        round.state.apply(0, Action::Call).unwrap();
        round.state.apply(1, Action::Check).unwrap();

        let mut fold = create(&SEED, 0, &[100; 2], 5, 10, 0).unwrap();
        fold.state.apply(0, Action::Fold).unwrap();

        assert_eq!(state_view(&round.state, round.viewer).turn, None);
        assert_eq!(state_view(&fold.state, fold.viewer).turn, None);
    }

    #[test]
    fn card_text() {
        let deck = Deck::new();

        assert_eq!(card_view(deck.cards()[0]).value, "2♣");
        assert_eq!(card_view(deck.cards()[21]).value, "10♦");
        assert_eq!(card_view(deck.cards()[51]).value, "A♠");
    }

    #[test]
    fn config_bounds() {
        assert!(create(&SEED[..31], 0, &[100; 2], 5, 10, 0).is_err());
        assert!(create(&SEED, 0, &[100], 5, 10, 0).is_err());
        assert!(create(&SEED, 2, &[100; 2], 5, 10, 0).is_err());
        assert!(create(&SEED, 0, &[100; 2], 5, 10, 2).is_err());
        assert!(create(&SEED, 0, &[100; 2], 0, 10, 0).is_err());
        assert!(create(&SEED, 0, &[100; 2], 10, 5, 0).is_err());
        assert!(create(&SEED, 0, &[9, 100], 5, 10, 0).is_err());
        assert!(create(&SEED, 0, &[u32::MAX, 10], 5, 10, 0).is_err());
    }
}
