import { Card } from "@/components/card";
import { Contract, type ContractView } from "@/components/contract";
import { Seat } from "@/components/seat";

type CardView = {
  value: string;
};

export type AwardView = {
  player: number;
  amount: number;
};

export type HandResultView = {
  kind: "fold" | "showdown";
  awards: AwardView[];
  revealed: Array<[CardView, CardView] | null | undefined>;
};

type PlayerView = {
  stack: number;
  bet: number;
  folded: boolean;
  proof_points?: number;
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

type ReadyView = {
  mine: boolean;
  count: number;
  players: number;
  complete: boolean;
};

export type ChallengeView = {
  hand_no: number;
  assigned: boolean;
  hand_tag: string;
  tier?: number;
  commitment?: string;
  nonce?: string;
  catalog_root?: string;
};

export type ClaimView = {
  hand_no: number;
  hand_tag: string;
  tier: number;
  commitment: string;
  nonce: string;
  catalog_root: string;
  facts_hash: string;
  facts: [number, number, number, number, number, number];
  status: "claimable" | "claimed";
  points?: number;
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
  result?: HandResultView;
  ready?: ReadyView;
  challenge?: ChallengeView;
  claim?: ClaimView;
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
  onReady?: () => void;
  contract?: ContractView;
  onChooseContract?: (tier: number) => void;
  onGenerateProof?: () => void;
};

const POSITIONS = [0, 1, 2, 3, 4, 5] as const;

function playerName(player: number, viewer: number) {
  return player === viewer ? "You" : `Player ${player + 1}`;
}

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
  onReady,
  contract,
  onChooseContract,
  onGenerateProof,
}: TableProps) {
  const hole = [view.hole[0].value, view.hole[1].value] as const;
  const actions = view.actions;
  const range = actions?.raise;
  const result = view.result;
  const payouts = result?.awards
    .map(
      (award) =>
        `${playerName(award.player, viewer)} ${result.kind === "fold" ? "won " : ""}${award.amount.toLocaleString("en-US")}`,
    )
    .join(" · ");
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
    message = view.ready?.complete ? "Table complete" : "Hand complete";
  }

  if (result?.kind === "fold") {
    status = "Hand ended";
    message = payouts ?? "Payout complete";
  }

  if (result?.kind === "showdown") {
    status = "Showdown";
    message = payouts ? `Payouts ${payouts}` : "Payout complete";
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
          const revealed = result?.revealed[position];
          const cards =
            position === viewer
              ? hole
              : revealed
                ? ([revealed[0].value, revealed[1].value] as const)
                : undefined;
          const awards = result?.awards
            .filter((award) => award.player === position)
            .map((award) => award.amount);

          return (
            <Seat
              key={position}
              position={position}
              name={playerName(position, viewer)}
              stack={player?.stack}
              bet={player?.bet}
              proofPoints={player?.proof_points}
              cards={player ? cards : undefined}
              awards={awards}
              acting={view.turn === position}
              dealer={view.dealer === position}
              empty={!player}
            />
          );
        })}
      </div>

      {contract && onChooseContract && onGenerateProof && (
        <Contract
          view={contract}
          disabled={disabled}
          onChoose={onChooseContract}
          onProve={onGenerateProof}
        />
      )}

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
          {view.settled && onReady && view.ready && (
            <button
              className="new-hand-button"
              type="button"
              onClick={onReady}
              disabled={
                disabled ||
                view.ready.mine ||
                view.ready.complete ||
                !view.challenge?.assigned
              }
            >
              {view.ready.complete
                ? "Table complete"
                : `Ready ${view.ready.count}/${view.ready.players}`}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
