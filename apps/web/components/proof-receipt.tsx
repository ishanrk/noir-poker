"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { ProofGuide, type ProofGuideStep } from "@/components/proof-guide";
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
        <p>Fair challenge draw proof</p>
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
  const routeRef = useRef(nullifier);
  const runRef = useRef(0);
  const [draw, setDraw] = useState<State>("waiting");
  const [completion, setCompletion] = useState<State>("waiting");
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const verify = useCallback(async (loaded?: ProofReceipt) => {
    const route = nullifier;
    const run = ++runRef.current;
    setBusy(true);
    setError(undefined);
    setDraw("waiting");
    setCompletion("waiting");
    let step: ReceiptProof = "draw";

    try {
      const value = loaded ?? receiptRef.current ?? (await loadProofReceipt(nullifier));
      if (routeRef.current !== route || runRef.current !== run) return;
      receiptRef.current = value;
      setReceipt(value);
      const hasDraw = Boolean(value.draw_proof && value.draw_public_inputs);
      step = hasDraw ? "draw" : "completion";
      setDraw(hasDraw ? "verifying" : "skipped");
      if (!hasDraw) setCompletion("verifying");
      await verifyReceipt(value, (proof) => {
        if (routeRef.current !== route || runRef.current !== run) return;
        if (proof === "draw") {
          step = "completion";
          setDraw("verified");
          setCompletion("verifying");
        } else {
          setCompletion("verified");
        }
      });
    } catch (cause) {
      if (routeRef.current !== route || runRef.current !== run) return;
      if (step === "draw") setDraw("failed");
      else setCompletion("failed");
      setError(cause instanceof Error ? cause.message : "proof verification failed");
    } finally {
      if (routeRef.current === route && runRef.current === run) setBusy(false);
    }
  }, [nullifier]);

  useEffect(() => {
    let live = true;
    routeRef.current = nullifier;
    const request = ++runRef.current;
    receiptRef.current = undefined;
    queueMicrotask(() => {
      if (!live || routeRef.current !== nullifier || runRef.current !== request) return;
      setReceipt(undefined);
      setDraw("waiting");
      setCompletion("waiting");
      setError(undefined);
    });

    void loadProofReceipt(nullifier)
      .then((value) => {
        if (!live || routeRef.current !== nullifier || runRef.current !== request) return;
        receiptRef.current = value;
        setReceipt(value);
        setDraw(value.draw_proof && value.draw_public_inputs ? "waiting" : "skipped");
        void verify(value);
      })
      .catch((cause) => {
        if (!live || routeRef.current !== nullifier || runRef.current !== request) return;
        setDraw("failed");
        setError(cause instanceof Error ? cause.message : "proof receipt unavailable");
      });

    return () => {
      live = false;
      if (routeRef.current === nullifier) runRef.current += 1;
    };
  }, [nullifier, verify]);

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
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  const verified = (draw === "verified" || draw === "skipped") && completion === "verified";
  const fileName = receipt
    ? `noir-poker-challenge-${receipt.nullifier.slice(0, 12)}.json`
    : "receipt.json";
  const verificationActions = receipt ? (
    <>
      <code className="proof-guide-command">
        npm --prefix apps/web run proof:verify -- {fileName}
      </code>
      <div className="proof-guide-links">
        <button type="button" onClick={() => void verify()}>Run Browser Check</button>
        <button type="button" onClick={exportReceipt}>Download JSON</button>
        <button type="button" onClick={() => void copyLink()}>Copy Public Link</button>
        <Link href={`${REPO}/circuits/challenge-v2/src/main.nr`} target="_blank" rel="noreferrer">Circuit Source</Link>
        <Link href={`${REPO}/apps/web/lib/receipt.ts`} target="_blank" rel="noreferrer">Browser Verifier</Link>
        <Link href={`${REPO}/apps/server/src/proof.rs`} target="_blank" rel="noreferrer">Server Verifier</Link>
        <Link href={`${REPO}/apps/web/scripts/verify-receipt.mjs`} target="_blank" rel="noreferrer">Local Verifier</Link>
      </div>
    </>
  ) : null;

  return (
    <main className="site-shell proof-page">
      <SiteHeader compact />
      <header className="receipt-hero">
        <div>
          <p className="eyebrow">Public challenge verifier</p>
          <h1>{verified ? "The challenge was completed." : receipt ? "Proof ready to verify." : "Loading proof."}</h1>
          <p>
            This browser checks the accepted UltraHonk proof automatically. The challenge and
            private fact vector never appear in the receipt.
          </p>
        </div>
        <ReceiptSeal verified={verified} />
      </header>

      {error && <p className="proof-error">{error}</p>}

      {receipt && (
        <ProofGuide
          key={receipt.nullifier}
          label="Public completion receipt"
          title="Read and verify this receipt"
          intro="Move through each check in order"
          steps={receiptSteps({
            receipt,
            verificationActions,
          })}
        />
      )}
      {receipt && copied && <p className="proof-guide-feedback" role="status">Link copied</p>}
      {receipt && busy && <p className="proof-guide-feedback" role="status">Verification is running</p>}
    </main>
  );
}

const REPO = "https://github.com/ishanrk/noir-poker/blob/main";

