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
  const pageActions = receipt ? (
    <>
      <button className="proof-guide-download" type="button" onClick={exportReceipt}>Download JSON</button>
      <button type="button" onClick={() => void verify()}>Run Browser Check</button>
      <Link href={LOCAL_VERIFIER} target="_blank" rel="noreferrer">Local Verifier</Link>
      <button type="button" onClick={() => void copyLink()}>Copy Public Link</button>
    </>
  ) : null;
  const verificationActions = receipt ? (
    <>
      <code className="proof-guide-command">
        npm --prefix apps/web run proof:verify -- {fileName}
      </code>
      <div className="proof-guide-links">
        <Link href={CIRCUIT_SOURCE} target="_blank" rel="noreferrer">Circuit Source</Link>
        <Link href={BROWSER_VERIFIER} target="_blank" rel="noreferrer">Browser Verifier</Link>
        <Link href={SERVER_VERIFIER} target="_blank" rel="noreferrer">Server Verifier</Link>
        <Link href={LOCAL_VERIFIER} target="_blank" rel="noreferrer">Local Verifier</Link>
      </div>
    </>
  ) : null;

  return (
    <main className="site-shell proof-page proof-guide-page">
      <SiteHeader compact />
      <header className="receipt-hero">
        <div>
          <p className="eyebrow">Public challenge verifier</p>
          <h1>{verified ? "Challenge completion verified." : receipt ? "Accepted completion record." : "Loading completion record."}</h1>
          <p>
            This browser checks the accepted UltraHonk proof automatically. The receipt contains
            the listed public values. The private challenge and fact vector stay in the player browser.
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
          actions={pageActions}
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
const CIRCUIT_SOURCE = `${REPO}/circuits/challenge-v2/src/main.nr`;
const BROWSER_VERIFIER = `${REPO}/apps/web/lib/receipt.ts`;
const SERVER_VERIFIER = `${REPO}/apps/server/src/proof.rs`;
const LOCAL_VERIFIER = `${REPO}/apps/web/scripts/verify-receipt.mjs`;
const DECK_VERIFIER = `${REPO}/apps/web/lib/deck-audit.ts`;
const BLAKE2_SPEC = "https://www.rfc-editor.org/rfc/rfc7693";
const MERKLE_SOURCE = "https://doi.org/10.1007/3-540-48184-2_32";
const RANDOM_SOURCE = "https://developer.mozilla.org/en-US/docs/Web/API/Crypto/getRandomValues";
const NOIR_SOURCE = "https://noir-lang.org/docs/getting_started_manually";
const BARRETENBERG_SOURCE =
  "https://github.com/AztecProtocol/aztec-packages/tree/next/barretenberg";

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
      title: "The protocol starts in the player browser",
      text: "The player browser samples a private 32 byte secret. It sends a BLAKE2s commitment to the server. The server stores that commitment then returns a fresh public nonce. The browser keeps the secret for this hand.",
      detail: (
        <dl>
          <ReceiptValue label="Protocol version" value={String(receipt.protocol_version)} />
          <ReceiptValue label="Player role" value="Create secret and proof" />
          <ReceiptValue label="Server role" value="Store commitment and return nonce" />
          <ReceiptValue label="Public role" value="Verify the accepted receipt" />
        </dl>
      ),
      result: "The server stores the commitment before it returns the nonce",
      source: (
        <>
          <Source href={RANDOM_SOURCE}>Web Crypto randomness</Source>
          <Source href={BLAKE2_SPEC}>BLAKE2 specification</Source>
        </>
      ),
    },
    {
      title: "The receipt contains accepted public records",
      text: drawIncluded
        ? "This receipt contains the accepted Mode 0 draw proof and Mode 1 completion proof. It exposes the room hand seat commitment nonce facts hash nullifier catalog root proof bytes and public input bytes. The private secret challenge rule Merkle path fact salt and fact bits stay in the player browser."
        : "This receipt contains one accepted Mode 1 completion proof. Its public fields repeat every assignment binding. It exposes the room hand seat commitment nonce facts hash nullifier catalog root proof bytes and public input bytes. The private witness stays in the player browser.",
      detail: (
        <dl>
          <ReceiptValue label="Draw record" value={drawIncluded ? "Mode 0 included" : "Historical completion receipt"} />
          <ReceiptValue label="Completion record" value="Mode 1 included" />
          <ReceiptValue label="Circuit" value={receipt.circuit_id} />
          <ReceiptValue label="Proof system" value={receipt.proof_system} />
        </dl>
      ),
      result: "The JSON contains the server accepted public receipt",
      source: <Source href={SERVER_VERIFIER}>Receipt server source</Source>,
    },
    {
      title: "Each proof has 194 ordered public fields",
      text: "Each public byte value occupies one canonical 32 byte Noir field. The order is mode then 32 hand tag bytes then seat then five 32 byte groups for commitment nonce facts hash nullifier and catalog root. Each included proof has exactly 194 fields.",
      detail: (
        <dl>
          <ReceiptValue label="Room" value={receipt.room} />
          <ReceiptValue label="Hand number" value={`${receipt.hand_no} in data and ${receipt.hand_no + 1} on screen`} />
          <ReceiptValue label="Hand tag" value={receipt.hand_tag} />
          <ReceiptValue label="Seat" value={`${receipt.seat} in data and Player ${receipt.seat + 1} on screen`} />
          <ReceiptValue label="Mode fields" value="1" />
          <ReceiptValue label="Hand tag fields" value="32" />
          <ReceiptValue label="Seat fields" value="1" />
          <ReceiptValue label="Five byte groups" value="160" />
        </dl>
      ),
      result: "1 + 32 + 1 + 160 = 194 public fields",
      source: <Source href={CIRCUIT_SOURCE}>Challenge circuit source</Source>,
    },
    {
      title: "Mode 0 proves the challenge draw",
      text: "The circuit recomputes the commitment from the private secret. It hashes the secret with the server nonce. The low three selector bits choose one of eight catalog leaves. Three private sibling hashes rebuild the fixed catalog root. Mode 1 independently repeats these checks inside every completion proof.",
      detail: (
        <dl>
          <ReceiptValue label="Secret commitment" value={receipt.commitment} />
          <ReceiptValue label="Server nonce" value={receipt.nonce} />
          <ReceiptValue label="Catalog root" value={receipt.catalog_root} />
          <ReceiptValue label="Draw record" value={drawIncluded ? "Mode 0 included" : "Assignment checks repeated in Mode 1"} />
        </dl>
      ),
      result: "The selector binds one catalog challenge to this hand and player",
      source: (
        <>
          <Source href={BLAKE2_SPEC}>BLAKE2 specification</Source>
          <Source href={MERKLE_SOURCE}>Merkle authentication source</Source>
        </>
      ),
    },
    {
      title: "Mode 1 proves challenge completion",
      text: "At settlement the game records six fact bits for this player. The player browser receives those bits and their private salt. Mode 1 binds them to the public facts hash. The selected private catalog rule checks the bits. The circuit derives the public nullifier from the hand tag seat and secret. Mode 1 verification uses its own proof bytes and 194 public fields.",
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
      result: "The completion proof binds the private rule to the committed hand facts",
      source: <Source href={CIRCUIT_SOURCE}>Mode 1 circuit constraints</Source>,
    },
    {
      title: "Noir and UltraHonk bind the proofs",
      text: "Noir compiles both modes into circuit constraints. The player browser builds each private witness. Barretenberg creates an UltraHonk proof for the matching 194 public fields. The pinned artifact and verification key digests identify the circuit build used by the public verifiers.",
      detail: (
        <dl>
          <ReceiptValue label="Proof system" value={receipt.proof_system} />
          <ReceiptValue label="Circuit" value={receipt.circuit_id} />
          <ReceiptValue label="Barretenberg" value={receipt.bb_version} />
          <ReceiptValue label="Artifact SHA 256" value={receipt.artifact_sha256} />
          <ReceiptValue label="Verification key SHA 256" value={receipt.vk_sha256} />
        </dl>
      ),
      result: "Each proof binds one private witness to one exact public statement",
      source: (
        <>
          <Source href={NOIR_SOURCE}>Noir proving guide</Source>
          <Source href={BARRETENBERG_SOURCE}>Barretenberg source</Source>
        </>
      ),
    },
    {
      title: "The server verifies before storing the receipt",
      text: "The server derives the expected hand tag from the room and zero based hand number. It matches the seat commitment nonce catalog root facts hash and nullifier. It decodes exactly 194 canonical fields for each proof then verifies UltraHonk with the pinned verification key. The stored receipt follows those checks.",
      detail: (
        <dl>
          <ReceiptValue label="Artifact SHA 256" value={receipt.artifact_sha256} />
          <ReceiptValue label="Verification key SHA 256" value={receipt.vk_sha256} />
          <ReceiptValue label="Facts hash" value={receipt.facts_hash} />
          <ReceiptValue label="Nullifier" value={receipt.nullifier} />
        </dl>
      ),
      result: "The completion circuit covers the challenge claim and the deck transcript covers the deal",
      source: (
        <>
          <Source href={SERVER_VERIFIER}>Rust server verifier</Source>
          <Source href={DECK_VERIFIER}>Encrypted deck verifier</Source>
        </>
      ),
    },
    {
      title: "Verify the receipt in this browser or a terminal",
      text: drawIncluded
        ? "This page validates the receipt metadata and every public binding. It runs the included Mode 0 proof first then the Mode 1 proof. Download the JSON with the action above. The local command checks the circuit artifact SHA 256 decodes all 194 fields for each proof and runs UltraHonk. Success prints the room hand and proof count."
        : "This page validates the receipt metadata and every public binding. It runs the included Mode 1 proof. Download the JSON with the action above. The local command checks the circuit artifact SHA 256 decodes all 194 fields and runs UltraHonk. Success prints the room hand and proof count.",
      detail: verificationActions,
      result: "A changed receipt byte makes browser or terminal verification return an error",
      source: (
        <>
          <Source href={BROWSER_VERIFIER}>Browser verification source</Source>
          <Source href={LOCAL_VERIFIER}>Local verifier source</Source>
        </>
      ),
    },
  ];
}

function ReceiptValue({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function Source({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} target="_blank" rel="noreferrer">Source&nbsp; {children} ↗</Link>;
}
