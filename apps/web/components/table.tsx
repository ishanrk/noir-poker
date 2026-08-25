import { useEffect, useRef, useState, type CSSProperties } from "react";

import { Card } from "@/components/card";
import {
  ChallengeProofs,
  PrivateChallenge,
  type ContractView,
} from "@/components/contract";
import {
  PreviousDealIntegrity,
  type DealView,
} from "@/components/deal-integrity";
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
  name: string;
  stack: number;
  bet: number;
  folded: boolean;
  challenge_wins: number;
  challenge_score: number;
  challenge_bonus: number;
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
  draw_verified: boolean;
  hand_tag: string;
  commitment: string;
  nonce: string;
  catalog_root: string;
  facts_salt: string;
  facts_hash: string;
  facts: [number, number, number, number, number, number];
  status: "claimable" | "claimed";
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
  total_hands: number;
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
  game_over?: { winners: number[]; chips: number };
  last_action?: ActionNoticeView;
  action_notices?: ActionNoticeView[];
  actions: ActionView | undefined;
  result?: HandResultView;
  ready?: ReadyView;
  finish?: ReadyView;
  settlement?: { status: "pending" | "returned"; final_stack: number };
  challenge?: ChallengeView;
  claim?: ClaimView;
  proofs: PlayerProofView[];
};

export type ActionNoticeView = {
  seq: number;
  player: number;
  action: "fold" | "check" | "call" | "raise_to";
  amount?: number;
};

export type TableNoticeView =
  | ({ kind: "action"; hand_no: number } & ActionNoticeView)
  | {
      kind: "challenge";
      hand_no: number;
      player: number;
      completed: boolean;
    };

type TableProps = {
  view: View;
  viewer: number;
  room: string;
  error?: string;
  disabled?: boolean;
  notice?: TableNoticeView;
  stage?: string;
  finish?: boolean;
  bonusFocus?: boolean;
  bonusApplied?: boolean;
  bonusBase?: number[];
  raiseTo: number;
  setRaiseTo: (to: number) => void;
  onFold: () => void;
  onCheck: () => void;
  onCall: () => void;
  onRaise: () => void;
  onReady: () => void;
  onFinish: () => void;
  contract: ContractView;
  onCommitContract: () => void;
  onVerifyDraw: () => void;
  onGenerateProof: () => void;
  onVerifyProof: (seat: number, hand: number, kind: "draw" | "completion") => void;
};

const POSITIONS = [0, 1, 2, 3, 4, 5] as const;
const PROOF_UI = false;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const challengeScore = (score: number) => score % 10 === 0
  ? String(score / 10)
  : (score / 10).toFixed(1);

function deckStatus(stage: string): [string, string] {
  if (stage.includes("shuffle") || stage.includes("proof") || stage.includes("verifying")) {
    return ["Proving deck randomness", "Checking the encrypted shuffle proof"];
  }
  if (stage.includes("key") || stage.includes("collecting")) {
    return ["Building the encrypted deck", ""];
  }
  if (stage.includes("opening") || stage.includes("decrypting") || stage.includes("cards")) {
    return ["Opening the dealt cards", "Decrypting only the cards now in play"];
  }
  return ["Preparing the next hand", stage];
}

type ActionCopyState = { status: string; message: string; crypto: boolean };

