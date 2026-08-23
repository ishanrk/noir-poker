"use client";
import { useCallback, useEffect, useRef, useState } from "react";

import { SiteHeader } from "@/components/site-header";
import { verifyReceipt, type ReceiptProof } from "@/lib/receipt";
import { loadProofReceipt, type ProofReceipt } from "@/lib/server";

type State = "waiting" | "verifying" | "verified" | "skipped" | "failed";

const status = (state: State) =>
  ({
    waiting: "queued",
    verifying: "checking locally",
    verified: "verified",
    skipped: "not published",
    failed: "invalid",
  })[state];

function ReceiptSeal({ verified }: { verified: boolean }) {
  return (
    <div className="receipt-seal" data-verified={verified}>
      <span>Hidden challenge</span>
      <strong>{verified ? "VALID" : "?"}</strong>
      <small>{verified ? "challenge completed" : "still private"}</small>
      <i aria-hidden="true" />
    </div>
  );
}

function VerificationTimeline({
  receipt,
  draw,
  completion,
}: {
  receipt: boolean;
  draw: State;
  completion: State;
}) {
  const verified = (draw === "verified" || draw === "skipped") && completion === "verified";

  return (
    <section className="verification-timeline" aria-live="polite">
      <div data-state={receipt ? "verified" : "verifying"}>
        <span>01</span>
        <p>Receipt context</p>
        <strong>{receipt ? "room + hand bound" : "loading"}</strong>
      </div>
      <div data-state={draw}>
        <span>02</span>
        <p>Optional fair draw proof</p>
        <strong>{status(draw)}</strong>
      </div>
      <div data-state={completion}>
        <span>03</span>
        <p>Completion proof</p>
        <strong>{status(completion)}</strong>
      </div>
      <div data-state={verified ? "verified" : "waiting"}>
        <span>04</span>
        <p>Challenge win</p>
        <strong>{verified ? "counted for leaderboard" : "waiting"}</strong>
      </div>
    </section>
  );
}

export function ProofReceiptPreview() {
  return (
    <div className="proof-receipt-preview" aria-label="Accepted public challenge receipt">
      <ReceiptSeal verified />
      <VerificationTimeline receipt draw="verified" completion="verified" />
      <div className="receipt-actions proof-receipt-preview-actions">
        <button type="button" disabled>Run again</button>
        <button type="button" disabled>Export JSON</button>
      </div>
    </div>
  );
}

export function ProofReceiptView({ nullifier }: { nullifier: string }) {
  const [receipt, setReceipt] = useState<ProofReceipt>();
  const receiptRef = useRef<ProofReceipt | undefined>(undefined);
  const running = useRef(false);
  const mounted = useRef(true);
  const [draw, setDraw] = useState<State>("waiting");
  const [completion, setCompletion] = useState<State>("waiting");
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const verify = useCallback(async (loaded?: ProofReceipt) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(undefined);
    setDraw("waiting");
    setCompletion("waiting");
    let step: ReceiptProof = "draw";

    try {
      const value = loaded ?? receiptRef.current ?? (await loadProofReceipt(nullifier));
      if (!mounted.current) return;
      receiptRef.current = value;
      setReceipt(value);
      const hasDraw = Boolean(value.draw_proof && value.draw_public_inputs);
      step = hasDraw ? "draw" : "completion";
      setDraw(hasDraw ? "verifying" : "skipped");
      if (!hasDraw) setCompletion("verifying");
      await verifyReceipt(value, (proof) => {
        if (!mounted.current) return;
        if (proof === "draw") {
          step = "completion";
          setDraw("verified");
          setCompletion("verifying");
        } else {
          setCompletion("verified");
        }
      });
    } catch (cause) {
      if (!mounted.current) return;
      if (step === "draw") setDraw("failed");
      else setCompletion("failed");
      setError(cause instanceof Error ? cause.message : "proof verification failed");
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [nullifier]);

  useEffect(() => {
    mounted.current = true;
    let live = true;
    receiptRef.current = undefined;
    queueMicrotask(() => {
      if (!live) return;
      setReceipt(undefined);
      setDraw("waiting");
      setCompletion("waiting");
      setError(undefined);
    });

    void loadProofReceipt(nullifier)
      .then((value) => {
        if (!live) return;
        receiptRef.current = value;
        setReceipt(value);
        setDraw(value.draw_proof && value.draw_public_inputs ? "waiting" : "skipped");
      })
      .catch((cause) => {
        if (!live) return;
        setDraw("failed");
        setError(cause instanceof Error ? cause.message : "proof receipt unavailable");
      });

    return () => {
      live = false;
      mounted.current = false;
    };
  }, [nullifier]);

  async function copyLink() {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  function exportReceipt() {
    if (!receipt) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(receipt, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `noir-poker-challenge-${receipt.nullifier.slice(0, 12)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const verified = (draw === "verified" || draw === "skipped") && completion === "verified";

  return (
    <main className="site-shell proof-page">
      <SiteHeader compact />
      <header className="receipt-hero">
        <div>
          <p className="eyebrow">Public challenge verifier</p>
          <h1>{verified ? "The challenge was completed." : receipt ? "Proof ready to verify." : "Loading proof."}</h1>
          <p>
            This browser checks every published UltraHonk proof. The challenge and private fact
            vector never appear in the receipt.
          </p>
        </div>
        <ReceiptSeal verified={verified} />
      </header>

      <VerificationTimeline receipt={Boolean(receipt)} draw={draw} completion={completion} />

      <p className="story-note">A completion proof does not require a previous draw proof</p>
      <p className="story-note">
        The completion circuit checks server derived facts against their public commitment It does
        not replay the poker action log
      </p>

      {error && <p className="proof-error">{error}</p>}

      {receipt && (
        <section className="receipt-statement">
          <div className="section-index">
            <span>Statement</span>
            <p>Proof statement</p>
          </div>
          <div>
            <h2>
              A committed secret selected one valid challenge, and that same hidden challenge was
              satisfied by the committed hand facts.
            </h2>
            <div className="statement-grid">
              <article>
                <span>Public</span>
                <strong>
                  Room {receipt.room.slice(0, 8)} hand {receipt.hand_no + 1} seat {receipt.seat + 1}
                </strong>
              </article>
              <article>
                <span>Hidden</span>
                <strong>Challenge, secret, Merkle path and six hand facts</strong>
              </article>
              <article>
                <span>Toolchain</span>
                <strong>Noir, UltraHonk, Barretenberg {receipt.bb_version}</strong>
              </article>
              <article>
                <span>Replay guard</span>
                <strong>{receipt.nullifier.slice(0, 18)}…</strong>
              </article>
            </div>
          </div>
        </section>
      )}

      <section className="receipt-actions">
        <button type="button" onClick={() => void copyLink()} disabled={!receipt}>
          {copied ? "Link copied" : "Share verifier"}
        </button>
        <button type="button" onClick={() => void verify()} disabled={!receipt || busy}>
          {verified || error ? "Run again" : "Verify proof"}
        </button>
        <details>
          <summary>Developer verification</summary>
          <code>npm --prefix apps/web run proof:verify -- receipt.json</code>
          <button type="button" onClick={exportReceipt}>
            Export JSON
          </button>
        </details>
        <a href="/protocol#challenge-proofs" target="_blank" rel="noreferrer">
          Protocol and references
        </a>
      </section>
    </main>
  );
}
