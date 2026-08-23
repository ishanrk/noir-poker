"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import styles from "@/components/crypto.module.css";
import { ProofGuide, type ProofGuideStep } from "@/components/proof-guide";
import { SiteHeader } from "@/components/site-header";
import { verifyPublishedProof } from "@/lib/receipt";
import { loadPublishedProof, type ProofKind, type PublishedProof } from "@/lib/server";

type VerifyState = "loading" | "ready" | "verifying" | "verified" | "failed";

const REPO = "https://github.com/ishanrk/noir-poker/blob/main";
const CIRCUIT_SOURCE = `${REPO}/circuits/challenge-v2/src/main.nr`;
const BROWSER_VERIFIER = `${REPO}/apps/web/lib/receipt.ts`;
const SERVER_VERIFIER = `${REPO}/apps/server/src/proof.rs`;
const LOCAL_VERIFIER = `${REPO}/apps/web/scripts/verify-receipt.mjs`;
const BLAKE2_SPEC = "https://www.rfc-editor.org/rfc/rfc7693";
const MERKLE_SOURCE = "https://doi.org/10.1007/3-540-48184-2_32";
const RANDOM_SOURCE = "https://developer.mozilla.org/en-US/docs/Web/API/Crypto/getRandomValues";
const NOIR_SOURCE = "https://noir-lang.org/docs/getting_started_manually";
const BARRETENBERG_SOURCE =
  "https://github.com/AztecProtocol/aztec-packages/tree/next/barretenberg";

