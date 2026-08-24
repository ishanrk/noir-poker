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
  const drawIncluded = Boolean(receipt.draw_proof && receipt.draw_public_inputs);

  return [
    {
      title: "The browser created a private secret before play",
      text: "The browser created 32 random bytes when the challenge was drawn. Those bytes formed the secret. BLAKE2s is a cryptographic hash function. It combined the secret with a fingerprint for this room hand and player. The public result is called a commitment. The commitment went to the server while the secret stayed in the browser.",
      detail: (
        <dl>
          <ReceiptValue label="Commitment fingerprint" value={receipt.commitment} />
          <ReceiptValue label="Private secret" value="Never published" />
        </dl>
      ),
      result: "The commitment fixed the secret before the server continued",
      source: <Source href={BLAKE2_SPEC}>BLAKE2 specification</Source>,
    },
    {
      title: "The server added a random value",
      text: "After storing the commitment the server created a fresh random 32 byte value called a nonce. A nonce is a random value used once. The browser combined its secret with this nonce and the fingerprint for the hand and player. The first three result bits selected one challenge from the eight fixed choices.",
      detail: (
        <dl>
          <ReceiptValue label="Server nonce" value={receipt.nonce} />
          <ReceiptValue label="Possible challenges" value="8" />
          <ReceiptValue label="Selected challenge" value="Private to the player" />
        </dl>
      ),
      result: "Neither the server nor player could choose the challenge alone",
      source: <Source href={RANDOM_SOURCE}>Secure random values</Source>,
    },
    {
      title: "Noir checked the fixed challenge list",
      text: "The eight challenge rules form one public catalog. The catalog root below is one fingerprint covering the complete list. The selected rule and three supporting hashes stayed private. Those supporting hashes form a Merkle path. The circuit used them to rebuild the catalog root and reject any invented rule.",
      detail: (
        <dl>
          <ReceiptValue label="Catalog root" value={receipt.catalog_root} />
          <ReceiptValue label="Catalog size" value="8 fixed challenge rules" />
          <ReceiptValue label="Private values" value="Selected rule and Merkle path" />
        </dl>
      ),
      result: "The player could not replace the assigned rule",
      source: <Source href={MERKLE_SOURCE}>Merkle authentication source</Source>,
    },
    {
      title: "The finished hand recorded six facts",
      text: "When the hand ended the game recorded six true or false facts for this player. They record reaching the flop raising before the flop calling before the flop checking on the flop reaching showdown and finishing with a net profit.",
      detail: (
        <dl>
          <ReceiptValue label="Fact 1" value="Reached the flop" />
          <ReceiptValue label="Fact 2" value="Raised before the flop" />
          <ReceiptValue label="Fact 3" value="Called before the flop" />
          <ReceiptValue label="Fact 4" value="Checked on the flop" />
          <ReceiptValue label="Fact 5" value="Reached showdown" />
          <ReceiptValue label="Fact 6" value="Finished with a net profit" />
        </dl>
      ),
      result: "The fact list contains every condition used by the catalog",
      source: <Source href={CIRCUIT_SOURCE}>Challenge circuit source</Source>,
    },
    {
      title: "The facts received a private random value",
      text: "The player browser received the six facts and a fresh random value called a salt. A salt is extra randomness mixed into a hash. BLAKE2s combined the hand player salt and six facts into the facts fingerprint below. The salt stayed private so another person cannot test every possible fact combination against the fingerprint.",
      detail: (
        <dl>
          <ReceiptValue label="Facts fingerprint" value={receipt.facts_hash} />
          <ReceiptValue label="Private values" value="Six facts and random salt" />
        </dl>
      ),
      result: "The public fingerprint locked the facts without revealing them",
      source: <Source href={BLAKE2_SPEC}>BLAKE2 specification</Source>,
    },
    {
      title: "Noir compared the assigned challenge with the hand facts",
      text: "The completion circuit first recreated the original commitment from the private secret. It recreated the challenge choice from the secret and stored server nonce. It checked that the challenge belonged to the fixed catalog. It then checked every required true or false condition against the six hand facts. These checks run inside the completion proof even when a separate draw proof is absent.",
      detail: (
        <dl>
          <ReceiptValue label="Earlier draw proof" value={drawIncluded ? "Included and checked separately" : "Not required by the completion proof"} />
          <ReceiptValue label="Private values" value="Secret challenge path facts and salt" />
        </dl>
      ),
      result: "A valid proof means the assigned challenge conditions passed",
      source: <Source href={CIRCUIT_SOURCE}>Completion constraints</Source>,
    },
    {
      title: "The completion can only be counted once",
      text: "The circuit hashed the hand fingerprint player seat and private secret into the nullifier below. A nullifier is a unique public fingerprint for one challenge claim. The server accepts it once. Reusing the same completion proof produces the same nullifier and is rejected.",
      detail: (
        <dl>
          <ReceiptValue label="Nullifier" value={receipt.nullifier} />
          <ReceiptValue label="Private input" value="Challenge secret" />
        </dl>
      ),
      result: "One completed challenge can be counted once",
      source: <Source href={BLAKE2_SPEC}>BLAKE2 specification</Source>,
    },
    {
      title: "The browser created the completion proof",
      text: "A Noir circuit is a program that checks public and private values while keeping the private values hidden. Barretenberg created an UltraHonk proof after every circuit check passed. The proof bytes form the cryptographic certificate. The public input bytes contain the public values tied to that certificate. The secret challenge facts path and salt do not appear in either byte sequence.",
      detail: (
        <dl>
          <ReceiptValue label="Proof type" value={receipt.proof_system} />
          <ReceiptValue label="Checking program" value={receipt.circuit_id} />
          <ReceiptValue label="Hidden inputs" value="Never published" />
        </dl>
      ),
      result: "The proof certifies the checks without exposing the private values",
      source: <Source href={CIRCUIT_SOURCE}>Challenge circuit source</Source>,
    },
    {
      title: "The server checked the proof before publication",
      text: "The server compared the hand player commitment nonce catalog root facts fingerprint and nullifier with its stored hand data. It ran the UltraHonk verifier and rejected reused nullifiers. The public receipt exists only after those checks pass. This browser downloads that exact accepted proof and runs the same cryptographic verification locally.",
      detail: (
        <dl>
          <ReceiptValue label="Circuit artifact fingerprint" value={receipt.artifact_sha256} />
          <ReceiptValue label="Verification key fingerprint" value={receipt.vk_sha256} />
          <ReceiptValue label="Separate draw proof" value={drawIncluded ? "Included and verified first" : "Not included"} />
        </dl>
      ),
      result: "The browser does not rely on the server verification result",
      source: <Source href={SERVER_VERIFIER}>Rust server verifier</Source>,
    },
    {
      title: "The downloaded receipt verifies in a terminal",
      text: "Download the JSON with the action above. The file contains the exact accepted proof public values and circuit fingerprints. Run the command below from the web application folder. The local script repeats the public checks and UltraHonk verification. Changing one proof byte or public value makes the command fail.",
      detail: verificationActions,
      result: "Browser and terminal checks use the same accepted proof",
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
