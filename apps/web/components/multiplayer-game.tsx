"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import type { ContractView, LocalProofState, ProofState } from "@/components/contract";
import type { DealView } from "@/components/deal-integrity";
import { Keycap } from "@/components/keycap";
import { PlayProofs } from "@/components/play-proofs";
import { PrivateChallengeBar } from "@/components/private-challenge";
import { Table, type ActionNoticeView, type ChallengeView, type ClaimView, type View } from "@/components/table";
import { playErrorSound } from "@/components/ui-sounds";
import {
  CHALLENGE_VERSION,
  CHALLENGE_POINTS,
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
  removeChallengeSecret,
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
  | { type: "proof_accepted"; kind: ProofKind }
  | { type: "proof_error"; kind: ProofKind; message: string }
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

function deckSecret(room: string, hand: number) {
  const key = deckSecretKey(room, hand);
  const stored = sessionStorage.getItem(key);
  if (stored) return stored;
  const secret = randomScalar();
  sessionStorage.setItem(key, secret);
  return secret;
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
        draw_verified: true,
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
  const drawing = useRef(false);
  const claiming = useRef(false);
  const dealing = useRef(false);
  const committing = useRef(false);
  const deckBusy = useRef(false);
  const localHole = useRef<{ hand: number; cards: [string, string] } | undefined>(undefined);
  const seenAction = useRef<{ hand: number; seq: number } | undefined>(undefined);
  const finishTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const viewRef = useRef<View | undefined>(undefined);
  const actionWait = useRef<{ hand: number; seq: number } | undefined>(undefined);
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
  const [drawState, setDrawState] = useState<ProofState>("idle");
  const [claimState, setClaimState] = useState<ProofState>("idle");
  const [localProofs, setLocalProofs] = useState<Record<string, LocalProofState>>({});
  const [notices, setNotices] = useState<ActionNoticeView[]>([]);
  const [finish, setFinish] = useState(false);
  const [deckStage, setDeckStage] = useState<string>();

  useEffect(() => {
    if (!error && !challengeError) return;
    playErrorSound();
  }, [error, challengeError]);

  useEffect(() => {
    if (!finish) return;

    const timer = setTimeout(() => router.push("/"), 2300);

    return () => clearTimeout(timer);
  }, [finish, router]);

  useEffect(() => {
    if (!notices.length) return;

    const timer = setTimeout(() => setNotices((current) => current.slice(1)), 1100);
    return () => clearTimeout(timer);
  }, [notices]);

  const connect = useCallback(() => {
    const current = auth.current;
    if (!current) return;
    if (socket.current) closeSocket(socket.current);

    setConnecting(true);
    setConnected(false);
    setActionPending(false);
    setError(undefined);

    let next: WebSocket;
    try {
      next = new WebSocket(roomSocket(room));
    } catch {
      setConnecting(false);
      setError("Connection failed");
      return;
    }
    socket.current = next;
    next.onopen = () => next.send(JSON.stringify({ type: "auth", token: current.token }));
    const handleDeck = async (message: Extract<ServerMessage, { type: `deck_${string}` }>) => {
      if (message.type === "deck_wait") {
        setDeckStage(message.stage);
        return;
      }
      if (deckBusy.current) return;
      deckBusy.current = true;
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
          next.send(JSON.stringify({ type: "deck_private_ready", hand_no: message.hand_no } satisfies ClientAction));
        } else {
          next.send(JSON.stringify({ type: "deck_open", hand_no: message.hand_no, secret } satisfies ClientAction));
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "deck protocol failed");
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
        actionWait.current = undefined;
        setActionPending(false);
        setError("Invalid server message");
        return;
      }

      if (message.type.startsWith("deck_")) {
        void handleDeck(message as Extract<ServerMessage, { type: `deck_${string}` }>);
        return;
      }

      if (message.type === "waiting" || message.type === "waiting_fair") {
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
        setActionPending(false);
        setError(undefined);

        if (
          message.type === "waiting_fair" &&
          message.mode === "single" &&
          !message.deal.mine &&
          !dealing.current
        ) {
          dealing.current = true;
          setActionPending(true);
          next.send(JSON.stringify({ type: "deal_entropy", entropy: freshEntropy() } satisfies ClientAction));
        }
        return;
      }

      if (message.type === "snapshot") {
        dealing.current = false;
        if (message.rev < rev.current) return;
        const local = localHole.current;
        if (local?.hand === message.view.hand_no) {
          message.view.hole = [{ value: local.cards[0] }, { value: local.cards[1] }];
        }
        viewRef.current = message.view;
        const log = message.view.action_notices;
        const last = log.at(-1)?.seq ?? -1;
        const seen = seenAction.current;
        if (rev.current >= 0) {
          const next = seen?.hand === message.view.hand_no
            ? log.filter((notice) => notice.seq > seen.seq)
            : log;
          if (next.length) {
            setNotices((currentNotices) => seen?.hand === message.view.hand_no
              ? [...currentNotices, ...next]
              : next);
          }
        }
        seenAction.current = { hand: message.view.hand_no, seq: last };
        if (message.view.game_over) {
          if (rev.current < 0) {
            setFinish(true);
          } else if (!finishTimer.current) {
            finishTimer.current = setTimeout(() => setFinish(true), 1050);
          }
        } else {
          setFinish(false);
        }
        rev.current = message.rev;
        const currentChallenge = privateObjective(room, current.seat, challengeAssignment(message.view.challenge));
        const claimed = message.view.claim?.status === "claimed";
        const currentClaim: PrivateObjective = claimed ? {} : privateObjective(room, current.seat, claimAssignment(message.view.claim));
        const completion = contractCompletion(message.view.claim, current.seat, currentClaim.index);

        if (message.view.challenge?.draw_verified) {
          drawing.current = false;
          setDrawState("verified");
        } else if (!drawing.current) setDrawState("idle");

        if (claimed && message.view.claim) {
          removeChallengeSecret(room, message.view.claim.hand_no, current.seat);
          claiming.current = false;
          setClaimState("verified");
        } else if (!claiming.current) setClaimState("idle");

        setWaiting(undefined);
        setDeckStage(undefined);
        setView(message.view);
        setRaiseTo(message.view.actions?.raise?.min_to ?? 0);
        setObjective(currentChallenge.objective);
        setClaimObjective(currentClaim.objective);
        setClaimCompleted(completion.completed);
        setChallengeError(currentChallenge.error ?? currentClaim.error ?? completion.error);
        setConnected(true);
        setConnecting(false);
        const wait = actionWait.current;
        if (
          !wait ||
          message.view.hand_no !== wait.hand ||
          (message.view.last_action?.seq ?? -1) >= wait.seq
        ) {
          actionWait.current = undefined;
          setActionPending(false);
        }
        setError(undefined);

        if (
          message.view.settled &&
          !message.view.game_over &&
          message.view.challenge &&
          !message.view.challenge.assigned &&
          !committing.current
        ) {
          try {
            committing.current = true;
            next.send(JSON.stringify(challengeCommit(room, current.seat, message.view.challenge)));
          } catch {
            committing.current = false;
            setChallengeError("Challenge setup failed");
          }
        } else if (message.view.challenge?.assigned) {
          committing.current = false;
        }
        return;
      }

      if (message.type === "error") {
        dealing.current = false;
        committing.current = false;
        if (drawing.current) { drawing.current = false; setDrawState("failed"); }
        if (claiming.current) { claiming.current = false; setClaimState("failed"); }
        setConnecting(false);
        setActionPending(false);
        setError(message.message);
      }
      if (message.type === "proof_error") {
        if (message.kind === "draw") {
          drawing.current = false;
          setDrawState("failed");
        } else {
          claiming.current = false;
          setClaimState("failed");
        }
        setChallengeError(message.message);
      }
      if (message.type === "proof_accepted") {
        if (message.kind === "draw") {
          drawing.current = false;
          setDrawState("verified");
        } else {
          claiming.current = false;
          setClaimState("verified");
        }
      }
    };
    next.onerror = () => {
      if (socket.current === next) {
        drawing.current = false;
        claiming.current = false;
        dealing.current = false;
        setConnecting(false);
        setActionPending(false);
        setError("Connection failed");
      }
    };
    next.onclose = () => {
      if (socket.current === next) {
        socket.current = undefined;
        dealing.current = false;
        setConnecting(false);
        setConnected(false);
        setActionPending(false);
        setError((currentError) => currentError ?? "Disconnected");
      }
    };
  }, [room]);

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
      if (socket.current) closeSocket(socket.current);
      if (finishTimer.current) clearTimeout(finishTimer.current);
    };
  }, [connect, room]);

  function send(action: ClientAction) {
    const current = socket.current;
    if (!current || current.readyState !== WebSocket.OPEN || !connected || actionPending) return;
    if (["fold", "check", "call", "raise_to"].includes(action.type)) {
      const currentView = viewRef.current;
      actionWait.current = currentView
        ? { hand: currentView.hand_no, seq: (currentView.last_action?.seq ?? -1) + 1 }
        : undefined;
    } else {
      actionWait.current = undefined;
    }
    setActionPending(true);
    setError(undefined);
    current.send(JSON.stringify(action));
  }

  function commitChallenge() {
    const challenge = view?.challenge;
    if (!challenge || challenge.assigned || typeof seat !== "number") return;

    try {
      send(challengeCommit(room, seat, challenge));
    } catch {
      setChallengeError("Fair draw setup failed");
    }
  }

  const drawChallenge = useCallback(async () => {
    const assignment = challengeAssignment(view?.challenge);
    const current = socket.current;
    if (!assignment || assignment.draw_verified || typeof seat !== "number" || !current || current.readyState !== WebSocket.OPEN || !connected || drawing.current) return;
    const stored = loadChallengeSecret(room, assignment.hand_no, seat);
    if (!stored) { setChallengeError("Draw secret unavailable"); setDrawState("failed"); return; }

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

      drawing.current = true;
      setChallengeError(undefined);
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
      }, (status: ProofStatus) => setDrawState(status));
      if (socket.current !== current || current.readyState !== WebSocket.OPEN) throw new Error("socket closed");
      setDrawState("verifying");
      current.send(JSON.stringify({ type: "challenge_draw", hand_no: assignment.hand_no, proof: result.proof, public_inputs: result.public_inputs } satisfies ClientAction));
    } catch {
      drawing.current = false;
      setDrawState("failed");
      setChallengeError("Draw proof failed");
    }
  }, [connected, room, seat, view?.challenge]);

  const claimChallenge = useCallback(async () => {
    const claim = view?.claim;
    const current = socket.current;
    if (!claim || claim.status !== "claimable" || typeof seat !== "number" || !current || current.readyState !== WebSocket.OPEN || !connected || claiming.current) return;
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

      claiming.current = true;
      setChallengeError(undefined);
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
      }, (status: ProofStatus) => setClaimState(status));
      if (socket.current !== current || current.readyState !== WebSocket.OPEN) throw new Error("socket closed");
      setClaimState("verifying");
      current.send(JSON.stringify({ type: "challenge_claim", hand_no: claim.hand_no, proof: result.proof, public_inputs: result.public_inputs } satisfies ClientAction));
    } catch {
      claiming.current = false;
      setClaimState("failed");
      setChallengeError("Completion proof failed");
    }
  }, [connected, room, seat, view?.claim]);

  useEffect(() => {
    if (view?.mode !== "multiplayer" || drawState !== "idle") return;
    const assignment = challengeAssignment(view?.challenge);
    if (!assignment || assignment.draw_verified) return;
    queueMicrotask(() => void drawChallenge());
  }, [drawChallenge, drawState, view?.challenge, view?.mode]);

  useEffect(() => {
    if (
      view?.mode !== "multiplayer" ||
      claimState !== "idle" ||
      claimCompleted !== true ||
      view?.claim?.status !== "claimable"
    ) {
      return;
    }
    queueMicrotask(() => void claimChallenge());
  }, [claimChallenge, claimCompleted, claimState, view?.claim?.status, view?.mode]);

  async function verifyProof(owner: number, hand: number, kind: ProofKind) {
    const key = proofKey(owner, hand, kind);
    if (localProofs[key] === "verifying") return;
    setLocalProofs((current) => ({ ...current, [key]: "verifying" }));

    try {
      // exact accepted proof
      const proof = await loadPublishedProof(room, hand, owner, kind);
      await verifyPublishedProof(proof);
      setLocalProofs((current) => ({ ...current, [key]: "verified" }));
    } catch {
      setLocalProofs((current) => ({ ...current, [key]: "failed" }));
    }
  }

  if (seat === undefined) return <p className="table-status">Loading room…</p>;
  if (seat === null) return <div className="room-status"><strong>No seat for this room</strong><Link href="/">Back to lobby</Link></div>;
  if (waiting) {
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

  const contract: ContractView = {
    assignment: !view.challenge
      ? { kind: "available" }
      : !view.challenge.assigned
        ? { kind: "draw", handNo: view.challenge.hand_no }
        : {
            kind: "assigned",
            handNo: view.challenge.hand_no,
            objective: objective ?? "Private objective unavailable",
            reward: CHALLENGE_POINTS,
            active: !view.settled,
            drawVerified: view.challenge.draw_verified,
            drawState,
            commitment: view.challenge.commitment ?? "",
            nonce: view.challenge.nonce ?? "",
            catalogRoot: view.challenge.catalog_root ?? "",
          },
    claim: view.claim
      ? {
          handNo: view.claim.hand_no,
          objective: claimObjective,
          reward: view.claim.points ?? CHALLENGE_POINTS,
          completed: claimCompleted,
          state: claimState,
        }
      : undefined,
    proofs: view.proofs.map((proof) => ({
      seat: proof.seat,
      name: proof.seat === seat ? "You" : `Player ${proof.seat + 1}`,
      points: view.players[proof.seat]?.proof_points ?? 0,
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
      {!connected && <div className="connection-bar"><span>{connecting ? "Connecting" : "Disconnected"}</span>{!connecting && <button type="button" onClick={connect}>Reconnect</button>}</div>}
      {view.mode === "multiplayer" && (
        <PrivateChallengeBar
          view={contract}
          onRetry={(kind) => {
            if (kind === "draw") void drawChallenge();
            else void claimChallenge();
          }}
        />
      )}
      <Table
        view={view}
        viewer={seat}
        room={room}
        error={error}
        disabled={actionPending || notices.length > 0 || !connected}
        notice={notices[0]}
        finish={finish}
        raiseTo={raiseTo}
        setRaiseTo={setRaiseTo}
        onFold={() => send({ type: "fold" })}
        onCheck={() => send({ type: "check" })}
        onCall={() => send({ type: "call" })}
        onRaise={() => send({ type: "raise_to", to: raiseTo })}
        onReady={() => send({ type: "ready", entropy: freshEntropy() })}
        contract={contract}
        onCommitContract={commitChallenge}
        onVerifyDraw={() => void drawChallenge()}
        onGenerateProof={() => void claimChallenge()}
        onVerifyProof={(owner, hand, kind) => void verifyProof(owner, hand, kind)}
      />
      {view.mode === "multiplayer" && <PlayProofs room={room} view={contract} />}
    </div>
  );
}
