use game_core::{
    Action, ActionError, Card, LegalActions, NextHandError, Rank, State, Street, Suit,
};
use serde::Serialize;
use wasm_bindgen::prelude::*;

// six player hand stays below this limit
const MAX_STEPS: usize = 64;

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
        view_value(state_view(&self.state, self.viewer))
    }

    pub fn fold(&mut self) -> Result<JsValue, JsError> {
        self.apply_action(Action::Fold)
    }

    pub fn check(&mut self) -> Result<JsValue, JsError> {
        self.apply_action(Action::Check)
    }

    pub fn call(&mut self) -> Result<JsValue, JsError> {
        self.apply_action(Action::Call)
    }

    pub fn raise_to(&mut self, to: u32) -> Result<JsValue, JsError> {
        self.apply_action(Action::RaiseTo(to))
    }

    pub fn next_hand(&mut self, seed: &[u8]) -> Result<JsValue, JsError> {
        let seed = parse_seed(seed).map_err(JsError::new)?;
        let state = next_state(&self.state, self.viewer, seed).map_err(JsError::new)?;

        self.state = state;
        self.view()
    }
}

impl Game {
    fn apply_action(&mut self, action: Action) -> Result<JsValue, JsError> {
        let view = apply_view(&mut self.state, self.viewer, action).map_err(JsError::new)?;

        view_value(view)
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
    settled: bool,
    actions: Option<ActionView>,
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

#[derive(Debug, Eq, PartialEq, Serialize)]
struct ActionView {
    fold: bool,
    check: bool,
    call: Option<u32>,
    raise: Option<RaiseView>,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
struct RaiseView {
    min_to: u32,
    max_to: u32,
}

fn create(
    seed: &[u8],
    dealer: usize,
    stacks: &[u32],
    sb: u32,
    bb: u32,
    viewer: usize,
) -> Result<Game, &'static str> {
    let seed = parse_seed(seed)?;
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

    let mut state = State::new(seed, dealer, stacks, sb, bb);

    drive(&mut state, viewer)?;

    Ok(Game { state, viewer })
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
        settled: state.settled,
        actions: state.legal_actions(viewer).map(action_view),
    }
}

fn action_view(actions: LegalActions) -> ActionView {
    ActionView {
        fold: actions.fold,
        check: actions.check,
        call: actions.call,
        raise: actions.raise.map(|range| RaiseView {
            min_to: range.min_to,
            max_to: range.max_to,
        }),
    }
}

fn apply_view(state: &mut State, viewer: usize, action: Action) -> Result<View, &'static str> {
    state.apply(viewer, action).map_err(action_error)?;
    drive(state, viewer)?;
    Ok(state_view(state, viewer))
}

// runs opponents until viewer action or payout
fn drive(state: &mut State, viewer: usize) -> Result<(), &'static str> {
    for _ in 0..MAX_STEPS {
        if state.settled {
            return Ok(());
        }

        if state.fold_winner.is_some() {
            state.settle().map_err(|_| "cannot settle demo hand")?;
            return Ok(());
        }

        if state.round_complete {
            if state.street == Street::River {
                state.settle().map_err(|_| "cannot settle demo hand")?;
                return Ok(());
            }

            state
                .advance_street()
                .map_err(|_| "cannot advance demo hand")?;
            continue;
        }

        if state.legal_actions(viewer).is_some() {
            return Ok(());
        }

        let player = state.turn;
        let action = passive_action(state, player)?;

        state
            .apply(player, action)
            .map_err(|_| "cannot apply demo action")?;
    }

    Err("demo step limit reached")
}

fn passive_action(state: &State, player: usize) -> Result<Action, &'static str> {
    let actions = state
        .legal_actions(player)
        .ok_or("opponent has no legal action")?;

    if actions.check {
        Ok(Action::Check)
    } else if actions.call.is_some() {
        Ok(Action::Call)
    } else if actions.fold {
        Ok(Action::Fold)
    } else {
        Err("opponent has no passive action")
    }
}

fn next_state(state: &State, viewer: usize, seed: [u8; 32]) -> Result<State, &'static str> {
    let mut state = state.next_hand(seed).map_err(next_hand_error)?;

    drive(&mut state, viewer)?;
    Ok(state)
}

fn parse_seed(seed: &[u8]) -> Result<[u8; 32], &'static str> {
    seed.try_into().map_err(|_| "seed must contain 32 bytes")
}

fn view_value(view: View) -> Result<JsValue, JsError> {
    serde_wasm_bindgen::to_value(&view).map_err(|err| JsError::new(&err.to_string()))
}

fn action_error(err: ActionError) -> &'static str {
    match err {
        ActionError::InvalidPlayer => "invalid player",
        ActionError::NotTurn => "not viewer turn",
        ActionError::RoundComplete => "betting round complete",
        ActionError::HandComplete => "hand complete",
        ActionError::CannotCheck => "cannot check",
        ActionError::CannotCall => "cannot call",
        ActionError::CannotRaise => "cannot raise",
    }
}

