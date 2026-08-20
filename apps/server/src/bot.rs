use game_core::{Action, Card, LegalActions, eval7};
use sha2::{Digest, Sha256};

const SAMPLES: u32 = 128;

// bot visible state only
pub(super) struct View<'a> {
    pub(super) hole: [Card; 2],
    pub(super) board: &'a [Card],
    pub(super) pot: u32,
    pub(super) legal: LegalActions,
    pub(super) opponents: usize,
    pub(super) seed: [u8; 32],
}

pub(super) fn action(view: View<'_>) -> Action {
    let equity = equity(&view);
    let raise_at = 0.68 + f64::from(view.seed[0] & 7) / 200.0;

    if let Some(cost) = view.legal.call {
        let odds = f64::from(cost) / f64::from(view.pot.saturating_add(cost));

        if equity < odds * 0.8 {
            return Action::Fold;
        }

        if equity >= raise_at
            && let Some(raise) = view.legal.raise
        {
            return raise_action(view.pot, raise.min_to, raise.max_to);
        }

        return Action::Call;
    }

    if view.legal.check {
        if equity >= raise_at
            && let Some(raise) = view.legal.raise
        {
            return raise_action(view.pot, raise.min_to, raise.max_to);
        }

        return Action::Check;
    }

    Action::Fold
}

fn raise_action(pot: u32, min_to: u32, max_to: u32) -> Action {
    let to = min_to.saturating_add(pot / 2).clamp(min_to, max_to);

    Action::RaiseTo(to)
}

fn equity(view: &View<'_>) -> f64 {
    let opponents = view.opponents.clamp(1, 5);
    let mut total = 0.0;

    for sample in 0..SAMPLES {
        let cards = sample_cards(view, sample);
        let board = board(view.board, &cards[opponents * 2..]);
        let value = eval7([
            view.hole[0],
            view.hole[1],
            board[0],
            board[1],
            board[2],
            board[3],
            board[4],
        ]);
        let mut tied = 1;
        let mut lost = false;

        for opponent in 0..opponents {
            let offset = opponent * 2;
            let other = eval7([
                cards[offset],
                cards[offset + 1],
                board[0],
                board[1],
                board[2],
                board[3],
                board[4],
            ]);

            if other > value {
                lost = true;
                break;
            }

            if other == value {
                tied += 1;
            }
        }

        if !lost {
            total += 1.0 / f64::from(tied);
        }
    }

    total / f64::from(SAMPLES)
}

fn sample_cards(view: &View<'_>, sample: u32) -> Vec<Card> {
    let mut input = Sha256::new();

    input.update(b"NPBOT01");
    input.update(view.seed);
    input.update(sample.to_be_bytes());
    let seed = input.finalize().into();
    let known = [view.hole[0], view.hole[1]];

    deal_core::shuffle(seed)
        .into_iter()
        .map(|id| Card::from_id(id).expect("valid card id"))
        .filter(|card| !known.contains(card) && !view.board.contains(card))
        .collect()
}

fn board(known: &[Card], cards: &[Card]) -> [Card; 5] {
    let mut board = [Card::from_id(0).expect("valid card id"); 5];

    for (index, card) in known.iter().enumerate() {
        board[index] = *card;
    }

    for (index, card) in board[known.len()..].iter_mut().enumerate() {
        *card = cards[index];
    }

    board
}

#[cfg(test)]
mod tests {
    use game_core::{LegalActions, RaiseRange};

    use super::*;

    fn view(legal: LegalActions) -> View<'static> {
        View {
            hole: [Card::from_id(0).unwrap(), Card::from_id(1).unwrap()],
            board: &[],
            pot: 20,
            legal,
            opponents: 1,
            seed: [7; 32],
        }
    }

    fn legal(action: Action, actions: LegalActions) -> bool {
        match action {
            Action::Fold => actions.fold,
            Action::Check => actions.check,
            Action::Call => actions.call.is_some(),
            Action::RaiseTo(to) => actions
                .raise
                .is_some_and(|range| (range.min_to..=range.max_to).contains(&to)),
        }
    }

    #[test]
    fn legal_actions() {
        let states = [
            LegalActions {
                fold: true,
                check: true,
                call: None,
                raise: None,
            },
            LegalActions {
                fold: true,
                check: false,
                call: Some(10),
                raise: None,
            },
            LegalActions {
                fold: true,
                check: true,
                call: None,
                raise: Some(RaiseRange {
                    min_to: 20,
                    max_to: 80,
                }),
            },
            LegalActions {
                fold: true,
                check: false,
                call: Some(4),
                raise: Some(RaiseRange {
                    min_to: 14,
                    max_to: 16,
                }),
            },
        ];

        for actions in states {
            assert!(legal(action(view(actions)), actions));
        }
    }

    #[test]
    fn same_view_same_action() {
        let actions = LegalActions {
            fold: true,
            check: false,
            call: Some(10),
            raise: Some(RaiseRange {
                min_to: 20,
                max_to: 80,
            }),
        };

        assert_eq!(action(view(actions)), action(view(actions)));
    }
}
