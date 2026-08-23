"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import type { ContractView, LocalProofState, ProofState } from "@/components/contract";
import type { DealView } from "@/components/deal-integrity";
import { Keycap } from "@/components/keycap";
import { PlayProofs } from "@/components/play-proofs";
import { PrivateChallengeBar } from "@/components/private-challenge";
import { ProofTour } from "@/components/proof-tour";
import { Table, type ActionNoticeView, type ChallengeView, type ClaimView, type View } from "@/components/table";
import {
  CHALLENGE_VERSION,
  catalogRoot,
  commitment as challengeCommitment,
  decodeHex,
  encodeHex,
  factsHash,
  loadChallengeSecret,
  leafHash,
  nullifier as challengeNullifier,
  objectiveAt,
  objectiveIndex,
  objectiveMet,
  objectivePath,
  pathRoot,
  saveChallengeSecret,
} from "@/lib/challenge";
import { proveChallenge, type ProofStatus } from "@/lib/challenge-proof";
import { verifyPublishedProof } from "@/lib/receipt";
import {
  bytes as deckBytes,
  decryptionShare,
  hex as deckHex,
  keyPayload,
  keyProof,
  openCard,
  publicKey,
  randomScalar,
  shuffleDeck,
  transcriptNext,
  validScalar,
  verifyKey,
  verifyShare,
  type CipherValue,
  type PointValue,
  type ShareProof,
} from "@/lib/deck-crypto";
import { proveShuffle } from "@/lib/deck-proof";
import { cardValue } from "@/lib/deal";
import {
  freshEntropy,
  loadPublishedProof,
  loadSeat,
  type ProofKind,
  type RoomMode,
  type RoomSeat,
  roomSocket,
} from "@/lib/server";

type Waiting = { joined: number; players: number; mode: RoomMode; deal?: DealView };
type ServerMessage =
  | ({ type: "waiting" } & Waiting)
  | ({ type: "waiting_fair" } & Waiting & { deal: DealView })
  | { type: "snapshot"; rev: number; view: View }
  | { type: "proof_accepted"; hand_no: number; kind: ProofKind }
  | { type: "proof_error"; hand_no: number; kind: ProofKind; message: string }
  | { type: "error"; message: string }
  | { type: "deck_wait"; hand_no: number; stage: string }
  | { type: "deck_key"; hand_no: number; start: string; context: string; keys: Array<{ seat?: number; key: PointValue; proof: ShareProof }> }
  | { type: "deck_shuffle"; hand_no: number; participant: number; context: string; key: PointValue; deck: CipherValue[] }
  | { type: "deck_shares"; hand_no: number; context: string; deck: CipherValue[]; positions: number[] }
  | { type: "deck_private"; hand_no: number; context: string; keys: PointValue[]; cards: Array<{ position: number; card: CipherValue; shares: Array<{ participant: number; position: number; context: string; value: PointValue; proof: ShareProof }> }> }
  | { type: "deck_open"; hand_no: number };
type ClientAction =
  | { type: "fold" }
  | { type: "check" }
  | { type: "call" }
  | { type: "raise_to"; to: number }
  | { type: "challenge_commit"; hand_no: number; commitment: string }
  | { type: "challenge_draw"; hand_no: number; proof: string; public_inputs: string }
  | { type: "challenge_claim"; hand_no: number; proof: string; public_inputs: string }
  | { type: "ready"; entropy: string }
  | { type: "finish" }
  | { type: "deal_entropy"; entropy: string }
  | { type: "deck_key"; hand_no: number; key: PointValue; proof: ShareProof }
  | { type: "deck_shuffle"; hand_no: number; context: string; output: CipherValue[]; proof: string; public_inputs: string }
  | { type: "deck_shares"; hand_no: number; context: string; shares: Array<{ participant: number; position: number; context: string; value: PointValue; proof: ShareProof }> }
  | { type: "deck_private_ready"; hand_no: number }
  | { type: "deck_open"; hand_no: number; secret: string };
type Assignment = {
  hand_no: number;
  hand_tag: string;
  commitment: string;
  nonce: string;
  catalog_root: string;
  draw_verified: boolean;
};
type PrivateObjective = { objective?: string; index?: number; error?: string };
type ContractCompletion = { completed?: boolean; error?: string };

const proofKey = (seat: number, hand: number, kind: ProofKind) => `${seat}:${hand}:${kind}`;
const deckSecretKey = (room: string, hand: number) => `noir-poker-deck-${room}-${hand}`;
const deckHoleKey = (room: string, hand: number, seat: number) =>
  `noir-poker-hole-${room}-${hand}-${seat}`;
const MAX_AUTO_PROOF_DELAY_MS = 10_000;
const GAME_OVER_DELAY_MS = 3000;
const GAME_OVER_DISPLAY_MS = 2000;

function deckSecret(room: string, hand: number) {
  const key = deckSecretKey(room, hand);
  const stored = sessionStorage.getItem(key);
  if (stored && validScalar(stored)) return stored;
  const secret = randomScalar();
  sessionStorage.setItem(key, secret);
  return secret;
}

function saveDeckHole(room: string, hand: number, seat: number, cards: [string, string]) {
  sessionStorage.setItem(deckHoleKey(room, hand, seat), JSON.stringify(cards));
}

