import { Card } from "@/components/card";
import { Contract, type ContractView } from "@/components/contract";
import { DealIntegrity, type DealView } from "@/components/deal-integrity";
import { Seat } from "@/components/seat";

type CardView = { value: string };
export type AwardView = { player: number; amount: number };
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
  raise: { min_to: number; max_to: number } | undefined;
};
type ReadyView = { mine: boolean; count: number; players: number; complete: boolean };
export type ChallengeView = {
  hand_no: number;
  assigned: boolean;
  draw_verified: boolean;
  hand_tag: string;
  commitment?: string;
  nonce?: string;
  catalog_root?: string;
};
export type ClaimView = {
  hand_no: number;
  hand_tag: string;
  commitment: string;
  nonce: string;
  catalog_root: string;
  facts_salt: string;
  facts_hash: string;
  facts: [number, number, number, number, number, number];
  status: "claimable" | "claimed";
  points?: number;
  nullifier?: string;
};
export type View = {
  players: PlayerView[];
  hand_no: number;
  deal?: DealView;
  next_deal?: DealView;
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
  room: string;
  error?: string;
  disabled?: boolean;
  raiseTo: number;
  setRaiseTo: (to: number) => void;
  onFold: () => void;
  onCheck: () => void;
  onCall: () => void;
  onRaise: () => void;
  onReady: () => void;
  contract: ContractView;
  onCommitContract: () => void;
  onVerifyDraw: () => void;
  onGenerateProof: () => void;
};

const POSITIONS = [0, 1, 2, 3, 4, 5] as const;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const playerName = (player: number, viewer: number) => (player === viewer ? "You" : `Player ${player + 1}`);

export function Table({
  view,
  viewer,
  room,
  error,
  disabled = false,
  raiseTo,
  setRaiseTo,
  onFold,
  onCheck,
  onCall,
  onRaise,
  onReady,
  contract,
  onCommitContract,
  onVerifyDraw,
  onGenerateProof,
}: TableProps) {
  const hole = [view.hole[0].value, view.hole[1].value] as const;
  const actions = view.actions;
  const range = actions?.raise;
  const result = view.result;
  const myBet = view.players[viewer]?.bet ?? 0;
  const currentBet = myBet + (actions?.call ?? 0);
  const potTarget = range
    ? clamp(currentBet + view.pot + (actions?.call ?? 0), range.min_to, range.max_to)
    : 0;
  const halfPotTarget = range
    ? clamp(currentBet + Math.round((view.pot + (actions?.call ?? 0)) / 2), range.min_to, range.max_to)
    : 0;
  const payouts = result?.awards
    .map((award) => `${playerName(award.player, viewer)} +${award.amount.toLocaleString("en-US")}`)
    .join(" · ");
  let status = actions ? "Your action" : "Waiting for player";
  let message = actions ? "Choose the line" : "The table is moving";

  if (disabled) [status, message] = ["Waiting", "Server confirmation pending"];
  if (view.settled) [status, message] = ["Hand complete", payouts ?? "Payout settled"];
  if (result?.kind === "showdown") status = "Showdown";
  if (error) [status, message] = ["Error", error];

  return (
    <section className="table-shell" aria-label="Six-max poker table">
      {view.deal && <DealIntegrity deal={view.deal} room={room} compact />}

      <div className="table-stage">
        <div className="table-surface">
          <div className="table-watermark" aria-hidden="true">
            NP
          </div>
          <div className="board-area">
            <div className="pot">
              <span>Pot</span>
              <strong>{view.pot.toLocaleString("en-US")}</strong>
            </div>
            <div className="board" aria-label="Community cards">
              {[0, 1, 2, 3, 4].map((index) => (
                <Card key={index} value={view.board[index]?.value} delay={index * 120} />
              ))}
            </div>
            <span className="street-label">{view.street}</span>
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

      <div className="action-bar" aria-label="Player actions">
        <div className="action-copy" aria-live="polite">
          <span>{status}</span>
          <strong>{message}</strong>
        </div>
        <div className="action-controls">
          <div className="plain-actions">
            <button type="button" onClick={onFold} disabled={disabled || !actions?.fold}>Fold</button>
            <button type="button" onClick={onCheck} disabled={disabled || !actions?.check}>Check</button>
            <button type="button" onClick={onCall} disabled={disabled || actions?.call === undefined}>
              {actions?.call === undefined ? "Call" : `Call ${actions.call.toLocaleString("en-US")}`}
            </button>
          </div>

          <div className="raise-control" data-disabled={!range || disabled}>
            <div className="raise-heading">
              <span>Raise to</span>
              <output>{range ? raiseTo.toLocaleString("en-US") : "—"}</output>
            </div>
            <input
              aria-label="Raise target"
              type="range"
              min={range?.min_to ?? 0}
              max={range?.max_to ?? 1}
              value={range ? raiseTo : 0}
              onChange={(event) => setRaiseTo(Number(event.target.value))}
              disabled={disabled || !range}
            />
            <div className="raise-presets">
              <button type="button" onClick={() => range && setRaiseTo(range.min_to)} disabled={disabled || !range}>Min</button>
              <button type="button" onClick={() => setRaiseTo(halfPotTarget)} disabled={disabled || !range}>½ pot</button>
              <button type="button" onClick={() => setRaiseTo(potTarget)} disabled={disabled || !range}>Pot</button>
              <button type="button" onClick={() => range && setRaiseTo(range.max_to)} disabled={disabled || !range}>All in</button>
            </div>
            <button className="raise-submit" type="button" onClick={onRaise} disabled={disabled || !range}>
              Raise →
            </button>
          </div>

          {view.settled && view.ready && (
            <button
              className="next-hand-action"
              type="button"
              onClick={onReady}
              disabled={disabled || view.ready.mine || view.ready.complete || !view.challenge?.draw_verified}
            >
              {view.ready.complete
                ? "Table complete"
                : view.ready.mine
                  ? `Entropy added ${view.ready.count}/${view.ready.players}`
                  : "Add entropy & ready →"}
            </button>
          )}
        </div>
      </div>

      {view.next_deal && <DealIntegrity deal={view.next_deal} room={room} />}
      <Contract
        view={contract}
        disabled={disabled}
        onCommit={onCommitContract}
        onVerifyDraw={onVerifyDraw}
        onProve={onGenerateProof}
      />
    </section>
  );
}
