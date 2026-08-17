"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  Table,
  type ChallengeView,
  type ClaimView,
  type View,
} from "@/components/table";
import {
  CHALLENGE_VERSION,
  commitment as challengeCommitment,
  decodeHex,
  encodeHex,
  loadChallengeSecret,
  objectiveDescription,
  objectiveIndex,
  saveChallengeSecret,
} from "@/lib/challenge";
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
  | { type: "challenge_commit"; hand_no: number; tier: number; commitment: string }
  | { type: "ready" };

type Assignment = {
  hand_no: number;
  hand_tag: string;
  tier: number;
  commitment: string;
  nonce: string;
};

function challengeAssignment(challenge: ChallengeView | undefined): Assignment | undefined {
  if (
    challenge?.assigned &&
    challenge.tier !== undefined &&
    challenge.commitment !== undefined &&
    challenge.nonce !== undefined
  ) {
    return {
      hand_no: challenge.hand_no,
      hand_tag: challenge.hand_tag,
      tier: challenge.tier,
      commitment: challenge.commitment,
      nonce: challenge.nonce,
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
    tier: claim.tier,
    commitment: claim.commitment,
    nonce: claim.nonce,
  };
}

function privateObjective(room: string, seat: number, assignment: Assignment | undefined) {
  if (!assignment) {
    return {};
  }

  const stored = loadChallengeSecret(room, assignment.hand_no, seat);

  if (!stored) {
    return { error: "Challenge secret unavailable" };
  }

  try {
    const secret = decodeHex(stored.secret);
    const handTag = decodeHex(assignment.hand_tag);
    const expected = encodeHex(challengeCommitment(handTag, seat, assignment.tier, secret));

    if (
      stored.tier !== assignment.tier ||
      stored.commitment !== assignment.commitment ||
      expected !== assignment.commitment
    ) {
      return { error: "Challenge commitment mismatch" };
    }

    const index = objectiveIndex(
      handTag,
      seat,
      assignment.tier,
      decodeHex(assignment.nonce),
      secret,
    );

    return { objective: objectiveDescription(assignment.tier, index) };
  } catch {
    return { error: "Invalid challenge assignment" };
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
  const [challengeError, setChallengeError] = useState<string>();

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
        const currentClaim = privateObjective(
          room,
          current.seat,
          claimAssignment(message.view.claim),
        );

        setWaiting(undefined);
        setView(message.view);
        setRaiseTo(message.view.actions?.raise?.min_to ?? 0);
        setObjective(currentChallenge.objective);
        setClaimObjective(currentClaim.objective);
        setChallengeError(currentChallenge.error ?? currentClaim.error);
        setConnected(true);
        setConnecting(false);
        setPending(false);
        setError(undefined);
        return;
      }

      if (message.type === "error") {
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
        setConnecting(false);
        setError("Connection failed");
      }
    };

    next.onclose = () => {
      if (socket.current === next) {
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

  function chooseChallenge(tier: number) {
    const challenge = view?.challenge;

    if (
      !challenge ||
      challenge.assigned ||
      typeof seat !== "number" ||
      (tier !== 0 && tier !== 1)
    ) {
      return;
    }

    try {
      const secret = crypto.getRandomValues(new Uint8Array(32));
      const value = encodeHex(
        challengeCommitment(decodeHex(challenge.hand_tag), seat, tier, secret),
      );

      saveChallengeSecret(room, challenge.hand_no, seat, {
        version: CHALLENGE_VERSION,
        tier,
        secret: encodeHex(secret),
        commitment: value,
      });
      send({
        type: "challenge_commit",
        hand_no: challenge.hand_no,
        tier,
        commitment: value,
      });
    } catch {
      setChallengeError("Challenge setup failed");
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
        onChallenge={chooseChallenge}
        objective={objective}
        claimObjective={claimObjective}
        challengeError={challengeError}
      />
    </>
  );
}
