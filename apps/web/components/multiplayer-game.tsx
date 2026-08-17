"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import type { ContractView, ProofState } from "@/components/contract";
import {
  Table,
  type ChallengeView,
  type ClaimView,
  type View,
} from "@/components/table";
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
import { loadSeat, type RoomSeat, roomSocket } from "@/lib/server";

type Waiting = {
  joined: number;
  players: number;
};

type ServerMessage =
  | ({ type: "waiting" } & Waiting)
  | { type: "snapshot"; rev: number; view: View }
  | { type: "error"; message: string };

type ClientAction =
  | { type: "fold" }
  | { type: "check" }
  | { type: "call" }
  | { type: "raise_to"; to: number }
  | { type: "challenge_commit"; hand_no: number; commitment: string }
  | { type: "challenge_draw"; hand_no: number; proof: string; public_inputs: string }
  | { type: "challenge_claim"; hand_no: number; proof: string; public_inputs: string }
  | { type: "ready" };

type Assignment = {
  hand_no: number;
  hand_tag: string;
  commitment: string;
  nonce: string;
  catalog_root: string;
  draw_verified: boolean;
};

type PrivateObjective = {
  objective?: string;
  index?: number;
  error?: string;
};

type ContractCompletion = {
  completed?: boolean;
  error?: string;
};

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
  if (!claim) {
    return undefined;
  }

  return {
    hand_no: claim.hand_no,
    hand_tag: claim.hand_tag,
    commitment: claim.commitment,
    nonce: claim.nonce,
    catalog_root: claim.catalog_root,
    draw_verified: true,
  };
}

function privateObjective(
  room: string,
  seat: number,
  assignment: Assignment | undefined,
): PrivateObjective {
  if (!assignment) {
    return {};
  }

  const stored = loadChallengeSecret(room, assignment.hand_no, seat);

  if (!stored) {
    return { error: "Contract secret unavailable" };
  }

  try {
    const secret = decodeHex(stored.secret);
    const handTag = decodeHex(assignment.hand_tag);
    const expected = encodeHex(challengeCommitment(handTag, seat, secret));
    const root = encodeHex(catalogRoot());

    if (root !== assignment.catalog_root) {
      return { error: "Contract catalog mismatch" };
    }

    if (
      stored.commitment !== assignment.commitment ||
      expected !== assignment.commitment
    ) {
      return { error: "Contract commitment mismatch" };
    }

    const index = objectiveIndex(
      handTag,
      seat,
      decodeHex(assignment.nonce),
      secret,
    );

    return { objective: objectiveAt(index).description, index };
  } catch {
    return { error: "Invalid contract assignment" };
  }
}

function contractCompletion(
  claim: ClaimView | undefined,
  seat: number,
  index: number | undefined,
): ContractCompletion {
  if (!claim || claim.status === "claimed" || index === undefined) {
    return {};
  }

  try {
    const hash = encodeHex(
      factsHash(decodeHex(claim.hand_tag), seat, decodeHex(claim.facts_salt), claim.facts),
    );

    if (hash !== claim.facts_hash) {
      return { error: "Contract facts mismatch" };
    }

    return { completed: objectiveMet(objectiveAt(index), claim.facts) };
  } catch {
    return { error: "Invalid contract facts" };
  }
}

function closeSocket(socket: WebSocket) {
  socket.onopen = null;
  socket.onmessage = null;
  socket.onerror = null;
  socket.onclose = null;

  if (socket.readyState < WebSocket.CLOSING) {
    socket.close();
  }
}

type MultiplayerGameProps = {
  room: string;
};