function ActionCopy({ status, message, stage }: {
  status: string;
  message: string;
  stage?: string;
}) {
  const initial = { status, message, crypto: Boolean(stage) };
  const shownRef = useRef<ActionCopyState>(initial);
  const [shown, setShown] = useState(initial);
  const [prior, setPrior] = useState<ActionCopyState>();
  const [moving, setMoving] = useState(false);

  useEffect(() => {
    const next = { status, message, crypto: Boolean(stage) };
    const current = shownRef.current;
    if (
      current.status === next.status &&
      current.message === next.message &&
      current.crypto === next.crypto
    ) return;

    shownRef.current = next;
    setPrior(current);
    setShown(next);
    setMoving(false);
    const frame = window.requestAnimationFrame(() => setMoving(true));
    const timer = window.setTimeout(() => setPrior(undefined), 420);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [message, stage, status]);

  return (
    <div
      className="action-copy"
      data-stage={shown.crypto ? "crypto" : undefined}
      data-moving={moving}
      data-swap={prior ? "true" : "false"}
      aria-live="polite"
    >
      {prior && (
        <div className="action-copy-layer action-copy-prior" aria-hidden="true">
          <span>{prior.status}</span>
          {prior.message && <strong>{prior.message}</strong>}
        </div>
      )}
      <div className="action-copy-layer action-copy-current">
        <span>{shown.status}</span>
        {shown.message && <strong>{shown.message}</strong>}
      </div>
    </div>
  );
}
const playerName = (
  player: number,
  viewer: number,
  mode: RoomMode,
  players?: PlayerView[],
) => player === viewer
  ? "You"
  : mode === "single"
    ? `Bot ${player}`
    : players?.[player]?.name ?? `Player ${player + 1}`;

function Showdown({
  result,
  board,
  viewer,
  mode,
  players,
}: {
  result: HandResultView;
  board: CardView[];
  viewer: number;
  mode: RoomMode;
  players: PlayerView[];
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
                <span>{playerName(seat, viewer, mode, players)}</span>
                <strong>{hand?.name ?? "Best hand"}</strong>
                <b>+{won.toLocaleString("en-US")}</b>
              </div>
              <div className="showdown-hole" aria-label={`${playerName(seat, viewer, mode, players)} cards`}>
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
              <span>{playerName(seat, viewer, mode, players)} · {hand.name}</span>
              <div aria-label={`${playerName(seat, viewer, mode, players)} best five`}>
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
  notice,
  stage,
  finish = false,
  bonusFocus = false,
  bonusApplied = false,
  bonusBase,
  raiseTo,
  setRaiseTo,
  onFold,
  onCheck,
  onCall,
  onRaise,
  onReady,
  onFinish,
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
  const handWinners = result
    ? [...new Set(result.awards.map((award) => award.player))]
    : [];
  const players = view.players.map((player, seat) => ({
    ...player,
    stack: bonusFocus && !bonusApplied && bonusBase?.[seat] !== undefined
      ? bonusBase[seat]
      : player.stack,
  }));
  const leaders = view.players
    .map((player, seat) => ({ ...player, seat }))
    .sort((a, b) => b.challenge_score - a.challenge_score || a.seat - b.seat);
  let status = actions ? "Your turn" : "Waiting";
  let message = actions
    ? "Choose an action"
    : view.turn === undefined
      ? "Waiting"
      : `${playerName(view.turn, viewer, view.mode, view.players)} to act`;
  let noticeName: string | undefined;
  let noticeAction: string | undefined;

  if (view.settled) [status, message] = ["Hand complete", "Pot settled"];
  if (result?.kind === "showdown") status = "Showdown";
  if (stage) [status, message] = deckStatus(stage);
  if (notice) {
    const mine = notice.player === viewer;
    const name = playerName(notice.player, viewer, view.mode, view.players);
    if (notice.kind === "challenge") {
      noticeName = mine ? "Your challenge" : `${name}'s challenge`;
      noticeAction = notice.completed ? "completed" : "missed";
    } else {
      noticeName = name;
      noticeAction = notice.action === "raise_to"
        ? `${mine ? "raise" : "raises"} to ${notice.amount?.toLocaleString("en-US")}`
        : notice.action === "call"
          ? `${mine ? "call" : "calls"} ${notice.amount?.toLocaleString("en-US")}`
          : `${notice.action}${mine ? "" : "s"}`;
    }

    [status, message] = [noticeName, noticeAction];
  }

  return (
    <section
      className={`table-shell${finish ? " table-game-over" : ""}${bonusFocus ? " table-bonus-focus" : ""}`}
      data-room-mode={view.mode}
      aria-label="Six-max poker table"
    >
      {view.mode !== "single" && (
        <aside
          className="challenge-leaderboard"
          aria-label="Challenge leaderboard"
          data-proof-tour="leaderboard"
        >
          <strong>Challenge Leaderboard</strong>
          {bonusFocus && <em>{bonusApplied ? "Bonus chips added" : "Adding bonus chips"}</em>}
          <ol>
            {leaders.map((player) => (
              <li key={player.seat}>
                <span>{playerName(player.seat, viewer, view.mode, view.players)}</span>
                <b>{challengeScore(player.challenge_score)} points</b>
                {player.challenge_bonus > 0 && <small>+{player.challenge_bonus.toLocaleString("en-US")}</small>}
                {bonusFocus && bonusBase?.[player.seat] !== undefined && (
                  <output>
                    {bonusBase[player.seat].toLocaleString("en-US")}
                    {bonusApplied
                      ? ` plus ${player.challenge_bonus.toLocaleString("en-US")} equals ${player.stack.toLocaleString("en-US")}`
                      : " before bonus"}
                  </output>
                )}
              </li>
            ))}
          </ol>
        </aside>
      )}
      <div className="table-hand-count">Hand {view.hand_no + 1} of {view.total_hands}</div>
      {view.hand_no > 0 && <PreviousDealIntegrity room={room} hand={view.hand_no - 1} />}

      {PROOF_UI && (
        <PrivateChallenge
          view={contract}
          disabled={disabled}
          showProofs
          onCommit={onCommitContract}
          onDraw={onVerifyDraw}
          onClaim={onGenerateProof}
        />
      )}

      <div className="table-stage">
        {notice && noticeName && noticeAction && (
          <div
            key={notice.kind === "action"
              ? `${notice.hand_no}:${notice.seq}`
              : `challenge:${notice.hand_no}:${notice.player}`}
            className={`table-action-notice${notice.kind === "challenge" ? " table-challenge-notice" : ""}`}
            data-hand={notice.hand_no}
            data-seq={notice.kind === "action" ? notice.seq : undefined}
            role="status"
            aria-live="polite"
          >
            <strong>{noticeName}</strong>
            <span>{noticeAction}</span>
          </div>
        )}
        <div className="table-surface">
          <div className="table-watermark" aria-hidden="true">
            NP
          </div>
          <div className={`board-area${result?.kind === "showdown" ? " board-area-showdown" : ""}`}>
            {handWinners.length > 0 && (
              <span className="hand-winner">
                {handWinners
                  .map((seat) => playerName(seat, viewer, view.mode, view.players))
                  .join(" and ")}
                {handWinners.length > 1 || handWinners[0] === viewer ? " win" : " wins"}
              </span>
            )}
            <div className="pot">
              <span>Pot</span>
              <strong>{view.pot.toLocaleString("en-US")}</strong>
            </div>
            {result?.kind === "showdown" ? (
              <Showdown
                result={result}
                board={view.board}
                viewer={viewer}
                mode={view.mode}
                players={view.players}
              />
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
          const player = players[position];
          const revealed = result?.revealed[position];
          const out = !!player && player.folded && player.stack === 0;
          const cards =
            position === viewer && !out
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
              name={playerName(position, viewer, view.mode, view.players)}
              stack={player?.stack}
              bet={player?.bet}
              cards={player ? cards : undefined}
              awards={total === undefined ? undefined : [total]}
              acting={view.turn === position}
              dealer={view.dealer === position}
              out={out}
              empty={!player}
            />
          );
        })}

        {finish && view.game_over && (
          <div className="game-finish" role="status" aria-live="polite">
            <span>Game Complete</span>
            <strong>
              {view.game_over.winners
                .map((seat) => playerName(seat, viewer, view.mode, view.players))
                .join(" and ")}
              {view.game_over.winners.length > 1
                ? " tie"
                : view.game_over.winners[0] === viewer
                  ? " win"
                  : " wins"}
            </strong>
          </div>
        )}
      </div>

      {view.mode === "aztec" && view.settlement && (
        <div className="aztec-settlement" role="status" aria-live="polite">
          <span>
            {view.settlement.status === "returned"
              ? "Tajaderos Returned"
              : "Settling Tajaderos"}
          </span>
          <strong>Final Stack {view.settlement.final_stack.toLocaleString("en-US")}</strong>
        </div>
      )}

      <div className="action-bar" aria-label="Player actions" aria-busy={disabled}>
        <ActionCopy status={status} message={message} stage={stage} />
        <div className="action-controls">
          <div className="plain-actions">
            <button className="key-action key-fold" type="button" onClick={onFold} disabled={disabled || !actions?.fold}>
              <Keycap>Fold</Keycap>
            </button>
            <button className="key-action key-check" type="button" onClick={onCheck} disabled={disabled || !actions?.check}>
              <Keycap>Check</Keycap>
            </button>
            <button className="key-action key-call" type="button" onClick={onCall} disabled={disabled || actions?.call === undefined}>
              <Keycap>
                {actions?.call === undefined ? "Call" : `Call ${actions.call.toLocaleString("en-US")}`}
              </Keycap>
            </button>
          </div>

          <div className="raise-control" data-disabled={disabled || !range}>
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
              disabled={disabled || !range}
              style={{ "--range-pos": `${rangePos}%` } as CSSProperties}
            />
            <div className="raise-presets">
              <button className="key-action key-small" type="button" onClick={() => range && setRaiseTo(range.min_to)} disabled={disabled || !range}><Keycap>Min</Keycap></button>
              <button className="key-action key-small" type="button" onClick={() => setRaiseTo(halfPotTarget)} disabled={disabled || !range}><Keycap>½ Pot</Keycap></button>
              <button className="key-action key-small" type="button" onClick={() => setRaiseTo(potTarget)} disabled={disabled || !range}><Keycap>Pot</Keycap></button>
              <button className="key-action key-small" type="button" onClick={() => range && setRaiseTo(range.max_to)} disabled={disabled || !range}><Keycap>All In</Keycap></button>
            </div>
            <button className="raise-submit key-action key-primary" type="button" onClick={onRaise} disabled={disabled || !range}>
              <Keycap>Raise</Keycap>
            </button>
          </div>

          {error && <p className="form-error" role="alert">{error}</p>}

          {view.settled && !view.game_over && view.ready && (
            <button
              className="next-hand-action key-action key-primary key-space"
              type="button"
              onClick={onReady}
              disabled={
                disabled ||
                view.ready.mine ||
                view.ready.complete ||
                (view.mode !== "single" && !view.challenge?.assigned)
              }
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
          {view.settled && !view.game_over && view.finish && (
            <button
              className="next-hand-action key-action key-primary key-space"
              type="button"
              onClick={onFinish}
              disabled={disabled || view.finish.mine || view.finish.complete}
            >
              <Keycap wide>
                {view.finish.mine
                  ? `Finished ${view.finish.count}/${view.finish.players}`
                  : "Finish Game"}
              </Keycap>
            </button>
          )}
        </div>
      </div>

      {PROOF_UI && (
        <ChallengeProofs
          proofs={contract.proofs}
          disabled={disabled}
          onVerify={onVerifyProof}
        />
      )}
    </section>
  );
}
