import type { CSSProperties } from "react";

import { Card } from "@/components/card";
import {
  ChallengeProofs,
  PrivateChallenge,
  type ContractView,
} from "@/components/contract";
import { DealIntegrity, type DealView } from "@/components/deal-integrity";
import { Keycap } from "@/components/keycap";
import { Seat } from "@/components/seat";
import { bestHand } from "@/lib/poker-hand";
import type { RoomMode } from "@/lib/server";

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
export type ProofMetaView = { hand_no: number; published: boolean; nullifier?: string };
export type PlayerProofView = {
  seat: number;
  draw?: ProofMetaView;
  completion?: ProofMetaView;
};
export type View = {
  mode: RoomMode;
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
  proofs: PlayerProofView[];
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
  onVerifyProof: (seat: number, hand: number, kind: "draw" | "completion") => void;
};

const POSITIONS = [0, 1, 2, 3, 4, 5] as const;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const playerName = (player: number, viewer: number, mode: RoomMode) =>
  player === viewer ? "You" : mode === "single" ? `Bot ${player}` : `Player ${player + 1}`;

function Showdown({
  result,
  board,
  viewer,
  mode,
}: {
  result: HandResultView;
  board: CardView[];
  viewer: number;
  mode: RoomMode;
}) {
  const boardCards = board.map((card) => card.value);
  const hands = result.revealed.map((cards) =>
    cards ? bestHand([cards[0].value, cards[1].value, ...boardCards]) : undefined,
  );
  const winners = [...new Set(result.awards.map((award) => award.player))];
  const mine = hands[viewer];

  return (
    <div className="showdown-stage" aria-label="Showdown result">
      <div className="showdown-winners">
        {winners.map((seat, index) => {
          const cards = result.revealed[seat];
          const hand = hands[seat];
          const won = result.awards
            .filter((award) => award.player === seat)
            .reduce((sum, award) => sum + award.amount, 0);

          if (!cards) return null;

          return (
            <article
              className="showdown-winner"
              key={seat}
              style={{ "--show-delay": `${index * 120}ms` } as CSSProperties}
            >
              <div className="showdown-winner-copy">
                <span>{playerName(seat, viewer, mode)}</span>
                <strong>{hand?.name ?? "Best hand"}</strong>
                <b>+{won.toLocaleString("en-US")}</b>
              </div>
              <div className="showdown-hole" aria-label={`${playerName(seat, viewer, mode)} cards`}>
                <Card value={cards[0].value} delay={index * 120} />
                <Card value={cards[1].value} delay={index * 120 + 80} />
              </div>
            </article>
          );
        })}
      </div>

      <div className="board showdown-board" aria-label="Community cards">
        {[0, 1, 2, 3, 4].map((index) => (
          <Card key={index} value={board[index]?.value} delay={index * 90} />
        ))}
      </div>

      <div className="showdown-best">
        {winners.map((seat) => {
          const hand = hands[seat];
          if (!hand) return null;

          return (
            <div key={seat}>
              <span>{playerName(seat, viewer, mode)} · {hand.name}</span>
              <div aria-label={`${playerName(seat, viewer, mode)} best five`}>
                {hand.cards.map((value, index) => (
                  <Card key={`${seat}-${value}-${index}`} value={value} delay={320 + index * 70} />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {mine && (
        <div className="showdown-you">
          <span>Your hand</span>
          <strong>{mine.name}</strong>
        </div>
      )}
    </div>
  );
}

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
  onVerifyProof,
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
  const rangePos = range && range.max_to > range.min_to
    ? ((raiseTo - range.min_to) / (range.max_to - range.min_to)) * 100
    : 0;
  let status = actions ? "Your turn" : "Waiting";
  let message = actions
    ? "Choose an action"
    : view.turn === undefined
      ? "Waiting"
      : `${playerName(view.turn, viewer, view.mode)} to act`;

  if (view.settled) [status, message] = ["Hand complete", "Pot settled"];
  if (result?.kind === "showdown") status = "Showdown";

  return (
    <section className="table-shell" aria-label="Six-max poker table">
      {view.deal && <DealIntegrity deal={view.deal} room={room} compact />}

      <PrivateChallenge
        view={contract}
        disabled={disabled}
        onCommit={onCommitContract}
        onDraw={onVerifyDraw}
        onClaim={onGenerateProof}
      />

      <div className="table-stage">
        <div className="table-surface">
          <div className="table-watermark" aria-hidden="true">
            NP
          </div>
          <div className={`board-area${result?.kind === "showdown" ? " board-area-showdown" : ""}`}>
            <div className="pot">
              <span>Pot</span>
              <strong>{view.pot.toLocaleString("en-US")}</strong>
            </div>
            {result?.kind === "showdown" ? (
              <Showdown result={result} board={view.board} viewer={viewer} mode={view.mode} />
            ) : (
              <div className="board" aria-label="Community cards">
                {[0, 1, 2, 3, 4].map((index) => (
                  <Card key={index} value={view.board[index]?.value} delay={index * 180} />
                ))}
              </div>
            )}
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
          const total = awards?.length ? awards.reduce((sum, amount) => sum + amount, 0) : undefined;

          return (
            <Seat
              key={position}
              position={position}
              name={playerName(position, viewer, view.mode)}
              stack={player?.stack}
              bet={player?.bet}
              proofPoints={player?.proof_points}
              cards={player ? cards : undefined}
              awards={total === undefined ? undefined : [total]}
              acting={view.turn === position}
              dealer={view.dealer === position}
              empty={!player}
            />
          );
        })}
      </div>

      <div className="action-bar" aria-label="Player actions" aria-busy={disabled}>
        <div className="action-copy" aria-live="polite">
          <span>{status}</span>
          <strong>{message}</strong>
        </div>
        <div className="action-controls">
          <div className="plain-actions">
            <button className="key-action key-fold" type="button" onClick={onFold} disabled={!actions?.fold}>
              <Keycap>Fold</Keycap>
            </button>
            <button className="key-action key-check" type="button" onClick={onCheck} disabled={!actions?.check}>
              <Keycap>Check</Keycap>
            </button>
            <button className="key-action key-call" type="button" onClick={onCall} disabled={actions?.call === undefined}>
              <Keycap>
                {actions?.call === undefined ? "Call" : `Call ${actions.call.toLocaleString("en-US")}`}
              </Keycap>
            </button>
          </div>

          <div className="raise-control" data-disabled={!range}>
            <div className="raise-heading">
              <span>Raise</span>
              <output>{range ? raiseTo.toLocaleString("en-US") : "—"}</output>
            </div>
            <input
              aria-label="Raise target"
              type="range"
              min={range?.min_to ?? 0}
              max={range?.max_to ?? 1}
              value={range ? raiseTo : 0}
              onChange={(event) => setRaiseTo(Number(event.target.value))}
              disabled={!range}
              style={{ "--range-pos": `${rangePos}%` } as CSSProperties}
            />
            <div className="raise-presets">
              <button className="key-action key-small" type="button" onClick={() => range && setRaiseTo(range.min_to)} disabled={!range}><Keycap>Min</Keycap></button>
              <button className="key-action key-small" type="button" onClick={() => setRaiseTo(halfPotTarget)} disabled={!range}><Keycap>½ Pot</Keycap></button>
              <button className="key-action key-small" type="button" onClick={() => setRaiseTo(potTarget)} disabled={!range}><Keycap>Pot</Keycap></button>
              <button className="key-action key-small" type="button" onClick={() => range && setRaiseTo(range.max_to)} disabled={!range}><Keycap>All In</Keycap></button>
            </div>
            <button className="raise-submit key-action key-primary" type="button" onClick={onRaise} disabled={!range}>
              <Keycap>Raise</Keycap>
            </button>
          </div>

          {error && <p className="form-error" role="alert">{error}</p>}

          {view.settled && view.ready && (
            <button
              className="next-hand-action key-action key-primary key-space"
              type="button"
              onClick={onReady}
              disabled={disabled || view.ready.mine || view.ready.complete || !view.challenge?.assigned}
            >
              <Keycap wide>
                {view.ready.complete
                  ? "Table Complete"
                  : view.ready.mine
                    ? `Ready ${view.ready.count}/${view.ready.players}`
                    : "Ready for Next Hand"}
              </Keycap>
            </button>
          )}
        </div>
      </div>

      {view.next_deal && <DealIntegrity deal={view.next_deal} room={room} />}
      <ChallengeProofs
        proofs={contract.proofs}
        disabled={disabled}
        onVerify={onVerifyProof}
      />
    </section>
  );
}
