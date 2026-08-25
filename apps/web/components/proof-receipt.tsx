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
      <button type="button" onClick={() => void copyLink()}>Copy Public Link</button>
    </>
  ) : null;
  const verificationActions = receipt ? (
    <>
      <code className="proof-guide-command">
        npm run proof:verify -- {fileName}
      </code>
      <div className="proof-guide-links">
        <Link href={LOCAL_VERIFIER} target="_blank" rel="noreferrer">Verifier Source</Link>
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
            This browser checks the accepted UltraHonk proof automatically. The private challenge
            and six hand facts stay hidden.
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
const SERVER_VERIFIER = `${REPO}/apps/server/src/proof.rs`;
const LOCAL_VERIFIER = `${REPO}/apps/web/scripts/verify-receipt.mjs`;
const BLAKE2_SPEC = "https://www.rfc-editor.org/rfc/rfc7693";
const MERKLE_SOURCE = "https://doi.org/10.1007/3-540-48184-2_32";
const RANDOM_SOURCE = "https://developer.mozilla.org/en-US/docs/Web/API/Crypto/getRandomValues";

function receiptSteps({
  receipt,
  verificationActions,
}: {
  receipt: ProofReceipt;
  verificationActions: ReactNode;
}): ProofGuideStep[] {
  return [
    {
      title: "The browser created a private random value",
      text: "The browser created 32 random bytes when the challenge draw began. BLAKE2s is a hash function that turns data into a fixed fingerprint. The browser hashed the private value with the room hand and player. The resulting fingerprint is called a commitment. It locked the private value without revealing it. The server stored the commitment while the private value stayed in the browser.",
      detail: (
        <dl>
          <ReceiptValue label="Commitment fingerprint" value={receipt.commitment} />
        </dl>
      ),
      source: <Source href={BLAKE2_SPEC}>BLAKE2 specification</Source>,
    },
    {
      title: "The server created a nonce",
      text: "After storing the commitment the server created another random 32 byte value. This value is called a nonce because it is used once. The browser combined its private value with the nonce and the fingerprint for the hand and player. The first three bits selected one of eight fixed challenges. Neither side knew both random values before the commitment was stored.",
      detail: (
        <dl>
          <ReceiptValue label="Server nonce" value={receipt.nonce} />
        </dl>
      ),
      source: <Source href={RANDOM_SOURCE}>Secure random values</Source>,
    },
    {
      title: "Noir proved the challenge came from the list",
      text: "Noir Poker has eight fixed challenge rules. The catalog root below is one public fingerprint representing that complete list. The browser gave Noir the selected rule and three supporting fingerprints. Those fingerprints are called a Merkle path. Noir used them to rebuild the public catalog root. A rule outside the fixed list could not rebuild the same root.",
      detail: (
        <dl>
          <ReceiptValue label="Catalog root" value={receipt.catalog_root} />
        </dl>
      ),
      source: <Source href={MERKLE_SOURCE}>Merkle authentication source</Source>,
    },
    {
      title: "The game recorded six facts after the hand",
      text: "The game recorded six true or false facts for this player after the hand. They covered reaching the flop. They covered raising before the flop. They covered calling before the flop. They covered checking on the flop. They covered reaching showdown. They covered finishing with a net profit.",
      source: <Source href={CIRCUIT_SOURCE}>Challenge circuit source</Source>,
    },
    {
      title: "The browser locked the facts in a fingerprint",
      text: "The player browser received the six facts and created a private random value called a salt. A salt prevents another person from guessing the facts by testing every possible list. BLAKE2s hashed the hand player salt and six facts into the facts fingerprint below. The server stored the fingerprint while the facts and salt stayed private.",
      detail: (
        <dl>
          <ReceiptValue label="Facts fingerprint" value={receipt.facts_hash} />
        </dl>
      ),
      source: <Source href={BLAKE2_SPEC}>BLAKE2 specification</Source>,
    },
    {
      title: "Noir checked the challenge against the hand",
      text: "A Noir circuit is a program that checks rules without publishing the private inputs. The circuit rebuilt the earlier commitment from the private value. It selected the challenge again using that value and the stored server nonce. It proved that the challenge belonged to the fixed list. It then checked every required condition against the six facts from the hand. These draw checks ran inside the completion proof even when no separate draw proof was published.",
      source: <Source href={CIRCUIT_SOURCE}>Completion constraints</Source>,
    },
    {
      title: "Noir created a unique claim fingerprint",
      text: "The circuit hashed the hand fingerprint player seat and private value into one claim fingerprint. This fingerprint is called a nullifier. The same challenge completion always creates the same nullifier. The server stores accepted nullifiers and rejects a second claim with the same value.",
      detail: (
        <dl>
          <ReceiptValue label="Nullifier" value={receipt.nullifier} />
        </dl>
      ),
      source: <Source href={BLAKE2_SPEC}>BLAKE2 specification</Source>,
    },
    {
      title: "The browser created the completion proof",
      text: "The Noir circuit checked the original challenge draw hand facts and unique claim fingerprint together. Barretenberg is the software that creates and verifies UltraHonk proofs. An UltraHonk proof lets anyone confirm that every circuit check passed without receiving the private inputs. The proof bytes contain the accepted proof. The public input bytes contain the visible values covered by the proof. The challenge facts private value Merkle path and salt do not appear in either byte sequence.",
      detail: (
        <dl>
          <ReceiptValue label="Proof type" value={receipt.proof_system} />
          <ReceiptValue label="Checking program" value={receipt.circuit_id} />
        </dl>
      ),
      source: <Source href={CIRCUIT_SOURCE}>Challenge circuit source</Source>,
    },
    {
      title: "The server verified the completion proof",
      text: "The server checked the hand and player. It checked the commitment nonce and catalog root. It checked the facts fingerprint and nullifier. It ran the UltraHonk verifier. It also rejected a nullifier that had already been used. The public receipt exists only after those checks pass. This browser downloads that accepted proof and runs the same verification locally.",
      detail: (
        <dl>
          <ReceiptValue label="Circuit artifact fingerprint" value={receipt.artifact_sha256} />
          <ReceiptValue label="Verification key fingerprint" value={receipt.vk_sha256} />
        </dl>
      ),
      source: <Source href={SERVER_VERIFIER}>Rust server verifier</Source>,
    },
    {
      title: "The downloaded file verifies on another computer",
      text: "Download the JSON file with the action above. The file contains the accepted proof public values and circuit fingerprints. Run the command below from the web application folder. The script repeats the public comparisons and UltraHonk verification without trusting this page. Changing one proof byte or public value makes the command fail.",
      detail: verificationActions,
      source: <Source href={LOCAL_VERIFIER}>Local verifier source</Source>,
    },
  ];
}

function ReceiptValue({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function Source({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} target="_blank" rel="noreferrer">Source&nbsp; {children} ↗</Link>;
}
