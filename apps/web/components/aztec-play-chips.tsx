"use client";

import { useEffect, useState } from "react";

import { AztecConnect } from "@/components/aztec-connect";
import { AZTEC_TESTNET_NODE_URL } from "@/lib/aztec/config";
import type { AztecEntryReceipt } from "@/lib/aztec/entry";
import type { AztecSession } from "@/lib/aztec/session";

const SEATS = [0, 1, 2, 3, 4, 5] as const;

export function AztecPlayChips() {
  const [session, setSession] = useState<AztecSession>();
  const [room, setRoom] = useState("");
  const [seat, setSeat] = useState(0);
  const [buyIn, setBuyIn] = useState(1_000);
  const [receipt, setReceipt] = useState<AztecEntryReceipt>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.noirMode = "aztec";

    return () => {
      if (root.dataset.noirMode === "aztec") delete root.dataset.noirMode;
    };
  }, []);

  async function enter() {
    if (!session) return;

    setBusy(true);
    setError(undefined);

    try {
      const { enterAztecRoom } = await import("@/lib/aztec/entry");
      setReceipt(await enterAztecRoom(session, room, seat, buyIn));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Aztec entry failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="chips-console">
      <header className="chips-intro">
        <p className="eyebrow">Tajadero account</p>
        <h1>Balance and table entry</h1>
        <p>Connect a testnet wallet then claim Tajaderos or lock one table buy-in.</p>
      </header>

      <AztecConnect onSession={setSession} />

      {session?.ready && (
        <section className="chips-buy-in">
          <header>
            <h2>Table entry</h2>
            <p>Lock Tajaderos against one room and seat.</p>
          </header>

          <label className="line-input">
            Room ID
            <input
              type="text"
              value={room}
              onChange={(event) => setRoom(event.target.value.trim())}
              placeholder="00000000-0000-0000-0000-000000000000"
              spellCheck={false}
            />
          </label>

          <fieldset className="seat-scale chips-seats">
            <legend>Seat</legend>
            <div>
              {SEATS.map((value) => (
                <label key={value}>
                  <input
                    type="radio"
                    name="aztec-seat"
                    value={value}
                    checked={seat === value}
                    onChange={() => setSeat(value)}
                  />
                  <span>{value + 1}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <label className="scale-control">
            <span>
              Tajadero buy-in
              <output>{buyIn.toLocaleString()}</output>
            </span>
            <input
              type="range"
              min="100"
              max="5000"
              step="100"
              value={buyIn}
              onChange={(event) => setBuyIn(Number(event.target.value))}
            />
            <span className="scale-ticks" aria-hidden="true">
              <i>100</i>
              <i>5k</i>
            </span>
          </label>

          <button
            className="primary-action"
            type="button"
            onClick={() => void enter()}
            disabled={busy || room.length !== 36 || session.balance < BigInt(buyIn)}
          >
            {busy ? "Locking Tajaderos" : `Lock ${buyIn.toLocaleString()} Tajaderos`}
          </button>

          {error && <p className="aztec-connect-error">{error}</p>}
        </section>
      )}

      {receipt && (
        <section className="chips-receipt">
          <p className="eyebrow">Entry confirmed</p>
          <h2>{Number(receipt.amount).toLocaleString()} Tajaderos locked</h2>
          <dl>
            <div>
              <dt>Room</dt>
              <dd><code>{receipt.room}</code></dd>
            </div>
            <div>
              <dt>Seat</dt>
              <dd>{receipt.seat + 1}</dd>
            </div>
            <div>
              <dt>Entry</dt>
              <dd><code>{receipt.entryId}</code></dd>
            </div>
            <div>
              <dt>Transaction</dt>
              <dd><code>{receipt.txHash}</code></dd>
            </div>
          </dl>
        </section>
      )}

      <details className="chips-network">
        <summary>Technical details</summary>
        <span>Aztec 5.1.0 testnet</span>
        <code>{AZTEC_TESTNET_NODE_URL}</code>
      </details>
    </section>
  );
}
