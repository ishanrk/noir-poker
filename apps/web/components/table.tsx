import { Card } from "@/components/card";
import { Seat } from "@/components/seat";

type CardView = {
  value: string;
};

type PlayerView = {
  stack: number;
  bet: number;
  folded: boolean;
};

type ActionView = {
  fold: boolean;
  check: boolean;
  call: number | undefined;
  raise:
    | {
        min_to: number;
        max_to: number;
      }
    | undefined;
};

export type View = {
  players: PlayerView[];
  hole: [CardView, CardView];
  board: CardView[];
  pot: number;
  dealer: number;
  turn: number | undefined;
  street: string;
  round_complete: boolean;
  settled: boolean;
  actions: ActionView | undefined;
};

type TableProps = {
  view: View;
  viewer: number;
  label?: string;
  error?: string;
  disabled?: boolean;
  raiseTo: number;
  setRaiseTo: (to: number) => void;
  onFold: () => void;
  onCheck: () => void;
  onCall: () => void;
  onRaise: () => void;
  onNewHand?: () => void;
};

const POSITIONS = [0, 1, 2, 3, 4, 5] as const;

export function Table({
  view,
  viewer,
  label = "Local game",
  error,
  disabled = false,
  raiseTo,
  setRaiseTo,
  onFold,
  onCheck,
  onCall,
  onRaise,
  onNewHand,
}: TableProps) {
  const hole = [view.hole[0].value, view.hole[1].value] as const;
  const actions = view.actions;
  const range = actions?.raise;
  let status = "Table";
  let message = "Waiting for player";

  if (actions) {
    status = "Your action";
    message = "Choose an action";
  }

  if (disabled) {
    status = "Waiting";
    message = "Waiting for server";
  }

  if (view.settled) {
    status = "Complete";
    message = "Hand complete";
  }

  if (error) {
    status = "Error";
    message = error;
  }

  return (
    <section className="table-shell" aria-label="Six-max poker table">
      <div className="table-stage">
        <div className="table-surface">
          <div className="table-label">
            <span>{label}</span>
            <strong>{view.street}</strong>
          </div>

          <div className="board-area">
            <div className="pot">
              <span>Pot</span>
              <strong>{view.pot.toLocaleString("en-US")}</strong>
            </div>

            <div className="board" aria-label="Community cards">
              <Card value={view.board[0]?.value} />
              <Card value={view.board[1]?.value} />
              <Card value={view.board[2]?.value} />
              <Card value={view.board[3]?.value} />
              <Card value={view.board[4]?.value} />
            </div>
          </div>
        </div>

        {POSITIONS.map((position) => {
          const player = view.players[position];

          return (
            <Seat
              key={position}
              position={position}
              name={position === viewer ? "You" : `Player ${position + 1}`}
              stack={player?.stack}
              bet={player?.bet}
              cards={position === viewer && player ? hole : undefined}
              acting={view.turn === position}
              dealer={view.dealer === position}
              empty={!player}
            />
          );
        })}
      </div>

      <div className="action-bar" aria-label="Player actions">
        <div className="action-copy" aria-live="polite">
          <span>{status}</span>
          <strong>{message}</strong>
        </div>

        <div className="actions">
          <button type="button" onClick={onFold} disabled={disabled || !actions?.fold}>
            Fold
          </button>
          <button type="button" onClick={onCheck} disabled={disabled || !actions?.check}>
            Check
          </button>
          <button
            type="button"
            onClick={onCall}
            disabled={disabled || actions?.call === undefined}
          >
            {actions?.call === undefined
              ? "Call"
              : `Call ${actions.call.toLocaleString("en-US")}`}
          </button>
          <input
            aria-label="Raise to"
            type="number"
            min={range?.min_to}
            max={range?.max_to}
            value={range ? raiseTo : ""}
            onChange={(event) => setRaiseTo(Number(event.target.value))}
            disabled={disabled || !range}
          />
          <button
            className="raise-button"
            type="button"
            onClick={onRaise}
            disabled={disabled || !range}
          >
            Raise
          </button>
          {view.settled && onNewHand && (
            <button
              className="new-hand-button"
              type="button"
              onClick={onNewHand}
              disabled={disabled}
            >
              New hand
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