function loadDeckHole(room: string, hand: number, seat: number) {
  const stored = sessionStorage.getItem(deckHoleKey(room, hand, seat));
  if (!stored) return undefined;

  try {
    const cards = JSON.parse(stored) as unknown;
    if (
      Array.isArray(cards) &&
      cards.length === 2 &&
      cards.every((card) => typeof card === "string" && card.length > 0)
    ) {
      return { hand, cards: [cards[0], cards[1]] as [string, string] };
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function challengeAssignment(challenge: ChallengeView | undefined): Assignment | undefined {
  if (
    challenge?.assigned &&
    challenge.commitment !== undefined &&
    challenge.nonce !== undefined &&
    challenge.catalog_root !== undefined
  ) {
    return {
      hand_no: challenge.hand_no,
      hand_tag: challenge.hand_tag,
      commitment: challenge.commitment,
      nonce: challenge.nonce,
      catalog_root: challenge.catalog_root,
      draw_verified: challenge.draw_verified,
    };
  }
  return undefined;
}

function claimAssignment(claim: ClaimView | undefined): Assignment | undefined {
  return claim
    ? {
        hand_no: claim.hand_no,
        hand_tag: claim.hand_tag,
        commitment: claim.commitment,
        nonce: claim.nonce,
        catalog_root: claim.catalog_root,
        draw_verified: claim.draw_verified,
      }
    : undefined;
}

function privateObjective(room: string, seat: number, assignment: Assignment | undefined): PrivateObjective {
  if (!assignment) return {};
  const stored = loadChallengeSecret(room, assignment.hand_no, seat);
  if (!stored) return { error: "Draw secret unavailable" };

  try {
    const secret = decodeHex(stored.secret);
    const handTag = decodeHex(assignment.hand_tag);
    const expected = encodeHex(challengeCommitment(handTag, seat, secret));

    if (encodeHex(catalogRoot()) !== assignment.catalog_root) return { error: "Catalog root mismatch" };
    if (stored.commitment !== assignment.commitment || expected !== assignment.commitment) {
      return { error: "Commitment mismatch" };
    }

    const index = objectiveIndex(handTag, seat, decodeHex(assignment.nonce), secret);
    return { objective: objectiveAt(index).description, index };
  } catch {
    return { error: "Invalid draw assignment" };
  }
}

function contractCompletion(claim: ClaimView | undefined, seat: number, index: number | undefined): ContractCompletion {
  if (!claim || claim.status === "claimed" || index === undefined) return {};

  try {
    const hash = encodeHex(factsHash(decodeHex(claim.hand_tag), seat, decodeHex(claim.facts_salt), claim.facts));
    if (hash !== claim.facts_hash) return { error: "Facts commitment mismatch" };
    return { completed: objectiveMet(objectiveAt(index), claim.facts) };
  } catch {
    return { error: "Invalid hand facts" };
  }
}

function closeSocket(socket: WebSocket) {
  socket.onopen = null;
  socket.onmessage = null;
  socket.onerror = null;
  socket.onclose = null;
  if (socket.readyState < WebSocket.CLOSING) socket.close();
}

function challengeCommit(room: string, seat: number, challenge: ChallengeView): ClientAction {
  const stored = loadChallengeSecret(room, challenge.hand_no, seat);
  const secret = stored ? decodeHex(stored.secret) : crypto.getRandomValues(new Uint8Array(32));
  const value = encodeHex(challengeCommitment(decodeHex(challenge.hand_tag), seat, secret));

  if (stored && stored.commitment !== value) throw new Error("challenge mismatch");
  if (!stored) {
    saveChallengeSecret(room, challenge.hand_no, seat, {
      version: CHALLENGE_VERSION,
      secret: encodeHex(secret),
      commitment: value,
    });
  }

  return { type: "challenge_commit", hand_no: challenge.hand_no, commitment: value };
}

export function MultiplayerGame({ room }: { room: string }) {
  const router = useRouter();
  const socket = useRef<WebSocket | undefined>(undefined);
  const auth = useRef<RoomSeat | undefined>(undefined);
  const rev = useRef(-1);
  const drawing = useRef<number | undefined>(undefined);
  const claiming = useRef<number | undefined>(undefined);
  const dealing = useRef(false);
  const deckBusy = useRef(false);
  const deckActive = useRef(false);
  const deckRequests = useRef(new Set<string>());
  const localHole = useRef<{ hand: number; cards: [string, string] } | undefined>(undefined);
  const seenAction = useRef<{ hand: number; seq: number } | undefined>(undefined);
  const viewRef = useRef<View | undefined>(undefined);
  const actionWait = useRef<{ hand: number; seq: number } | undefined>(undefined);
  const readyWait = useRef<number | undefined>(undefined);
  const actionBusy = useRef(false);
  const verifyingProofs = useRef(new Set<string>());
  const syncing = useRef(true);
  const raiseContext = useRef<string | undefined>(undefined);
  const [seat, setSeat] = useState<number | null>();
  const [waiting, setWaiting] = useState<Waiting>();
  const [view, setView] = useState<View>();
  const [error, setError] = useState<string>();
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const [raiseTo, setRaiseTo] = useState(0);
  const [objective, setObjective] = useState<string>();
  const [claimObjective, setClaimObjective] = useState<string>();
  const [claimCompleted, setClaimCompleted] = useState<boolean>();
  const [challengeError, setChallengeError] = useState<string>();
  const [drawStates, setDrawStates] = useState<Record<number, ProofState>>({});
  const [claimStates, setClaimStates] = useState<Record<number, ProofState>>({});
  const [drawJobs, setDrawJobs] = useState<Record<number, Assignment>>({});
  const [claimJobs, setClaimJobs] = useState<Record<number, ClaimView>>({});
  const [autoAttempts, setAutoAttempts] = useState<Record<string, number>>({});
  const [localProofs, setLocalProofs] = useState<Record<string, LocalProofState>>({});
  const [notices, setNotices] = useState<ActionNoticeView[]>([]);
  const noticeQueue = useRef<ActionNoticeView[]>([]);
  const [deckStage, setDeckStage] = useState<string>();
  const [finishHand, setFinishHand] = useState<number>();
  const [tourState, setTourState] = useState<{ handNo: number; open: boolean }>();
  const notice = notices[0];
  const gameReady = Boolean(
    view?.game_over &&
    !notice &&
    !deckStage &&
    (view.deal === undefined || view.deal.audit),
  );
  const finish = gameReady && finishHand === view?.hand_no;

  const setPending = useCallback((value: boolean) => {
    actionBusy.current = value;
    setActionPending(value);
  }, []);

  const setDrawState = useCallback((hand: number, state: ProofState) => {
    setDrawStates((current) => ({ ...current, [hand]: state }));
  }, []);

  const setClaimState = useCallback((hand: number, state: ProofState) => {
    setClaimStates((current) => ({ ...current, [hand]: state }));
  }, []);

  const setNoticeQueue = useCallback(
    (update: ActionNoticeView[] | ((current: ActionNoticeView[]) => ActionNoticeView[])) => {
      const next = typeof update === "function" ? update(noticeQueue.current) : update;
      noticeQueue.current = next;
      setNotices(next);
    },
    [],
  );

  useEffect(() => {
    if (!gameReady) return;

    const hand = view?.hand_no;
    const timer = setTimeout(() => setFinishHand(hand), GAME_OVER_DELAY_MS);

    return () => clearTimeout(timer);
  }, [gameReady, view?.hand_no]);

  useEffect(() => {
    if (!finish) return;

    const timer = setTimeout(() => router.push("/"), GAME_OVER_DISPLAY_MS);

    return () => clearTimeout(timer);
  }, [finish, router]);

  useEffect(() => {
    if (!notice) return;

    const hand = view?.hand_no;
    let timer: number | undefined;
    let frame: number | undefined;
    const start = () => {
      timer = window.setTimeout(() => {
        setNoticeQueue((current) => {
          if (viewRef.current?.hand_no !== hand || current[0]?.seq !== notice.seq) return current;
          return current.slice(1);
        });
      }, 2000);
    };

    // start after visible paint
    if (document.visibilityState === "hidden") start();
    else frame = window.requestAnimationFrame(start);

    return () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [notice, setNoticeQueue, view?.hand_no]);

  const connect = useCallback(() => {
    const current = auth.current;
    if (!current) return;
    if (socket.current) closeSocket(socket.current);

    setConnecting(true);
    setConnected(false);
    setPending(false);
    setError(undefined);
    setDeckStage(undefined);
    setNoticeQueue([]);
    syncing.current = true;
    actionWait.current = undefined;
    readyWait.current = undefined;
    deckActive.current = false;
    deckRequests.current.clear();

    let next: WebSocket;
    try {
      next = new WebSocket(roomSocket(room));
    } catch {
      setConnecting(false);
      setError("Connection failed");
      return;
    }
    socket.current = next;
    const failConnection = (message: string) => {
      if (socket.current !== next) return;
      closeSocket(next);
      socket.current = undefined;
      actionWait.current = undefined;
      readyWait.current = undefined;
      const draw = drawing.current;
      drawing.current = undefined;
      claiming.current = undefined;
      dealing.current = false;
      deckBusy.current = false;
      deckActive.current = false;
      if (draw !== undefined) setDrawState(draw, "failed");
      setClaimState((state) => state === "preparing" || state === "proving" || state === "verifying" ? "failed" : state);
      setConnecting(false);
      setConnected(false);
      setPending(false);
      setDeckStage(undefined);
      setError(message);
    };
    next.onopen = () => next.send(JSON.stringify({ type: "auth", token: current.token }));
    const handleDeck = async (message: Extract<ServerMessage, { type: `deck_${string}` }>) => {
      deckActive.current = true;
      if (message.type === "deck_wait") {
        setDeckStage(message.stage);
        return;
      }
      const request = message.type === "deck_key"
        ? `${message.hand_no}:key:${message.context}`
        : message.type === "deck_shuffle"
          ? `${message.hand_no}:shuffle:${message.participant}:${message.context}`
          : message.type === "deck_shares"
            ? `${message.hand_no}:shares:${message.context}:${message.positions.join(":")}`
            : message.type === "deck_private"
              ? `${message.hand_no}:private:${message.context}`
              : `${message.hand_no}:open`;
      if (deckBusy.current || deckRequests.current.has(request)) return;
      deckBusy.current = true;
      deckRequests.current.add(request);
      setDeckStage(
        message.type === "deck_key"
          ? "creating private key"
          : message.type === "deck_shuffle"
            ? "proving private shuffle"
            : message.type === "deck_shares"
              ? "opening dealt cards"
              : message.type === "deck_private"
                ? "decrypting your cards"
                : "publishing final opening",
      );
      try {
        const secret = deckSecret(room, message.hand_no);
        if (message.type === "deck_key") {
          let head = deckBytes(message.start);
          for (const [seq, entry] of message.keys.entries()) {
            if (!(await verifyKey(entry.key, entry.proof, head))) {
              throw new Error("invalid deck key");
            }
            head = transcriptNext(head, seq, "key", entry.seat, keyPayload(entry.key, entry.proof));
          }
          if (deckHex(head) !== message.context) throw new Error("invalid deck transcript");
          const key = await publicKey(secret);
          const proof = await keyProof(secret, deckBytes(message.context));
          next.send(JSON.stringify({ type: "deck_key", hand_no: message.hand_no, key, proof } satisfies ClientAction));
        } else if (message.type === "deck_shuffle") {
          const shuffled = await shuffleDeck(message.deck, message.key);
          const proof = await proveShuffle({
            hand: message.hand_no,
            seat: message.participant,
            context: message.context,
            input: message.deck,
            output: shuffled.output,
            key: message.key,
            permutation: shuffled.permutation,
            masks: shuffled.masks,
          }, setDeckStage);
          next.send(JSON.stringify({
            type: "deck_shuffle",
            hand_no: message.hand_no,
            context: message.context,
            output: shuffled.output,
            proof: proof.proof,
            public_inputs: proof.public_inputs,
          } satisfies ClientAction));
        } else if (message.type === "deck_shares") {
          const participant = current.seat + 1;
          const shares = await Promise.all(message.positions.map(async (position) => ({
            participant,
            position,
            context: message.context,
            ...await decryptionShare(message.deck[position], secret, deckBytes(message.context)),
          })));
          next.send(JSON.stringify({
            type: "deck_shares",
            hand_no: message.hand_no,
            context: message.context,
            shares,
          } satisfies ClientAction));
        } else if (message.type === "deck_private") {
          const cards = [] as string[];
          for (const entry of message.cards) {
            for (const share of entry.shares) {
              if (!(await verifyShare(
                entry.card,
                message.keys[share.participant],
                share.value,
                share.proof,
                deckBytes(share.context),
              ))) throw new Error("invalid card opening");
            }
            const mine = await decryptionShare(entry.card, secret, deckBytes(message.context));
            const card = await openCard(entry.card, entry.shares.map((share) => share.value).concat(mine.value));
            cards.push(cardValue(card));
          }
          if (cards.length !== 2) throw new Error("private cards missing");
          localHole.current = { hand: message.hand_no, cards: [cards[0], cards[1]] };
          saveDeckHole(room, message.hand_no, current.seat, [cards[0], cards[1]]);
          next.send(JSON.stringify({ type: "deck_private_ready", hand_no: message.hand_no } satisfies ClientAction));
        } else {
          next.send(JSON.stringify({ type: "deck_open", hand_no: message.hand_no, secret } satisfies ClientAction));
        }
      } catch (cause) {
        deckRequests.current.delete(request);
        failConnection(cause instanceof Error ? cause.message : "deck protocol failed");
      } finally {
        deckBusy.current = false;
      }
    };
    next.onmessage = (event) => {
      if (socket.current !== next || typeof event.data !== "string") return;
      let message: ServerMessage;
      try {
        message = JSON.parse(event.data) as ServerMessage;
      } catch {
        failConnection("Invalid server message");
        return;
      }

      if (message.type.startsWith("deck_")) {
        const deckMessage = message as Extract<ServerMessage, { type: `deck_${string}` }>;
        setWaiting(undefined);
        const run = () => {
          if (socket.current !== next) return;
          const active = viewRef.current;
          const future = active &&
            deckMessage.hand_no > active.hand_no &&
            (!active.settled || deckMessage.hand_no > active.hand_no + 1);
          const reveal = active &&
            deckMessage.hand_no === active.hand_no &&
            (deckMessage.type === "deck_shares" || deckMessage.type === "deck_open") &&
            !active.round_complete &&
            !active.settled;
          if (noticeQueue.current.length > 0 || future || reveal) {
            setTimeout(run, 50);
            return;
          }
          void handleDeck(deckMessage);
        };
        if (deckMessage.type === "deck_wait") void handleDeck(deckMessage);
        else run();
        return;
      }

      if (message.type === "waiting" || message.type === "waiting_fair") {
        deckActive.current = false;
        setWaiting({
          joined: message.joined,
          players: message.players,
          mode: message.mode,
          deal: message.type === "waiting_fair" ? message.deal : undefined,
        });
        setView(undefined);
        setConnected(true);
        setConnecting(false);
        actionWait.current = undefined;
        setPending(false);
        setError(undefined);

        if (
          message.type === "waiting_fair" &&
          message.mode === "single" &&
          !message.deal.mine &&
          !dealing.current
        ) {
          dealing.current = true;
          setPending(true);
          next.send(JSON.stringify({ type: "deal_entropy", entropy: freshEntropy() } satisfies ClientAction));
        }
        return;
      }

      if (message.type === "snapshot") {
        dealing.current = false;
        if (message.rev < rev.current) return;
        deckActive.current = false;
        let local = localHole.current;
        if (local?.hand !== message.view.hand_no) {
          local = loadDeckHole(room, message.view.hand_no, current.seat);
          localHole.current = local;
        }
        if (local?.hand === message.view.hand_no) {
          message.view.hole = [{ value: local.cards[0] }, { value: local.cards[1] }];
        }
        viewRef.current = message.view;
        const log = message.view.action_notices ?? (message.view.last_action ? [message.view.last_action] : []);
        const last = log.at(-1)?.seq ?? -1;
        const seen = seenAction.current;
        if (!syncing.current && rev.current >= 0) {
          if (seen?.hand !== message.view.hand_no) {
            setNoticeQueue(log);
          } else {
            const next = log.filter((entry) => entry.seq > seen.seq);
            if (next.length) {
              setNoticeQueue((currentNotices) => {
                const queued = new Set(currentNotices.map((entry) => entry.seq));
                return [...currentNotices, ...next.filter((entry) => !queued.has(entry.seq))];
              });
            }
          }
        }
        syncing.current = false;
        seenAction.current = { hand: message.view.hand_no, seq: last };
        rev.current = message.rev;
        const currentChallenge = privateObjective(room, current.seat, challengeAssignment(message.view.challenge));
        const claimed = message.view.claim?.status === "claimed";
        const currentClaim = privateObjective(room, current.seat, claimAssignment(message.view.claim));
        const completion = contractCompletion(message.view.claim, current.seat, currentClaim.index);

        if (message.view.challenge?.draw_verified) {
          if (drawing.current === message.view.challenge.hand_no) drawing.current = undefined;
          setDrawState(message.view.challenge.hand_no, "verified");
        }
        if (message.view.claim?.draw_verified) {
          if (drawing.current === message.view.claim.hand_no) drawing.current = undefined;
          setDrawState(message.view.claim.hand_no, "verified");
        }

        if (claimed && message.view.claim) {
          if (claiming.current === message.view.claim.hand_no) claiming.current = undefined;
          setClaimState("verified");
        } else if (claiming.current === undefined) {
          setClaimState("idle");
        }

        setWaiting(undefined);
        setDeckStage(undefined);
        setView(message.view);
        const range = message.view.actions?.raise;
        const nextRaiseContext = range
          ? `${message.view.hand_no}:${message.view.turn}:${range.min_to}:${range.max_to}`
          : undefined;
        setRaiseTo((value) => {
          if (!range) return 0;
          if (raiseContext.current !== nextRaiseContext) return range.min_to;
          return Math.min(range.max_to, Math.max(range.min_to, value));
        });
        raiseContext.current = nextRaiseContext;
        setObjective(currentChallenge.objective);
        setClaimObjective(currentClaim.objective);
        setClaimCompleted(completion.completed);
        setChallengeError(currentChallenge.error ?? currentClaim.error ?? completion.error);
        setConnected(true);
        setConnecting(false);
        const wait = actionWait.current;
        const ready = readyWait.current;
        if (ready !== undefined) {
          if (
            message.view.hand_no !== ready ||
            message.view.ready?.mine ||
            message.view.finish?.mine ||
            message.view.game_over
          ) {
            readyWait.current = undefined;
            setPending(false);
          }
        } else if (
          !wait ||
          message.view.hand_no !== wait.hand ||
          (message.view.last_action?.seq ?? -1) >= wait.seq
        ) {
          actionWait.current = undefined;
          setPending(false);
        }
        setError(undefined);

        return;
      }

      if (message.type === "error") {
        if (deckActive.current || dealing.current) {
          failConnection(message.message);
          return;
        }
        dealing.current = false;
        readyWait.current = undefined;
        setConnecting(false);
        setPending(false);
        setError(message.message);
      }
      if (message.type === "proof_error") {
        if (message.kind === "draw" && drawing.current === message.hand_no) {
          drawing.current = undefined;
          setDrawState(message.hand_no, "failed");
          setChallengeError(message.message);
        } else if (message.kind === "completion" && claiming.current === message.hand_no) {
          claiming.current = undefined;
          setClaimState("failed");
          setChallengeError(message.message);
        }
      }
      if (message.type === "proof_accepted") {
        if (message.kind === "draw" && drawing.current === message.hand_no) {
          drawing.current = undefined;
          setDrawState(message.hand_no, "verified");
        } else if (message.kind === "completion" && claiming.current === message.hand_no) {
          claiming.current = undefined;
          setClaimState("verified");
        }
      }
    };
    next.onerror = () => failConnection("Connection failed");
    next.onclose = () => {
      if (socket.current === next) {
        socket.current = undefined;
        actionWait.current = undefined;
        readyWait.current = undefined;
        const draw = drawing.current;
        drawing.current = undefined;
        claiming.current = undefined;
        dealing.current = false;
        deckActive.current = false;
        if (draw !== undefined) setDrawState(draw, "failed");
        setClaimState((state) => state === "preparing" || state === "proving" || state === "verifying" ? "failed" : state);
        setConnecting(false);
        setConnected(false);
        setPending(false);
        setDeckStage(undefined);
        setError((currentError) => currentError ?? "Disconnected");
      }
    };
  }, [room, setDrawState, setNoticeQueue, setPending]);

  useEffect(() => {
    let live = true;
    const current = loadSeat(room);
    queueMicrotask(() => {
      if (!live) return;
      if (!current) { setSeat(null); return; }
      auth.current = current;
      setSeat(current.seat);
      connect();
    });
    return () => {
      live = false;
      const currentSocket = socket.current;
      socket.current = undefined;
      actionWait.current = undefined;
      readyWait.current = undefined;
      drawing.current = undefined;
      claiming.current = undefined;
      if (currentSocket) closeSocket(currentSocket);
    };
  }, [connect, room]);

  const send = useCallback((action: ClientAction) => {
    const current = socket.current;
    const poker = ["fold", "check", "call", "raise_to"].includes(action.type);
    const paced = poker || action.type === "ready" || action.type === "finish";
    if (
      !current ||
      current.readyState !== WebSocket.OPEN ||
      !connected ||
      actionBusy.current ||
      (paced && deckActive.current)
    ) return;
    if (poker) {
      const currentView = viewRef.current;
      actionWait.current = currentView
        ? { hand: currentView.hand_no, seq: (currentView.last_action?.seq ?? -1) + 1 }
        : undefined;
      readyWait.current = undefined;
    } else if (action.type === "ready" || action.type === "finish") {
      actionWait.current = undefined;
      readyWait.current = viewRef.current?.hand_no;
    } else {
      actionWait.current = undefined;
      readyWait.current = undefined;
    }
    setPending(true);
    setError(undefined);
    try {
      current.send(JSON.stringify(action));
    } catch {
      actionWait.current = undefined;
      readyWait.current = undefined;
      setPending(false);
      setConnected(false);
      setError("Connection failed");
    }
  }, [connected, setPending]);

  const commitChallenge = useCallback(() => {
    const challenge = view?.challenge;
    if (view?.mode !== "multiplayer" || !challenge || challenge.assigned || typeof seat !== "number") return;

    try {
      send(challengeCommit(room, seat, challenge));
    } catch {
      setChallengeError("Fair draw setup failed");
    }
  }, [room, seat, send, view?.challenge, view?.mode]);

  const drawChallenge = useCallback(async (assignment: Assignment | undefined) => {
    const current = socket.current;
    if (
      !assignment ||
      assignment.draw_verified ||
      typeof seat !== "number" ||
      !current ||
      current.readyState !== WebSocket.OPEN ||
      !connected ||
      drawing.current !== undefined
    ) return;
    const hand = assignment.hand_no;
    const stored = loadChallengeSecret(room, assignment.hand_no, seat);
    if (!stored) {
      setChallengeError("Draw secret unavailable");
      setDrawState(hand, "failed");
      return;
    }

    try {
      const handTag = decodeHex(assignment.hand_tag);
      const secret = decodeHex(stored.secret);
      const nonce = decodeHex(assignment.nonce);
      const commitment = decodeHex(assignment.commitment);
      const index = objectiveIndex(handTag, seat, nonce, secret);
      const value = objectiveAt(index);
      const siblings = objectivePath(index);
      const root = decodeHex(assignment.catalog_root);
      if (
        stored.commitment !== assignment.commitment ||
        encodeHex(challengeCommitment(handTag, seat, secret)) !== assignment.commitment ||
        encodeHex(catalogRoot()) !== assignment.catalog_root ||
        encodeHex(pathRoot(leafHash(value), index, siblings)) !== encodeHex(root)
      ) throw new Error("challenge mismatch");

      drawing.current = hand;
      setChallengeError(undefined);
      setDrawState(hand, "preparing");
      const result = await proveChallenge({
        mode: 0,
        handTag,
        seat,
        commitment,
        nonce,
        factsHash: new Uint8Array(32),
        nullifier: new Uint8Array(32),
        catalogRoot: root,
        secret,
        factsSalt: new Uint8Array(32),
        facts: [0, 0, 0, 0, 0, 0],
        mustTrue: value.mustTrue,
        mustFalse: value.mustFalse,
        siblings,
      }, (status: ProofStatus) => {
        if (drawing.current === hand) setDrawState(hand, status);
      });
      if (
        drawing.current !== hand ||
        socket.current !== current ||
        current.readyState !== WebSocket.OPEN
      ) throw new Error("stale draw proof");
      setDrawState(hand, "verifying");
      current.send(JSON.stringify({ type: "challenge_draw", hand_no: assignment.hand_no, proof: result.proof, public_inputs: result.public_inputs } satisfies ClientAction));
    } catch {
      if (drawing.current === hand) {
        drawing.current = undefined;
        setDrawState(hand, "failed");
        setChallengeError("Draw proof failed");
      }
    }
  }, [connected, room, seat, setDrawState]);

  const claimChallenge = useCallback(async () => {
    const claim = view?.claim;
    const current = socket.current;
    if (
      !claim ||
      claim.status !== "claimable" ||
      typeof seat !== "number" ||
      !current ||
      current.readyState !== WebSocket.OPEN ||
      !connected ||
      claiming.current !== undefined
    ) return;
    const hand = claim.hand_no;
    const stored = loadChallengeSecret(room, claim.hand_no, seat);
    if (!stored) { setChallengeError("Draw secret unavailable"); setClaimState("failed"); return; }

    try {
      const handTag = decodeHex(claim.hand_tag);
      const secret = decodeHex(stored.secret);
      const nonce = decodeHex(claim.nonce);
      const commitment = decodeHex(claim.commitment);
      const salt = decodeHex(claim.facts_salt);
      const expectedFactsHash = factsHash(handTag, seat, salt, claim.facts);
      const index = objectiveIndex(handTag, seat, nonce, secret);
      const objective = objectiveAt(index);
      const siblings = objectivePath(index);
      const root = decodeHex(claim.catalog_root);
      if (
        stored.commitment !== claim.commitment ||
        encodeHex(challengeCommitment(handTag, seat, secret)) !== claim.commitment ||
        encodeHex(expectedFactsHash) !== claim.facts_hash ||
        encodeHex(catalogRoot()) !== claim.catalog_root ||
        encodeHex(pathRoot(leafHash(objective), index, siblings)) !== encodeHex(root)
      ) throw new Error("challenge mismatch");
      if (!objectiveMet(objective, claim.facts)) { setClaimCompleted(false); return; }

      claiming.current = hand;
      setChallengeError(undefined);
      setClaimState("preparing");
      const result = await proveChallenge({
        mode: 1,
        handTag,
        seat,
        commitment,
        nonce,
        factsHash: expectedFactsHash,
        nullifier: challengeNullifier(handTag, seat, secret),
        catalogRoot: root,
        secret,
        factsSalt: salt,
        facts: claim.facts,
        mustTrue: objective.mustTrue,
        mustFalse: objective.mustFalse,
        siblings,
      }, (status: ProofStatus) => {
        if (claiming.current === hand) setClaimState(status);
      });
      if (
        claiming.current !== hand ||
        socket.current !== current ||
        current.readyState !== WebSocket.OPEN
      ) throw new Error("stale completion proof");
      setClaimState("verifying");
      current.send(JSON.stringify({ type: "challenge_claim", hand_no: claim.hand_no, proof: result.proof, public_inputs: result.public_inputs } satisfies ClientAction));
    } catch {
      if (claiming.current === hand) {
        claiming.current = undefined;
        setClaimState("failed");
        setChallengeError("Completion proof failed");
      }
    }
  }, [connected, room, seat, view?.claim]);

  useEffect(() => {
    const challenge = view?.challenge;
    if (
      view?.mode !== "multiplayer" ||
      !challenge ||
      challenge.assigned ||
      typeof seat !== "number" ||
      !connected ||
      actionPending
    ) return;

    const key = `commit:${challenge.hand_no}`;
    const attempts = autoAttempts[key] ?? 0;
    const timer = window.setTimeout(() => {
      const latest = viewRef.current?.challenge;
      if (!latest || latest.hand_no !== challenge.hand_no || latest.assigned) return;
      setAutoAttempts((current) => ({ ...current, [key]: Math.max(current[key] ?? 0, attempts + 1) }));
      commitChallenge();
    }, attempts === 0 ? 0 : Math.min(attempts * 1200, MAX_AUTO_PROOF_DELAY_MS));

    return () => window.clearTimeout(timer);
  }, [actionPending, autoAttempts, commitChallenge, connected, seat, view?.challenge, view?.mode]);

  useEffect(() => {
    if (view?.mode !== "multiplayer" || typeof seat !== "number" || !connected) return;
    if (drawing.current !== undefined || claiming.current !== undefined) return;

    const candidates = [claimAssignment(view.claim), challengeAssignment(view.challenge)]
      .filter((assignment): assignment is Assignment => assignment !== undefined);
    const assignment = candidates.find((candidate) => {
      const state = drawStates[candidate.hand_no] ?? "idle";
      return !candidate.draw_verified &&
        state !== "verified";
    });
    if (!assignment) return;

    const state = drawStates[assignment.hand_no] ?? "idle";
    if (state === "preparing" || state === "proving" || state === "verifying") return;

    const key = `draw:${assignment.hand_no}`;
    const attempts = autoAttempts[key] ?? 0;
    const timer = window.setTimeout(() => {
      if (drawing.current !== undefined || claiming.current !== undefined) return;
      setAutoAttempts((current) => ({ ...current, [key]: Math.max(current[key] ?? 0, attempts + 1) }));
      void drawChallenge(assignment);
    }, attempts === 0 ? 0 : Math.min(attempts * 1200, MAX_AUTO_PROOF_DELAY_MS));

    return () => window.clearTimeout(timer);
  }, [autoAttempts, claimState, connected, drawChallenge, drawStates, seat, view?.challenge, view?.claim, view?.mode]);

  useEffect(() => {
    const claim = view?.claim;
    if (
      view?.mode !== "multiplayer" ||
      !claim ||
      claim.status !== "claimable" ||
      claimCompleted !== true ||
      typeof seat !== "number" ||
      !connected ||
      drawing.current !== undefined ||
      claiming.current !== undefined ||
      claimState === "preparing" ||
      claimState === "proving" ||
      claimState === "verifying" ||
      claimState === "verified"
    ) return;

    const key = `completion:${claim.hand_no}`;
    const attempts = autoAttempts[key] ?? 0;
    const timer = window.setTimeout(() => {
      const latest = viewRef.current?.claim;
      if (
        !latest ||
        latest.hand_no !== claim.hand_no ||
        latest.status !== "claimable" ||
        drawing.current !== undefined ||
        claiming.current !== undefined
      ) return;
      setAutoAttempts((current) => ({ ...current, [key]: Math.max(current[key] ?? 0, attempts + 1) }));
      void claimChallenge();
    }, attempts === 0 ? 0 : Math.min(attempts * 1200, MAX_AUTO_PROOF_DELAY_MS));

    return () => window.clearTimeout(timer);
  }, [autoAttempts, claimChallenge, claimCompleted, claimState, connected, drawStates, seat, view?.claim, view?.mode]);

  async function verifyProof(owner: number, hand: number, kind: ProofKind) {
    const key = proofKey(owner, hand, kind);
    if (verifyingProofs.current.has(key)) return;
    verifyingProofs.current.add(key);
    setLocalProofs((current) => ({ ...current, [key]: "verifying" }));

    try {
      // exact accepted proof
      const proof = await loadPublishedProof(room, hand, owner, kind);
      await verifyPublishedProof(proof);
      setLocalProofs((current) => ({ ...current, [key]: "verified" }));
    } catch {
      setLocalProofs((current) => ({ ...current, [key]: "failed" }));
    } finally {
      verifyingProofs.current.delete(key);
    }
  }

  if (seat === undefined) return <p className="table-status">Loading room…</p>;
  if (seat === null) return <div className="room-status"><strong>No seat for this room</strong><Link href="/">Back to lobby</Link></div>;
  if (waiting) {
    if (waiting.mode === "single") {
      return (
        <div className={`waiting-room${error ? " ui-shake" : ""}`}>
          <p className="protocol-label">Room {room}</p>
          <h2>Preparing the table</h2>
          <p>Creating the private deck</p>
          {error && <p className="form-error">{error}</p>}
          {!connecting && !connected && <button className="key-action key-compact" type="button" onClick={connect}><Keycap>Reconnect</Keycap></button>}
        </div>
      );
    }
    return (
      <div className={`waiting-room${error ? " ui-shake" : ""}`}>
        <p className="protocol-label">Room {room}</p>
        <h2>Waiting for the table.</h2>
        <strong>{waiting.joined} / {waiting.players} seats</strong>
        <p>Waiting for every player to join.</p>
        {error && <p className="form-error">{error}</p>}
        {!connecting && !connected && <button className="key-action key-compact" type="button" onClick={connect}><Keycap>Reconnect</Keycap></button>}
      </div>
    );
  }
  if (!view) return <div className={`room-status${error ? " ui-shake" : ""}`}><strong>{error ?? deckStage ?? "Connecting to table"}</strong>{!connecting && !connected && <button className="key-action key-compact" type="button" onClick={connect}><Keycap>Reconnect</Keycap></button>}</div>;

  const automaticCompletionPending = Boolean(
    view.mode === "multiplayer" &&
    view.settled &&
    view.claim?.status === "claimable" &&
    claimCompleted === true &&
    claimState !== "verified",
  );
  const automaticDrawPending = Boolean(
    view.mode === "multiplayer" &&
    view.settled &&
    ((view.claim && !view.claim.draw_verified) ||
      (view.challenge?.assigned && !view.challenge.draw_verified)),
  );
  const tourBlocking = Boolean(
    view.mode === "multiplayer" &&
    view.hand_no === 1 &&
    (tourState?.handNo !== view.hand_no || tourState.open),
  );
  const interactionDisabled =
    actionPending ||
    notices.length > 0 ||
    Boolean(deckStage) ||
    !connected ||
    automaticCompletionPending ||
    automaticDrawPending ||
    tourBlocking;

  const contract: ContractView = {
    assignment: view.mode !== "multiplayer" || !view.challenge
      ? { kind: "available" }
      : !view.challenge.assigned
        ? { kind: "draw", handNo: view.challenge.hand_no }
        : {
            kind: "assigned",
            handNo: view.challenge.hand_no,
            objective: objective ?? "Private objective unavailable",
            active: !view.settled,
            drawVerified: view.challenge.draw_verified,
            drawState: drawStates[view.challenge.hand_no] ?? "idle",
            commitment: view.challenge.commitment ?? "",
            nonce: view.challenge.nonce ?? "",
            catalogRoot: view.challenge.catalog_root ?? "",
          },
    claim: view.claim
      ? {
          handNo: view.claim.hand_no,
          objective: claimObjective,
          completed: claimCompleted,
          state: claimState,
          drawVerified: view.claim.draw_verified,
          drawState: drawStates[view.claim.hand_no] ?? "idle",
        }
      : undefined,
    proofs: view.proofs.map((proof) => ({
      seat: proof.seat,
      name: proof.seat === seat
        ? "You"
        : view.players[proof.seat]?.name ?? `Player ${proof.seat + 1}`,
      completed: view.players[proof.seat]?.challenge_wins ?? 0,
      draw: proof.draw
        ? {
            handNo: proof.draw.hand_no,
            published: proof.draw.published,
            local: localProofs[proofKey(proof.seat, proof.draw.hand_no, "draw")] ?? "idle",
          }
        : undefined,
      completion: proof.completion
        ? {
            handNo: proof.completion.hand_no,
            published: proof.completion.published,
            local:
              localProofs[proofKey(proof.seat, proof.completion.hand_no, "completion")] ?? "idle",
            receipt: proof.completion.nullifier
              ? `/proof/${proof.completion.nullifier}`
              : undefined,
          }
        : undefined,
    })),
    error: challengeError,
  };

  return (
    <div className={`game-view${error || challengeError ? " ui-shake" : ""}`}>
      {view.mode === "multiplayer" && (
        <ProofTour room={room} seat={seat} handNo={view.hand_no} onOpenChange={setTourState} />
      )}
      {!connected && <div className="connection-bar"><span>{connecting ? "Connecting" : "Disconnected"}</span>{!connecting && <button type="button" onClick={connect}>Reconnect</button>}</div>}
      <Table
        view={view}
        viewer={seat}
        room={room}
        error={error}
        disabled={interactionDisabled}
        notice={notice}
        stage={deckStage}
        finish={finish}
        raiseTo={raiseTo}
        setRaiseTo={setRaiseTo}
        onFold={() => send({ type: "fold" })}
        onCheck={() => send({ type: "check" })}
        onCall={() => send({ type: "call" })}
        onRaise={() => send({ type: "raise_to", to: raiseTo })}
        onReady={() => send({ type: "ready", entropy: freshEntropy() })}
        onFinish={() => send({ type: "finish" })}
        contract={contract}
        onCommitContract={commitChallenge}
        onVerifyDraw={() => void drawChallenge(challengeAssignment(view.challenge))}
        onGenerateProof={() => void claimChallenge()}
        onVerifyProof={(owner, hand, kind) => void verifyProof(owner, hand, kind)}
      />
      {view.mode === "multiplayer" && (
        <PrivateChallengeBar
          view={contract}
        />
      )}
      {view.mode === "multiplayer" && (
        <PlayProofs
          room={room}
          handNo={view.hand_no}
          settled={view.settled}
          gameOver={Boolean(view.game_over)}
          view={contract}
        />
      )}
    </div>
  );
}
