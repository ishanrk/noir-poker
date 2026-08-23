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
  const verificationActions = proof ? (
    <>
      <code className="proof-guide-command">
        npm --prefix apps/web run proof:verify -- {fileName}
      </code>
      <div className="proof-guide-links">
        <button type="button" onClick={() => void verify()}>Run Browser Check</button>
        <button type="button" onClick={download}>Download JSON</button>
        <Link href={`/room/${proof.room}/proofs`} target="_blank" rel="noreferrer">Proof History</Link>
        <Link href={`${REPO}/circuits/challenge-v2/src/main.nr`} target="_blank" rel="noreferrer">Circuit Source</Link>
        <Link href={`${REPO}/apps/web/lib/receipt.ts`} target="_blank" rel="noreferrer">Browser Verifier</Link>
        <Link href={`${REPO}/apps/server/src/proof.rs`} target="_blank" rel="noreferrer">Server Verifier</Link>
        <Link href={`${REPO}/apps/web/scripts/verify-receipt.mjs`} target="_blank" rel="noreferrer">Local Verifier</Link>
        <Link href="/protocol#challenge-proofs" target="_blank" rel="noreferrer">Protocol Sources</Link>
      </div>
    </>
  ) : null;
  const steps = proof
    ? proofSteps({ proof, draw, proofBytes, publicBytes, verificationActions })
    : [];

  return (
    <main className="site-shell">
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
      title: "The accepted bytes",
      text: "This page fetched the exact proof bytes and public input bytes stored after server verification. Any change to either value makes verification fail.",
      detail: (
        <dl>
          <Value label="Proof bytes" value={String(proofBytes ?? 0)} />
          <Value label="Public input bytes" value={String(publicBytes ?? 0)} />
          <Value label="Public fields" value="194" />
        </dl>
      ),
    },
    {
      title: "The UltraHonk check",
      text: "UltraHonk checks a compact argument against the compiled Noir circuit. A valid result means one private witness satisfies every circuit constraint for these public values. The verifier never receives that witness.",
      detail: (
        <dl>
          <Value label="Proof system" value={proof.proof_system} />
          <Value label="Circuit" value={proof.circuit_id} />
          <Value label="Mode" value={draw ? "0 for challenge draw" : "1 for completion"} />
        </dl>
      ),
    },
    {
      title: "The hand and player",
      text: "The verifier derives the hand tag from the room id and zero based hand number. It then requires the seat and proof mode to match this public record.",
      detail: (
        <dl>
          <Value label="Room" value={proof.room} />
          <Value label="Hand number" value={`${proof.hand_no} in data and ${proof.hand_no + 1} on screen`} />
          <Value label="Hand tag" value={proof.hand_tag} />
          <Value label="Seat" value={`${proof.seat} in data and Player ${proof.seat + 1} on screen`} />
        </dl>
      ),
    },
    {
      title: draw ? "The fair challenge draw" : "The completion statement",
      text: draw
        ? "The commitment fixes a browser secret before the server nonce exists. The circuit derives a selector from that secret and nonce. Its low three bits choose one of eight leaves. A private Merkle path must end at the fixed catalog root."
        : "The circuit repeats the commitment selector and catalog checks. It also binds six private fact bits to the public facts hash. Every condition in the hidden challenge must match those bits. The one time nullifier prevents a second accepted claim for this secret.",
      detail: (
        <dl>
          <Value label="Commitment" value={proof.commitment} />
          <Value label="Server nonce" value={proof.nonce} />
          <Value label="Catalog root" value={proof.catalog_root} />
          {!draw && <Value label="Facts hash" value={proof.facts_hash ?? ""} />}
          {!draw && <Value label="Nullifier" value={proof.nullifier ?? ""} />}
        </dl>
      ),
    },
    {
      title: "The 194 public fields",
      text: "Each public byte is encoded as one canonical 32 byte Noir field. The order is mode then 32 hand tag bytes then seat then 32 bytes each for commitment nonce facts hash nullifier and catalog root. The hidden challenge secret rule path fact salt and fact bits are absent.",
      detail: (
        <dl>
          <Value label="Mode fields" value="1" />
          <Value label="Hand tag fields" value="32" />
          <Value label="Seat fields" value="1" />
          <Value label="Five byte array groups" value="160" />
        </dl>
      ),
    },
    {
      title: "The pinned verifier",
      text: "The server accepts proofs only with its pinned verification key. The portable verifier calculates the compiled artifact SHA 256 value before it runs UltraHonk. The metadata below identifies the exact circuit build and server key.",
      detail: (
        <dl>
          <Value label="Artifact SHA 256" value={proof.artifact_sha256} />
          <Value label="Verification key SHA 256" value={proof.vk_sha256} />
          <Value label="Barretenberg" value={proof.bb_version} />
        </dl>
      ),
    },
    {
      title: "Run an independent check",
      text: "The browser check runs automatically on this page. Download the JSON to keep the exact public record. From the repository root install the web dependencies then run the command below. A verified line names the room hand and proof count. Any changed proof byte or public field returns an error.",
      detail: verificationActions,
    },
  ];
}

function Value({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function encodedBytes(value: string) {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return value.length * 3 / 4 - padding;
}