export function PublishedProofPage({ room, hand, seat, kind }: {
  room: string;
  hand: number;
  seat: number;
  kind: ProofKind;
}) {
  const [proof, setProof] = useState<PublishedProof>();
  const proofRef = useRef<PublishedProof | undefined>(undefined);
  const routeRef = useRef("");
  const [state, setState] = useState<VerifyState>("loading");
  const [error, setError] = useState<string>();
  const route = `${room}:${hand}:${seat}:${kind}`;

  const verify = useCallback(async () => {
    if (!proofRef.current) return;
    const current = route;
    setState("verifying");
    setError(undefined);
    try {
      await verifyPublishedProof(proofRef.current);
      if (routeRef.current !== current) return;
      setState("verified");
    } catch (cause) {
      if (routeRef.current !== current) return;
      setState("failed");
      setError(cause instanceof Error ? cause.message : "proof verification failed");
    }
  }, [route]);

  useEffect(() => {
    let live = true;
    routeRef.current = route;
    proofRef.current = undefined;
    queueMicrotask(() => {
      if (!live) return;
      setProof(undefined);
      setError(undefined);
      setState("loading");
    });
    void loadPublishedProof(room, hand, seat, kind)
      .then((value) => {
        if (!live || routeRef.current !== route) return;
        proofRef.current = value;
        setProof(value);
        setState("verifying");
        void verify();
      })
      .catch((cause) => {
        if (!live || routeRef.current !== route) return;
        setState("failed");
        setError(cause instanceof Error ? cause.message : "proof unavailable");
      });
    return () => { live = false; };
  }, [hand, kind, room, route, seat, verify]);

  function download() {
    if (!proof) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(proof, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `noir-poker-${kind}-${proof.hand_no}-${proof.seat}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  const draw = kind === "draw";
  const proofBytes = proof ? encodedBytes(proof.proof) : undefined;
  const publicBytes = proof ? encodedBytes(proof.public_inputs) : undefined;
  const fileName = proof
    ? `noir-poker-${kind}-${proof.hand_no}-${proof.seat}.json`
    : "proof.json";
  const pageActions = proof ? (
    <>
      <button className="proof-guide-download" type="button" onClick={download}>Download JSON</button>
      <button type="button" onClick={() => void verify()}>Run Browser Check</button>
      <Link href={`/room/${proof.room}/proofs`} target="_blank" rel="noreferrer">Proof History</Link>
    </>
  ) : null;
  const verificationActions = proof ? (
    <>
      <code className="proof-guide-command">
        npm --prefix apps/web run proof:verify -- {fileName}
      </code>
      <div className="proof-guide-links">
        <Link href={CIRCUIT_SOURCE} target="_blank" rel="noreferrer">Circuit Source</Link>
        <Link href={BROWSER_VERIFIER} target="_blank" rel="noreferrer">Browser Verifier</Link>
        <Link href={SERVER_VERIFIER} target="_blank" rel="noreferrer">Server Verifier</Link>
        <Link href={LOCAL_VERIFIER} target="_blank" rel="noreferrer">Local Verifier</Link>
        <Link href="/protocol#challenge-proofs" target="_blank" rel="noreferrer">Protocol Sources</Link>
      </div>
    </>
  ) : null;
  const steps = proof
    ? proofSteps({ proof, draw, proofBytes, publicBytes, verificationActions })
    : [];

  return (
    <main className="site-shell proof-page proof-guide-page">
      <SiteHeader compact />
      <div className={styles.page}>
        <header className={styles.hero}>
          <p className={styles.label}>HAND {hand + 1}&nbsp;&nbsp;&nbsp;PLAYER {seat + 1}</p>
          <h1>{draw ? "DRAW PROOF" : "COMPLETION PROOF"}</h1>
          <p>
            Inspect the accepted proof bytes and run the public verifier in order
          </p>
        </header>
        <div className={styles.verifyState} data-state={state} aria-live="polite">
          {state === "loading"
            ? "LOADING PROOF"
            : state === "ready"
              ? "READY TO VERIFY"
              : state === "verifying"
                ? "VERIFYING LOCALLY"
                : state === "verified"
                  ? "VERIFIED LOCALLY"
                  : "VERIFICATION FAILED"}
        </div>
        {error && <p className={styles.error}>{error}</p>}

        {proof && (
          <ProofGuide
            key={`${route}:${proof.nullifier ?? "draw"}`}
            label={draw ? "Fair challenge draw" : "Challenge completion"}
            title="Read and verify this proof"
            intro="Move through each public check in order"
            actions={pageActions}
            steps={steps}
          />
        )}
      </div>
    </main>
  );
}

function proofSteps({
  proof,
  draw,
  proofBytes,
  publicBytes,
  verificationActions,
}: {
  proof: PublishedProof;
  draw: boolean;
  proofBytes: number | undefined;
  publicBytes: number | undefined;
  verificationActions: ReactNode;
}): ProofGuideStep[] {
  return [
    {
      title: "The protocol starts in the player browser",
      text: "The player browser samples a private 32 byte secret. It sends a BLAKE2s commitment to the server. The server stores that commitment then returns a fresh public nonce. The browser keeps the secret for this hand.",
      detail: (
        <dl>
          <Value label="Protocol version" value={String(proof.protocol_version)} />
          <Value label="Player role" value="Create secret and proof" />
          <Value label="Server role" value="Store commitment and return nonce" />
          <Value label="Public role" value="Verify the accepted record" />
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
      title: "The server publishes the accepted values",
      text: draw
        ? "The draw record exposes the room hand seat mode commitment nonce catalog root proof bytes and public input bytes. Mode 0 places zero values in its facts hash and nullifier fields. The private secret selected rule Merkle path and fact values stay in the player browser."
        : "The completion record exposes the room hand seat mode commitment nonce catalog root facts hash nullifier proof bytes and public input bytes. The private secret selected rule Merkle path fact salt and fact bits stay in the player browser.",
      detail: (
        <dl>
          <Value label="Room" value={proof.room} />
          <Value label="Hand" value={`${proof.hand_no} in data and ${proof.hand_no + 1} on screen`} />
          <Value label="Seat" value={`${proof.seat} in data and Player ${proof.seat + 1} on screen`} />
          <Value label="Mode" value={draw ? "0 for challenge draw" : "1 for completion"} />
          <Value label="Proof bytes" value={String(proofBytes ?? 0)} />
          <Value label="Public input bytes" value={String(publicBytes ?? 0)} />
        </dl>
      ),
      result: "The JSON contains the server accepted public record",
      source: <Source href={SERVER_VERIFIER}>Published proof server source</Source>,
    },
    {
      title: "The 194 public fields have one fixed order",
      text: "Each public byte value occupies one canonical 32 byte Noir field. The order is mode then 32 hand tag bytes then seat then five 32 byte groups for commitment nonce facts hash nullifier and catalog root. The total is 194 fields.",
      detail: (
        <dl>
          <Value label="Mode fields" value="1" />
          <Value label="Hand tag fields" value="32" />
          <Value label="Seat fields" value="1" />
          <Value label="Five byte groups" value="160" />
          <Value label="Hand tag" value={proof.hand_tag} />
        </dl>
      ),
      result: "1 + 32 + 1 + 160 = 194 public fields",
      source: <Source href={CIRCUIT_SOURCE}>Challenge circuit source</Source>,
    },
    {
      title: draw ? "Mode 0 proves the challenge draw" : "Mode 1 proves challenge completion",
      text: draw
        ? "The circuit recomputes the commitment from the private secret. It hashes the secret with the server nonce. The low three selector bits choose one of eight catalog leaves. Three private sibling hashes rebuild the fixed catalog root."
        : "Mode 1 repeats the commitment selector and catalog root checks. It binds six private fact bits to the public facts hash. The selected private catalog rule checks those bits. The circuit derives the public nullifier from the hand tag seat and secret.",
      detail: (
        <dl>
          <Value label="Commitment" value={proof.commitment} />
          <Value label="Server nonce" value={proof.nonce} />
          <Value label="Catalog root" value={proof.catalog_root} />
          {!draw && <Value label="Facts hash" value={proof.facts_hash ?? ""} />}
          {!draw && <Value label="Nullifier" value={proof.nullifier ?? ""} />}
        </dl>
      ),
      result: draw
        ? "Mode 0 binds one catalog selection to this hand and player"
        : "Mode 1 binds one completed private rule to the public facts hash",
      source: (
        <>
          <Source href={BLAKE2_SPEC}>BLAKE2 specification</Source>
          <Source href={MERKLE_SOURCE}>Merkle authentication source</Source>
        </>
      ),
    },
    {
      title: "Noir and UltraHonk create the proof",
      text: "Noir compiles the protocol rules into circuit constraints. The player browser builds a private witness with the secret selected rule Merkle path and completion facts when present. Barretenberg creates an UltraHonk proof that binds this witness to the 194 public fields.",
      detail: (
        <dl>
          <Value label="Proof system" value={proof.proof_system} />
          <Value label="Circuit" value={proof.circuit_id} />
          <Value label="Barretenberg" value={proof.bb_version} />
          <Value label="Proof bytes" value={String(proofBytes ?? 0)} />
        </dl>
      ),
      result: "The proof binds one private witness to this exact public statement",
      source: (
        <>
          <Source href={NOIR_SOURCE}>Noir proving guide</Source>
          <Source href={BARRETENBERG_SOURCE}>Barretenberg source</Source>
        </>
      ),
    },
    {
      title: "The server verifies before publication",
      text: "The server decodes exactly 194 canonical fields. It derives the expected hand tag from the room and zero based hand number. It matches mode seat commitment nonce catalog root and completion hashes when present. It verifies UltraHonk with the pinned verification key before storing and publishing the record.",
      detail: (
        <dl>
          <Value label="Artifact SHA 256" value={proof.artifact_sha256} />
          <Value label="Verification key SHA 256" value={proof.vk_sha256} />
          <Value label="Barretenberg" value={proof.bb_version} />
        </dl>
      ),
      result: "Publication follows successful public binding and UltraHonk checks",
      source: <Source href={SERVER_VERIFIER}>Rust server verifier</Source>,
    },
    {
      title: "This browser verifies the accepted record",
      text: "The page derives the same hand tag and matches every public binding. It requires the artifact SHA 256 and verification key SHA 256 metadata to equal pinned values. It then runs UltraHonk against the bundled circuit artifact. The status above reports this browser result.",
      detail: (
        <dl>
          <Value label="Hand tag" value={proof.hand_tag} />
          <Value label="Artifact SHA 256" value={proof.artifact_sha256} />
          <Value label="Verification key SHA 256" value={proof.vk_sha256} />
        </dl>
      ),
      result: "The browser result comes from local validation and UltraHonk execution",
      source: <Source href={BROWSER_VERIFIER}>Browser verification source</Source>,
    },
    {
      title: "Run the same verification from a terminal",
      text: "Download the JSON with the action above. From the repository root install the web dependencies then run the command below with the downloaded file path. The script checks metadata derives the hand tag decodes all 194 fields checks the circuit artifact SHA 256 and runs UltraHonk. Success prints a verified line with the room hand and proof count.",
      detail: verificationActions,
      result: "A changed proof byte or public field makes the verifier exit with an error",
      source: <Source href={LOCAL_VERIFIER}>Local verifier source</Source>,
    },
  ];
}

function Value({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function Source({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} target="_blank" rel="noreferrer">{children}</Link>;
}

function encodedBytes(value: string) {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return value.length * 3 / 4 - padding;
}
