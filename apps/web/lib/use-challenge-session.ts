"use client";

import { useRef, useState } from "react";
import type { ContractView, ProofState } from "../components/contract";
import type { ChallengeView, ClaimView, View } from "../components/table";
import {
  CHALLENGE_VERSION, CHALLENGE_POINTS, catalogRoot, commitment as challengeCommitment,
  decodeHex, encodeHex, factsHash, loadChallengeSecret, leafHash, nullifier as challengeNullifier,
  objectiveAt, objectiveIndex, objectiveMet, objectivePath, pathRoot, removeChallengeSecret, saveChallengeSecret,
} from "./challenge";
import { proveChallenge } from "./challenge-proof";
import { ProofSession } from "./proof-session";
import type { ClientAction } from "./room-protocol";

type Assignment = {
  hand_no: number; hand_tag: string; commitment: string; nonce: string; catalog_root: string;
};
type PrivateObjective = { objective?: string; index?: number; error?: string };

function assignment(challenge: ChallengeView | ClaimView | undefined): Assignment | undefined {
  if (!challenge || ("assigned" in challenge && !challenge.assigned) || !challenge.commitment || !challenge.nonce || !challenge.catalog_root) return;
  return { hand_no: challenge.hand_no, hand_tag: challenge.hand_tag, commitment: challenge.commitment, nonce: challenge.nonce, catalog_root: challenge.catalog_root };
}

function privateObjective(room: string, seat: number, value: Assignment | undefined): PrivateObjective {
  if (!value) return {};
  try {
    const stored = loadChallengeSecret(room, value.hand_no, seat);
    if (!stored) return { error: "Draw secret unavailable" };
    const secret = decodeHex(stored.secret);
    const handTag = decodeHex(value.hand_tag);
    if (encodeHex(catalogRoot()) !== value.catalog_root) return { error: "Catalog root mismatch" };
    if (stored.commitment !== value.commitment || encodeHex(challengeCommitment(handTag, seat, secret)) !== value.commitment) return { error: "Commitment mismatch" };
    const index = objectiveIndex(handTag, seat, decodeHex(value.nonce), secret);
    return { objective: objectiveAt(index).description, index };
  } catch {
    return { error: "Draw secret unavailable or invalid assignment" };
  }
}

