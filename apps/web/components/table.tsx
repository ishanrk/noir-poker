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
  error?: string;
  raiseTo: number;
  setRaiseTo: (to: number) => void;
  onFold: () => void;
  onCheck: () => void;
  onCall: () => void;
  onRaise: () => void;
  onNewHand: () => void;
};

const POSITIONS = [0, 1, 2, 3, 4, 5] as const;

export function Table({
  view,
  error,
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

  return (
    <section className="table-shell" aria-label="Six-max poker table">
      <div className="table-stage">
        <div className="table-surface">
          <div className="table-label">
            <span>Local game</span>
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
              name={position === 0 ? "You" : `Player ${position + 1}`}
              stack={player?.stack}
              bet={player?.bet}
              cards={position === 0 && player ? hole : undefined}
              acting={view.turn === position}
              dealer={view.dealer === position}
              empty={!player}
            />
          );
        })}
      </div>

      <div className="action-bar" aria-label="Player actions">
        <div className="action-copy" aria-live="polite">
          <span>{error ? "Error" : view.settled ? "Complete" : "Your action"}</span>
          <strong>{error ?? (view.settled ? "Hand complete" : "Choose an action")}</strong>
        </div>

        <div className="actions">
          <button type="button" onClick={onFold} disabled={!actions?.fold}>
            Fold
          </button>
          <button type="button" onClick={onCheck} disabled={!actions?.check}>
            Check
          </button>
          <button type="button" onClick={onCall} disabled={actions?.call === undefined}>
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
            disabled={!range}
          />
          <button className="raise-button" type="button" onClick={onRaise} disabled={!range}>
            Raise
          </button>
          {view.settled && (
            <button className="new-hand-button" type="button" onClick={onNewHand}>
              New hand
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
