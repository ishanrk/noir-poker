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

export type View = {
  players: PlayerView[];
  hole: [CardView, CardView];
  board: CardView[];
  pot: number;
  dealer: number;
  turn: number | undefined;
  street: string;
  round_complete: boolean;
};

type TableProps = {
  view: View;
};

const POSITIONS = [0, 1, 2, 3, 4, 5] as const;

export function Table({ view }: TableProps) {
  const hole = [view.hole[0].value, view.hole[1].value] as const;

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
        <div className="action-copy">
          <span>Read only</span>
          <strong>Actions unavailable</strong>
        </div>

        <div className="actions">
          <button type="button" disabled>
            Fold
          </button>
          <button type="button" disabled>
            Check
          </button>
          <button type="button" disabled>
            Call
          </button>
          <button className="raise-button" type="button" disabled>
            Raise
          </button>
        </div>
      </div>
    </section>
  );
}
