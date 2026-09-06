"use client";

import Link from "next/link";
import { DealIntegrity } from "@/components/deal-integrity";
import { Table } from "@/components/table";
import { useRoomSession } from "@/lib/use-room-session";

export function MultiplayerGame({ room }: { room: string }) {
  return <RoomGame key={room} room={room} />;
}

function RoomGame({ room }: { room: string }) {
  const session = useRoomSession(room);
  const { seat, waiting, view, error, connection, connect } = session;
  const reconnect = connection === "disconnected";

  if (seat === undefined) return <p className="table-status">Loading room…</p>;
  if (seat === null) return <div className="room-status"><strong>{error ?? "No seat for this room"}</strong><Link href="/">Back to lobby</Link></div>;
  if (connection === "auth_error") return <div className="room-status"><strong>Seat authentication failed</strong><p>{error}</p><Link href="/">Return to saved seats</Link></div>;
  if (waiting) {
    return (
      <div className="waiting-room">
        <p className="protocol-label">Room {room}</p>
        <h2>Waiting for the table.</h2>
        <strong>{waiting.joined} / {waiting.players} seats</strong>
        {waiting.deal && <DealIntegrity deal={waiting.deal} room={room} />}
        <p>{session.evidenceUnavailable ? "Earlier participant evidence is unavailable in this browser." : "Your browser records this hand’s commitment before saving and sending its randomness share."}</p>
        {error && <p className="form-error">{error}</p>}
        {reconnect && <button type="button" onClick={connect}>Reconnect →</button>}
      </div>
    );
  }
  if (!view || !session.contract) return <div className="room-status"><strong>{error ?? "Connecting to table"}</strong>{reconnect && <button type="button" onClick={connect}>Reconnect</button>}</div>;

  return (
    <>
      {connection !== "connected" && <div className="connection-bar"><span>{connection === "connecting" ? "Connecting" : "Disconnected"}</span>{reconnect && <button type="button" onClick={connect}>Reconnect</button>}</div>}
      {session.evidenceUnavailable && <p className="table-status">Participant evidence unavailable for this hand. Its public audit can check transcript consistency only.</p>}
      <Table
        view={view}
        viewer={seat}
        room={room}
        error={error}
        disabled={session.disabled}
        raiseTo={session.raiseTo}
        setRaiseTo={session.setRaiseTo}
        onFold={() => session.bet({ type: "fold" })}
        onCheck={() => session.bet({ type: "check" })}
        onCall={() => session.bet({ type: "call" })}
        onRaise={() => session.bet({ type: "raise_to", to: session.raiseTo })}
        onReady={session.ready}
        contract={session.contract}
        onCommitContract={session.commit}
        onVerifyDraw={() => session.prove("draw")}
        onGenerateProof={() => session.prove("claim")}
      />
    </>
  );
}