export function useChallengeSession(room: string) {
  const session = useRef(new ProofSession());
  const latest = useRef<{ view: View; seat: number } | undefined>(undefined);
  const [drawState, setDrawState] = useState<ProofState>("idle");
  const [claimState, setClaimState] = useState<ProofState>("idle");
  const [error, setError] = useState<string>();
  const [objective, setObjective] = useState<string>();
  const [claimObjective, setClaimObjective] = useState<string>();
  const [completed, setCompleted] = useState<boolean>();

  function reset() {
    session.current.reset();
    setDrawState("idle");
    setClaimState("idle");
    setError(undefined);
  }

  function invalidate() {
    session.current.reset();
  }

  function fail() {
    const kind = session.current.operation?.kind;
    session.current.reset();
    if (kind === "draw") setDrawState("failed");
    if (kind === "claim") setClaimState("failed");
  }

  function restore(view: View, seat: number) {
    latest.current = { view, seat };
    session.current.reconcile(view.challenge, view.claim);
    const draw = privateObjective(room, seat, assignment(view.challenge));
    const claim = view.claim?.status === "claimed" ? {} : privateObjective(room, seat, assignment(view.claim));
    let completion: boolean | undefined;
    let failure = draw.error ?? claim.error;
    if (view.claim && view.claim.status !== "claimed" && claim.index !== undefined) {
      try {
        const hash = encodeHex(factsHash(decodeHex(view.claim.hand_tag), seat, decodeHex(view.claim.facts_salt), view.claim.facts));
        if (hash !== view.claim.facts_hash) throw new Error("facts mismatch");
        completion = objectiveMet(objectiveAt(claim.index), view.claim.facts);
      } catch { failure = "Facts commitment mismatch"; }
    }
    if (view.challenge?.draw_verified) setDrawState("verified");
    else if (session.current.operation?.kind !== "draw") setDrawState("idle");
    if (view.claim?.status === "claimed") {
      try { removeChallengeSecret(room, view.claim.hand_no, seat); }
      catch { failure = "Receipt accepted but local secret cleanup failed"; }
      setClaimState("verified");
    } else if (session.current.operation?.kind !== "claim") setClaimState("idle");
    setObjective(draw.objective);
    setClaimObjective(claim.objective);
    setCompleted(completion);
    setError(failure);
  }

  function commit(send: (message: ClientAction) => boolean) {
    const current = latest.current;
    const challenge = current?.view.challenge;
    if (!current || !challenge || challenge.assigned) return;
    try {
      const stored = loadChallengeSecret(room, challenge.hand_no, current.seat);
      const secret = stored ? decodeHex(stored.secret) : crypto.getRandomValues(new Uint8Array(32));
      const value = encodeHex(challengeCommitment(decodeHex(challenge.hand_tag), current.seat, secret));
      if (stored && stored.commitment !== value) throw new Error("challenge mismatch");
      if (!stored) saveChallengeSecret(room, challenge.hand_no, current.seat, { version: CHALLENGE_VERSION, secret: encodeHex(secret), commitment: value });
      send({ type: "challenge_commit", hand_no: challenge.hand_no, commitment: value });
    } catch { setError("Fair draw setup failed or local storage unavailable"); }
  }

  async function prove(kind: "draw" | "claim", send: (message: ClientAction) => boolean) {
    const current = latest.current;
    if (!current || session.current.operation) return;
    const target = kind === "draw" ? current.view.challenge : current.view.claim;
    const value = assignment(target);
    if (!value || !target || ("draw_verified" in target && target.draw_verified) || ("status" in target && target.status !== "claimable")) return;
    const operation = session.current.start(room, value.hand_no, kind);
    const state = kind === "draw" ? setDrawState : setClaimState;
    const claim = kind === "claim" ? current.view.claim : undefined;
    try {
      const stored = loadChallengeSecret(room, value.hand_no, current.seat);
      if (!stored) throw new Error("secret unavailable");
      const handTag = decodeHex(value.hand_tag);
      const secret = decodeHex(stored.secret);
      const nonce = decodeHex(value.nonce);
      const commitment = decodeHex(value.commitment);
      const index = objectiveIndex(handTag, current.seat, nonce, secret);
      const objective = objectiveAt(index);
      const siblings = objectivePath(index);
      const root = decodeHex(value.catalog_root);
      const salt = claim ? decodeHex(claim.facts_salt) : new Uint8Array(32);
      const hash = claim ? factsHash(handTag, current.seat, salt, claim.facts) : new Uint8Array(32);
      if (stored.commitment !== value.commitment || encodeHex(challengeCommitment(handTag, current.seat, secret)) !== value.commitment ||
        encodeHex(catalogRoot()) !== value.catalog_root || encodeHex(pathRoot(leafHash(objective), index, siblings)) !== encodeHex(root) ||
        (claim && encodeHex(hash) !== claim.facts_hash)) throw new Error("challenge mismatch");
      if (claim && !objectiveMet(objective, claim.facts)) {
        session.current.operation = undefined;
        setCompleted(false);
        return;
      }
      setError(undefined);
      const result = await proveChallenge({
        mode: kind === "draw" ? 0 : 1, handTag, seat: current.seat, commitment, nonce,
        factsHash: hash, nullifier: claim ? challengeNullifier(handTag, current.seat, secret) : new Uint8Array(32),
        catalogRoot: root, secret, factsSalt: salt, facts: claim?.facts ?? [0, 0, 0, 0, 0, 0],
        mustTrue: objective.mustTrue, mustFalse: objective.mustFalse, siblings,
      }, (status) => { if (session.current.current(operation)) state(status); });
      if (!session.current.current(operation)) return;
      state("verifying");
      if (!send({ type: kind === "draw" ? "challenge_draw" : "challenge_claim", hand_no: value.hand_no, ...result })) throw new Error("socket closed");
    } catch {
      if (!session.current.current(operation)) return;
      session.current.operation = undefined;
      state("failed");
      setError(kind === "draw" ? "Draw proof failed" : "Completion proof failed");
    }
  }

  function contract(view: View): ContractView {
    return {
      assignment: !view.challenge ? { kind: "available" } : !view.challenge.assigned ? { kind: "draw", handNo: view.challenge.hand_no } : {
        kind: "assigned", handNo: view.challenge.hand_no, objective: objective ?? "Private objective unavailable",
        reward: CHALLENGE_POINTS, active: !view.settled, drawVerified: view.challenge.draw_verified, drawState,
        commitment: view.challenge.commitment ?? "", nonce: view.challenge.nonce ?? "", catalogRoot: view.challenge.catalog_root ?? "",
      },
      claim: view.claim ? { handNo: view.claim.hand_no, objective: claimObjective, reward: view.claim.points ?? CHALLENGE_POINTS,
        completed, state: claimState, receipt: view.claim.nullifier ? `/proof/${view.claim.nullifier}` : undefined } : undefined,
      error,
    };
  }

  return { reset, invalidate, fail, restore, commit, prove, contract, pending: () => !!session.current.operation };
}