export function MultiplayerGame({ room }: MultiplayerGameProps) {
  const socket = useRef<WebSocket | undefined>(undefined);
  const auth = useRef<RoomSeat | undefined>(undefined);
  const rev = useRef(-1);
  const drawing = useRef(false);
  const claiming = useRef(false);
  const [seat, setSeat] = useState<number | null>();
  const [waiting, setWaiting] = useState<Waiting>();
  const [view, setView] = useState<View>();
  const [error, setError] = useState<string>();
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [pending, setPending] = useState(false);
  const [raiseTo, setRaiseTo] = useState(0);
  const [objective, setObjective] = useState<string>();
  const [claimObjective, setClaimObjective] = useState<string>();
  const [claimCompleted, setClaimCompleted] = useState<boolean>();
  const [challengeError, setChallengeError] = useState<string>();
  const [drawState, setDrawState] = useState<ProofState>("idle");
  const [claimState, setClaimState] = useState<ProofState>("idle");

  const connect = useCallback(() => {
    const current = auth.current;

    if (!current) {
      return;
    }

    if (socket.current) {
      closeSocket(socket.current);
    }

    setConnecting(true);
    setConnected(false);
    setPending(false);
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

    next.onopen = () => {
      next.send(JSON.stringify({ type: "auth", token: current.token }));
    };

    next.onmessage = (event) => {
      if (socket.current !== next || typeof event.data !== "string") {
        return;
      }

      let message: ServerMessage;

      try {
        message = JSON.parse(event.data) as ServerMessage;
      } catch {
        setPending(false);
        setError("Invalid server message");
        return;
      }

      if (message.type === "waiting") {
        setWaiting({ joined: message.joined, players: message.players });
        setView(undefined);
        setConnected(true);
        setConnecting(false);
        setPending(false);
        setError(undefined);
        return;
      }

      if (message.type === "snapshot") {
        if (message.rev < rev.current) {
          return;
        }

        rev.current = message.rev;
        const currentChallenge = privateObjective(
          room,
          current.seat,
          challengeAssignment(message.view.challenge),
        );
        const claimed = message.view.claim?.status === "claimed";
        const currentClaim: PrivateObjective = claimed
          ? {}
          : privateObjective(room, current.seat, claimAssignment(message.view.claim));
        const completion = contractCompletion(
          message.view.claim,
          current.seat,
          currentClaim.index,
        );
        const drawVerified = message.view.challenge?.draw_verified === true;

        if (drawVerified) {
          drawing.current = false;
          setDrawState("verified");
        } else if (!drawing.current) {
          setDrawState("idle");
        }

        if (claimed && message.view.claim) {
          removeChallengeSecret(room, message.view.claim.hand_no, current.seat);
          claiming.current = false;
          setClaimState("verified");
        } else if (!claiming.current) {
          setClaimState("idle");
        }

        setWaiting(undefined);
        setView(message.view);
        setRaiseTo(message.view.actions?.raise?.min_to ?? 0);
        setObjective(currentChallenge.objective);
        setClaimObjective(currentClaim.objective);
        setClaimCompleted(completion.completed);
        setChallengeError(
          currentChallenge.error ?? currentClaim.error ?? completion.error,
        );
        setConnected(true);
        setConnecting(false);
        setPending(drawing.current || claiming.current);
        setError(undefined);
        return;
      }

      if (message.type === "error") {
        if (drawing.current) {
          drawing.current = false;
          setDrawState("failed");
        }

        if (claiming.current) {
          claiming.current = false;
          setClaimState("failed");
        }

        setConnecting(false);
        setPending(false);
        setError(message.message);
        return;
      }

      setPending(false);
      setError("Invalid server message");
    };

    next.onerror = () => {
      if (socket.current === next) {
        if (drawing.current) {
          drawing.current = false;
          setDrawState("failed");
        }

        setConnecting(false);
        setError("Connection failed");
      }
    };

    next.onclose = () => {
      if (socket.current === next) {
        if (claiming.current) {
          claiming.current = false;
          setClaimState("failed");
        }

        socket.current = undefined;
        setConnecting(false);
        setConnected(false);
        setPending(false);
        setError((currentError) => currentError ?? "Disconnected");
      }
    };
  }, [room]);

  useEffect(() => {
    let live = true;
    const current = loadSeat(room);

    queueMicrotask(() => {
      if (!live) {
        return;
      }

      if (!current) {
        setSeat(null);
        return;
      }

      auth.current = current;
      setSeat(current.seat);
      connect();
    });

    return () => {
      live = false;

      if (socket.current) {
        closeSocket(socket.current);
        socket.current = undefined;
      }
    };
  }, [connect, room]);

  function send(action: ClientAction) {
    const current = socket.current;

    if (!current || current.readyState !== WebSocket.OPEN || !connected || pending) {
      return;
    }

    setPending(true);
    setError(undefined);
    current.send(JSON.stringify(action));
  }

  function chooseChallenge() {
    const challenge = view?.challenge;

    if (
      !challenge ||
      challenge.assigned ||
      typeof seat !== "number"
    ) {
      return;
    }

    try {
      const secret = crypto.getRandomValues(new Uint8Array(32));
      const value = encodeHex(
        challengeCommitment(decodeHex(challenge.hand_tag), seat, secret),
      );

      saveChallengeSecret(room, challenge.hand_no, seat, {
        version: CHALLENGE_VERSION,
        secret: encodeHex(secret),
        commitment: value,
      });
      send({
        type: "challenge_commit",
        hand_no: challenge.hand_no,
        commitment: value,
      });
    } catch {
      setChallengeError("Contract setup failed");
    }
  }

  async function drawChallenge() {
    const assignment = challengeAssignment(view?.challenge);
    const current = socket.current;

    if (
      !assignment ||
      assignment.draw_verified ||
      typeof seat !== "number" ||
      !current ||
      current.readyState !== WebSocket.OPEN ||
      !connected ||
      pending ||
      drawing.current
    ) {
      return;
    }

    const stored = loadChallengeSecret(room, assignment.hand_no, seat);

    if (!stored) {
      setChallengeError("Contract secret unavailable");
      setDrawState("failed");
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
      ) {
        throw new Error("challenge mismatch");
      }

      drawing.current = true;
      setPending(true);
      setError(undefined);
      setChallengeError(undefined);

      const result = await proveChallenge(
        {
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
        },
        (status: ProofStatus) => setDrawState(status),
      );

      if (socket.current !== current || current.readyState !== WebSocket.OPEN) {
        throw new Error("socket closed");
      }

      setDrawState("verifying");
      current.send(
        JSON.stringify({
          type: "challenge_draw",
          hand_no: assignment.hand_no,
          proof: result.proof,
          public_inputs: result.public_inputs,
        } satisfies ClientAction),
      );
    } catch {
      drawing.current = false;
      setPending(false);
      setDrawState("failed");
      setChallengeError("Draw proof failed");
    }
  }

  async function claimChallenge() {
    const claim = view?.claim;
    const current = socket.current;

    if (
      !claim ||
      claim.status !== "claimable" ||
      typeof seat !== "number" ||
      !current ||
      current.readyState !== WebSocket.OPEN ||
      !connected ||
      pending ||
      claiming.current
    ) {
      return;
    }

    const stored = loadChallengeSecret(room, claim.hand_no, seat);

    if (!stored) {
      setChallengeError("Contract secret unavailable");
      setClaimState("failed");
      return;
    }

    try {
      const handTag = decodeHex(claim.hand_tag);
      const secret = decodeHex(stored.secret);
      const nonce = decodeHex(claim.nonce);
      const commitment = decodeHex(claim.commitment);
      const salt = decodeHex(claim.facts_salt);
      const expectedCommitment = challengeCommitment(handTag, seat, secret);
      const expectedFactsHash = factsHash(handTag, seat, salt, claim.facts);
      const index = objectiveIndex(handTag, seat, nonce, secret);
      const objective = objectiveAt(index);
      const siblings = objectivePath(index);
      const root = decodeHex(claim.catalog_root);
      const localRoot = catalogRoot();
      const verifiedRoot = pathRoot(leafHash(objective), index, siblings);

      if (
        stored.commitment !== claim.commitment ||
        encodeHex(expectedCommitment) !== claim.commitment ||
        encodeHex(expectedFactsHash) !== claim.facts_hash ||
        encodeHex(localRoot) !== claim.catalog_root ||
        encodeHex(verifiedRoot) !== encodeHex(root)
      ) {
        throw new Error("challenge mismatch");
      }

      if (!objectiveMet(objective, claim.facts)) {
        setClaimCompleted(false);
        setChallengeError("Contract not completed");
        return;
      }

      claiming.current = true;
      setPending(true);
      setError(undefined);
      setChallengeError(undefined);

      const result = await proveChallenge(
        {
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
        },
        (status: ProofStatus) => {
          setClaimState(status);
        },
      );

      if (socket.current !== current || current.readyState !== WebSocket.OPEN) {
        throw new Error("socket closed");
      }

      setClaimState("verifying");
      current.send(
        JSON.stringify({
          type: "challenge_claim",
          hand_no: claim.hand_no,
          proof: result.proof,
          public_inputs: result.public_inputs,
        } satisfies ClientAction),
      );
    } catch {
      claiming.current = false;
      setPending(false);
      setClaimState("failed");
      setChallengeError("Contract proof failed");
    }
  }

  if (seat === undefined) {
    return <p className="table-status">Loading room...</p>;
  }

  if (seat === null) {
    return (
      <div className="room-status">
        <strong>No seat for this room</strong>
        <Link href="/">Back to lobby</Link>
      </div>
    );
  }

  if (waiting) {
    return (
      <div className="room-status">
        <span>Room {room}</span>
        <strong>
          Waiting {waiting.joined} / {waiting.players}
        </strong>
        {error && <span className="room-error">{error}</span>}
        {!connecting && !connected && (
          <button type="button" onClick={connect}>
            Reconnect
          </button>
        )}
        <Link href="/">Back to lobby</Link>
      </div>
    );
  }

  if (!view) {
    return (
      <div className="room-status">
        <strong>{error ?? "Connecting to table"}</strong>
        {!connecting && !connected && (
          <button type="button" onClick={connect}>
            Reconnect
          </button>
        )}
        <Link href="/">Back to lobby</Link>
      </div>
    );
  }

  const contract: ContractView = {
    assignment: !view.challenge
      ? { kind: "available" }
      : !view.challenge.assigned
        ? { kind: "choose", handNo: view.challenge.hand_no }
        : {
            kind: "assigned",
            handNo: view.challenge.hand_no,
            objective: objective ?? "Private objective unavailable",
            reward: CHALLENGE_POINTS,
            active: !view.settled,
            drawVerified: view.challenge.draw_verified,
            drawState,
          },
    claim: view.claim
      ? {
          handNo: view.claim.hand_no,
          objective: claimObjective,
          reward: view.claim.points ?? CHALLENGE_POINTS,
          completed: claimCompleted,
          state: claimState,
          receipt: view.claim.nullifier
            ? `/proof/${view.claim.nullifier}`
            : undefined,
        }
      : undefined,
    error: challengeError,
  };

  return (
    <>
      {!connected && (
        <div className="connection-bar">
          <span>{connecting ? "Connecting" : "Disconnected"}</span>
          {!connecting && (
            <button type="button" onClick={connect}>
              Reconnect
            </button>
          )}
        </div>
      )}
      <Table
        view={view}
        viewer={seat}
        label="Live game"
        error={error}
        disabled={pending || !connected}
        raiseTo={raiseTo}
        setRaiseTo={setRaiseTo}
        onFold={() => send({ type: "fold" })}
        onCheck={() => send({ type: "check" })}
        onCall={() => send({ type: "call" })}
        onRaise={() => send({ type: "raise_to", to: raiseTo })}
        onReady={() => send({ type: "ready" })}
        contract={contract}
        onChooseContract={chooseChallenge}
        onDrawContract={() => void drawChallenge()}
        onGenerateProof={() => void claimChallenge()}
      />
    </>
  );
}