fn next_hand_error(err: NextHandError) -> &'static str {
    match err {
        NextHandError::NotSettled => "hand must be settled",
        NextHandError::CannotStart => "player cannot cover big blind",
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
        assert!(!view.settled);
        assert!(view.actions.is_some());
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
        assert_eq!(state_view(&round.state, round.viewer).actions, None);
        assert_eq!(state_view(&fold.state, fold.viewer).actions, None);
    }

    #[test]
    fn viewer_actions() {
        let game = create(&SEED, 3, &[1000; 6], 5, 10, 0).unwrap();
        let actions = state_view(&game.state, game.viewer).actions.unwrap();

        assert!(actions.fold);
        assert!(!actions.check);
        assert_eq!(actions.call, Some(10));
        assert_eq!(
            actions.raise,
            Some(RaiseView {
                min_to: 20,
                max_to: 1000,
            })
        );
    }

    #[test]
    fn initial_progress() {
        let game = create(&SEED, 0, &[1000; 6], 5, 10, 0).unwrap();

        assert_eq!(game.state.turn, 0);
        assert_eq!(game.state.pot, 45);
        assert_eq!(
            game.state
                .players
                .iter()
                .map(|player| player.contributed)
                .collect::<Vec<_>>(),
            vec![0, 5, 10, 10, 10, 10]
        );
        assert!(game.state.legal_actions(game.viewer).is_some());
    }

    #[test]
    fn passive_policy() {
        let call = State::new(SEED, 0, &[100; 2], 5, 10);
        let mut check = State::new(SEED, 0, &[100; 2], 5, 10);

        check.apply(0, Action::Call).unwrap();

        let call_action = passive_action(&call, 0).unwrap();
        let check_action = passive_action(&check, 1).unwrap();

        assert_eq!(call_action, Action::Call);
        assert_eq!(check_action, Action::Check);
        assert!(!matches!(call_action, Action::RaiseTo(_)));
        assert!(!matches!(check_action, Action::RaiseTo(_)));
    }

    #[test]
    fn viewer_return() {
        let mut game = create(&SEED, 0, &[1000; 6], 5, 10, 0).unwrap();
        let view = apply_view(&mut game.state, game.viewer, Action::Call).unwrap();

        assert_eq!(game.state.street, Street::Flop);
        assert_eq!(view.turn, Some(game.viewer));
        assert_eq!(view.board.len(), 3);
        assert!(view.actions.unwrap().check);
    }

    #[test]
    fn passive_hand() {
        let mut game = create(&SEED, 0, &[1000; 6], 5, 10, 0).unwrap();

        finish(&mut game);

        assert!(game.state.settled);
        assert_eq!(game.state.board.len(), 5);
        assert_eq!(game.state.pot, 0);
        assert_eq!(
            game.state
                .players
                .iter()
                .map(|player| u64::from(player.stack))
                .sum::<u64>(),
            6000
        );
    }

    #[test]
    fn fold_runout() {
        let mut game = create(&SEED, 0, &[1000; 6], 5, 10, 0).unwrap();
        let view = apply_view(&mut game.state, game.viewer, Action::Fold).unwrap();

        assert!(view.players[game.viewer].folded);
        assert!(view.settled);
        assert_eq!(view.board.len(), 5);
        assert_eq!(view.pot, 0);
        assert_eq!(view.actions, None);
    }

    #[test]
    fn all_in_runout() {
        let mut game = create(&SEED, 0, &[100; 6], 5, 10, 0).unwrap();
        let view = apply_view(&mut game.state, game.viewer, Action::RaiseTo(100)).unwrap();

        assert!(view.settled);
        assert_eq!(view.board.len(), 5);
        assert_eq!(view.pot, 0);
        assert_eq!(view.actions, None);
        assert_eq!(
            view.players
                .iter()
                .map(|player| u64::from(player.stack))
                .sum::<u64>(),
            600
        );
    }

    #[test]
    fn next_hand() {
        let mut game = create(&SEED, 0, &[1000; 6], 5, 10, 0).unwrap();

        finish(&mut game);

        let stacks: Vec<_> = game
            .state
            .players
            .iter()
            .map(|player| player.stack)
            .collect();
        let hole = game.state.hole.clone();
        let next = next_state(&game.state, game.viewer, [0x24; 32]).unwrap();

        assert_eq!(next.dealer, 1);
        assert_eq!(next.street, Street::Preflop);
        assert!(next.board.is_empty());
        assert!(!next.settled);
        assert!(next.players.iter().all(|player| !player.folded));
        assert_eq!(
            next.players
                .iter()
                .map(|player| player.contributed)
                .collect::<Vec<_>>(),
            vec![0, 0, 5, 10, 10, 10]
        );

        for (player, stack) in next.players.iter().zip(stacks) {
            assert_eq!(player.stack + player.contributed, stack);
        }

        assert_ne!(next.hole, hole);
        assert_eq!(next.turn, game.viewer);
        assert!(next.legal_actions(game.viewer).is_some());
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

    fn finish(game: &mut Game) {
        while !game.state.settled {
            let action = passive_action(&game.state, game.viewer).unwrap();

            apply_view(&mut game.state, game.viewer, action).unwrap();
        }
    }
}
