"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { verifyReceipt } from "@/lib/receipt";
import { loadProofReceipt, type ProofReceipt } from "@/lib/server";

type ReceiptStatus = "loading" | "verifying" | "verified" | "failed";

export function ProofReceiptView({ nullifier }: { nullifier: string }) {
  const [receipt, setReceipt] = useState<ProofReceipt>();
  const [status, setStatus] = useState<ReceiptStatus>("loading");
  const [error, setError] = useState<string>();

  useEffect(() => {
    let live = true;

    void loadProofReceipt(nullifier)
      .then(async (value) => {
        if (!live) return;
        setReceipt(value);
        setStatus("verifying");
        await verifyReceipt(value);
        if (live) setStatus("verified");
      })
      .catch((cause) => {
        if (!live) return;
        setStatus("failed");
        setError(cause instanceof Error ? cause.message : "proof verification failed");
      });

    return () => {
      live = false;
    };
  }, [nullifier]);

  function download() {
    if (!receipt) return;

    const url = URL.createObjectURL(
      new Blob([JSON.stringify(receipt, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");

    link.href = url;
    link.download = `noir-poker-${receipt.nullifier}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="proof-page">
      <p className="eyebrow">Noir Poker</p>
      <h1>Proof receipt</h1>
      <strong className={`proof-status proof-${status}`}>{status}</strong>
      {error && <p className="room-error">{error}</p>}
      {receipt && (
        <dl className="proof-fields">
          <dt>Nullifier</dt>
          <dd>{receipt.nullifier}</dd>
          <dt>Hand tag</dt>
          <dd>{receipt.hand_tag}</dd>
          <dt>Seat</dt>
          <dd>{receipt.seat}</dd>
          <dt>Points</dt>
          <dd>{receipt.points}</dd>
          <dt>Circuit</dt>
          <dd>{receipt.circuit_id}</dd>
          <dt>Proof system</dt>
          <dd>{receipt.proof_system}</dd>
        </dl>
      )}
      <div className="proof-actions">
        <button type="button" onClick={download} disabled={!receipt}>
          Download JSON
        </button>
        <Link href="/">Back to lobby</Link>
      </div>
    </main>
  );
}
