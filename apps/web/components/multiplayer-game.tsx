"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { Table, type View } from "@/components/table";
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
  | { type: "raise_to"; to: number };

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
        setWaiting(undefined);
        setView(message.view);
        setRaiseTo(message.view.actions?.raise?.min_to ?? 0);
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
      />
    </>
  );
}
