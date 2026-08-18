"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { verifyReceipt, type ReceiptProof } from "@/lib/receipt";
import { loadProofReceipt, type ProofReceipt } from "@/lib/server";

type VerificationState = "waiting" | "verifying" | "verified" | "failed";

function statusLabel(state: VerificationState) {
  switch (state) {
    case "waiting":
      return "waiting";
    case "verifying":
      return "verifying locally";
    case "verified":
      return "verified";
    case "failed":
      return "invalid";
  }
}

export function ProofReceiptView({ nullifier }: { nullifier: string }) {
  const [receipt, setReceipt] = useState<ProofReceipt>();
  const [draw, setDraw] = useState<VerificationState>("waiting");
  const [completion, setCompletion] = useState<VerificationState>("waiting");
  const [error, setError] = useState<string>();

  useEffect(() => {
    let live = true;

    async function load() {
      let loaded = false;
      let step: ReceiptProof = "draw";

      try {
        const value = await loadProofReceipt(nullifier);

        if (!live) {
          return;
        }
        loaded = true;
        setReceipt(value);
        setDraw("verifying");
        await verifyReceipt(value, (verified) => {
          if (!live) {
            return;
          }

          if (verified === "draw") {
            step = "completion";
            setDraw("verified");
            setCompletion("verifying");
          } else {
            setCompletion("verified");
          }
        });
      } catch (cause) {
        if (!live) {
          return;
        }

        if (loaded) {
          if (step === "draw") {
            setDraw("failed");
          } else {
            setCompletion("failed");
          }
        }

        setError(cause instanceof Error ? cause.message : "proof verification failed");
      }
    }

    void load();

    return () => {
      live = false;
    };
  }, [nullifier]);

  function download() {
    if (!receipt) {
      return;
    }

    const url = URL.createObjectURL(
      new Blob([JSON.stringify(receipt, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");

    link.href = url;
    link.download = `noir-poker-proof-${receipt.nullifier.slice(0, 12)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const verified = draw === "verified" && completion === "verified";
  const fields: [string, string][] = receipt
    ? [
        ["hand tag", receipt.hand_tag],
        ["seat", String(receipt.seat)],
        ["commitment", receipt.commitment],
        ["server nonce", receipt.nonce],
        ["catalog root", receipt.catalog_root],
        ["facts commitment", receipt.facts_hash],
        ["nullifier", receipt.nullifier],
        ["proof points", String(receipt.points)],
        ["circuit", receipt.circuit_id],
        ["proof system", receipt.proof_system],
        ["artifact sha256", receipt.artifact_sha256],
        ["vk sha256", receipt.vk_sha256],
      ]
    : [];

  return (
    <main className="proof-page">
      <header className="proof-header">
        <p className="eyebrow">Noir Poker / Proof receipt</p>
        <h1>Independent verification</h1>
        <p>
          {verified
            ? "both proofs verified locally in this browser"
            : "the browser verifies the receipt without trusting the server result"}
        </p>
      </header>

      <section className="proof-verification" aria-live="polite">
        <div>
          <span>Fair draw</span>
          <strong data-state={draw}>{statusLabel(draw)}</strong>
        </div>
        <div>
          <span>Challenge completion</span>
          <strong data-state={completion}>{statusLabel(completion)}</strong>
        </div>
      </section>

      {error && <p className="proof-error">{error}</p>}

      {receipt && (
        <>
          <section className="proof-privacy" aria-label="Private values">
            <div>
              <span>challenge</span>
              <strong>hidden</strong>
            </div>
            <div>
              <span>private hand facts</span>
              <strong>hidden</strong>
            </div>
          </section>

          <dl className="proof-fields">
            {fields.map(([name, value]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>
                  <code>{value}</code>
                </dd>
              </div>
            ))}
          </dl>

          <section className="proof-toolchain" aria-label="Proof toolchain">
            <span>UltraHonk</span>
            <span>Noir 1.0.0-beta.26</span>
            <span>Barretenberg {receipt.bb_version}</span>
            <span>protocol v{receipt.protocol_version}</span>
          </section>
        </>
      )}

      <div className="proof-actions">
        <button type="button" onClick={download} disabled={!receipt}>
          Download receipt
        </button>
        <a
          href="https://github.com/ishanrk/noir-poker/blob/main/apps/web/scripts/verify-receipt.mjs"
          target="_blank"
          rel="noreferrer"
        >
          verifier source
        </a>
        <Link href="/">back to lobby</Link>
      </div>

      <section className="proof-cli">
        <span>CLI verification</span>
        <code>npm --prefix apps/web run proof:verify -- /path/to/receipt.json</code>
      </section>
    </main>
  );
}