function receiptSteps({
  receipt,
  verificationActions,
}: {
  receipt: ProofReceipt;
  verificationActions: ReactNode;
}): ProofGuideStep[] {
  const drawIncluded = Boolean(receipt.draw_proof && receipt.draw_public_inputs);

  return [
    {
      title: "The accepted public record",
      text: "The server stored this completion receipt only after it accepted the proof. The JSON contains the exact proof bytes and exact public input bytes. Local verification does not trust the status text on this page.",
      detail: (
        <dl>
          <ReceiptValue label="Protocol" value={String(receipt.protocol_version)} />
          <ReceiptValue label="Circuit" value={receipt.circuit_id} />
          <ReceiptValue label="Proof system" value={receipt.proof_system} />
          <ReceiptValue label="Draw proof" value={drawIncluded ? "Included" : "Not included in this receipt"} />
          <ReceiptValue label="Completion proof" value="Included" />
        </dl>
      ),
    },
    {
      title: "The 194 public fields",
      text: "Each included proof has exactly 194 public fields. Each public byte uses one canonical 32 byte Noir field. The order is mode then 32 hand tag bytes then seat then 32 bytes each for commitment nonce facts hash nullifier and catalog root.",
      detail: (
        <dl>
          <ReceiptValue label="Mode fields" value="1" />
          <ReceiptValue label="Hand tag fields" value="32" />
          <ReceiptValue label="Seat fields" value="1" />
          <ReceiptValue label="Five byte array groups" value="160" />
        </dl>
      ),
    },
    {
      title: "The hand and player",
      text: "The verifier derives the hand tag from the room id and zero based hand number. It requires the seat and fixed catalog root to match the public inputs inside every included proof.",
      detail: (
        <dl>
          <ReceiptValue label="Room" value={receipt.room} />
          <ReceiptValue label="Hand number" value={`${receipt.hand_no} in data and ${receipt.hand_no + 1} on screen`} />
          <ReceiptValue label="Hand tag" value={receipt.hand_tag} />
          <ReceiptValue label="Seat" value={`${receipt.seat} in data and Player ${receipt.seat + 1} on screen`} />
          <ReceiptValue label="Catalog root" value={receipt.catalog_root} />
        </dl>
      ),
    },
    {
      title: "The challenge draw",
      text: "The browser commits to a private 32 byte secret before the server returns its nonce. The circuit hashes the secret with the nonce and uses three selector bits to choose one of eight catalog leaves. A private Merkle path must reach the fixed public root. Neither side can select the result after seeing both secret inputs.",
      detail: (
        <dl>
          <ReceiptValue label="Secret commitment" value={receipt.commitment} />
          <ReceiptValue label="Server nonce" value={receipt.nonce} />
          <ReceiptValue label="Published draw check" value={drawIncluded ? "Mode 0 proof included" : "Historical receipt without Mode 0 proof"} />
        </dl>
      ),
    },
    {
      title: "The completion check",
      text: "Mode 1 repeats every assignment check. It binds six private fact bits to the public facts hash. It requires every condition in the hidden catalog rule to match those bits. The nullifier is derived from the hand player and secret so the same completion cannot count twice.",
      detail: (
        <dl>
          <ReceiptValue label="Fact 0" value="Saw the flop" />
          <ReceiptValue label="Fact 1" value="Raised before the flop" />
          <ReceiptValue label="Fact 2" value="Called before the flop" />
          <ReceiptValue label="Fact 3" value="Checked on the flop" />
          <ReceiptValue label="Fact 4" value="Reached showdown" />
          <ReceiptValue label="Fact 5" value="Finished with a net profit" />
          <ReceiptValue label="Facts hash" value={receipt.facts_hash} />
          <ReceiptValue label="Nullifier" value={receipt.nullifier} />
        </dl>
      ),
    },
    {
      title: "The exact trust boundary",
      text: "The circuit proves that the private fact bits match the server facts commitment and satisfy the hidden rule. It does not replay the poker action log. The encrypted deck transcript separately checks deck construction card reveals and final openings.",
      detail: (
        <div className="proof-guide-links">
          <Link href={`/audit/${receipt.room}/${receipt.hand_no}`} target="_blank" rel="noreferrer">Open Deck Transcript</Link>
          <Link href="/protocol#challenge-proofs" target="_blank" rel="noreferrer">Read Protocol Boundary</Link>
        </div>
      ),
    },
    {
      title: "The UltraHonk result",
      text: "UltraHonk checks that a private witness satisfies the compiled Noir constraints for these public inputs. The private secret challenge rule Merkle path fact salt and six fact bits never enter the receipt. The server key file and portable circuit artifact are identified by the SHA 256 values below.",
      detail: (
        <dl>
          <ReceiptValue label="Artifact SHA 256" value={receipt.artifact_sha256} />
          <ReceiptValue label="Verification key SHA 256" value={receipt.vk_sha256} />
          <ReceiptValue label="Barretenberg" value={receipt.bb_version} />
        </dl>
      ),
    },
    {
      title: "Run an independent check",
      text: "This page runs browser verification automatically. Download the JSON to keep the accepted record. From the repository root install the web dependencies then run the command below. Success prints a verified line with the room hand and proof count. Any changed byte returns an error.",
      detail: verificationActions,
    },
  ];
}

function ReceiptValue({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}
