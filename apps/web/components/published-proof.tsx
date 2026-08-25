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
        npm run proof:verify -- {fileName}
      </code>
      <div className="proof-guide-links">
        <Link href={LOCAL_VERIFIER} target="_blank" rel="noreferrer">Verifier Source</Link>
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
          <p>Explanation of the Protocol</p>
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
  if (draw) {
    return [
      {
        title: "The browser creates a private random value",
        text: "The browser creates 32 random bytes when the challenge draw begins. Those bytes become the private value used for this draw. The value stays in the player browser and never reaches the server.",
        source: <Source href={RANDOM_SOURCE}>Browser randomness</Source>,
      },
      {
        title: "The browser locks the value in a commitment",
        text: "BLAKE2s is a hash function that turns data into a fixed fingerprint. The browser hashes the private value with the room hand and player. The resulting fingerprint is called a commitment. It locks the private value without revealing it. Changing any input creates a different commitment. The server stores the commitment before continuing.",
        detail: (
          <dl>
            <Value label="Commitment fingerprint" value={proof.commitment} />
          </dl>
        ),
        source: <Source href={BLAKE2_SPEC}>BLAKE2 specification</Source>,
      },
      {
        title: "The server creates a nonce",
        text: "After storing the commitment the server creates another random 32 byte value. This value is called a nonce because it is used once. The browser locked its private value before seeing the nonce. The server never receives the private value.",
        detail: (
          <dl>
            <Value label="Server nonce" value={proof.nonce} />
          </dl>
        ),
        source: <Source href={RANDOM_SOURCE}>Secure random values</Source>,
      },
      {
        title: "The private value and nonce select the challenge",
        text: "The browser hashes its private value with the server nonce and the fingerprint for this hand and player. The first three bits produce a number from 0 through 7. That number selects one of eight fixed challenges. The same inputs always select the same challenge. Neither side knew both random values before the commitment was stored.",
        source: <Source href={BLAKE2_SPEC}>BLAKE2 specification</Source>,
      },
      {
        title: "Noir proves the challenge came from the list",
        text: "Noir Poker has eight fixed challenge rules. The catalog root is one public fingerprint representing that complete list. The browser gives Noir the selected rule and three supporting fingerprints. Those fingerprints are called a Merkle path. Noir uses them to rebuild the public catalog root. A rule outside the fixed list cannot rebuild the same root.",
        detail: (
          <dl>
            <Value label="Catalog root" value={proof.catalog_root} />
          </dl>
        ),
        source: <Source href={MERKLE_SOURCE}>Merkle authentication source</Source>,
      },
      {
        title: "Noir proves the draw followed every rule",
        text: "A Noir circuit is a program that checks rules without publishing the private inputs. This circuit rebuilds the commitment from the private value. It repeats the challenge selection using the private value and nonce. It checks that the selected challenge belongs to the fixed list. Barretenberg is the software that creates and verifies UltraHonk proofs. An UltraHonk proof lets anyone confirm that every circuit check passed without receiving the private inputs.",
        detail: (
          <dl>
            <Value label="Proof bytes" value={`${proofBytes ?? 0} bytes in the accepted proof`} />
            <Value label="Public input bytes" value={`${publicBytes ?? 0} bytes containing the visible values covered by the proof`} />
          </dl>
        ),
        source: (
          <>
            <Source href={CIRCUIT_SOURCE}>Challenge circuit source</Source>
          </>
        ),
      },
      {
        title: "The server verifies the draw proof",
        text: "The browser sends the proof and its public values to the server. Public values are the visible values covered by the proof. The server checks the hand and player. It checks the commitment and nonce. It checks the catalog root. It then runs the UltraHonk verifier. A mismatch or invalid proof is rejected. An accepted proof becomes public.",
        source: <Source href={SERVER_VERIFIER}>Rust server verifier</Source>,
      },
      {
        title: "This browser verifies the published proof",
        text: "This page downloads the exact proof and public values accepted by the server. It repeats every public comparison and runs the UltraHonk verifier in this browser. The circuit artifact fingerprint identifies the compiled Noir program. The verification key fingerprint identifies the key used to verify proofs from that program.",
        detail: (
          <dl>
            <Value label="Circuit artifact fingerprint" value={proof.artifact_sha256} />
            <Value label="Verification key fingerprint" value={proof.vk_sha256} />
          </dl>
        ),
        source: <Source href={BROWSER_VERIFIER}>Browser verification source</Source>,
      },
      {
        title: "The downloaded file verifies on another computer",
        text: "Download the JSON file with the action above. The file contains the accepted proof public values and circuit fingerprints. Run the command below from the web application folder. The script repeats the public comparisons and UltraHonk verification without trusting this page. Changing one proof byte or public value makes the command fail.",
        detail: verificationActions,
        source: <Source href={LOCAL_VERIFIER}>Local verifier source</Source>,
      },
    ];
  }

  return [
    {
      title: "The game records six facts after the hand",
      text: "The game records six true or false facts for this player after the hand. They cover reaching the flop. They cover raising before the flop. They cover calling before the flop. They cover checking on the flop. They cover reaching showdown. They cover finishing with a net profit.",
      source: <Source href={CIRCUIT_SOURCE}>Challenge circuit source</Source>,
    },
    {
      title: "The browser locks the facts in a fingerprint",
      text: "The player browser receives the six facts and creates a private random value called a salt. A salt prevents another person from guessing the facts by testing every possible list. BLAKE2s hashes the hand player salt and six facts into the facts fingerprint below. The server stores the fingerprint while the facts and salt stay private.",
      detail: (
        <dl>
          <Value label="Facts fingerprint" value={proof.facts_hash ?? ""} />
        </dl>
      ),
      source: <Source href={BLAKE2_SPEC}>BLAKE2 specification</Source>,
    },
    {
      title: "Noir recreates the assigned challenge",
      text: "The Noir circuit rebuilds the earlier commitment from the private value. It combines that value with the stored server nonce to select the challenge again. It proves that the selected challenge belongs to the fixed list. These draw checks run inside the completion proof even when no separate draw proof was published.",
      detail: (
        <dl>
          <Value label="Original commitment" value={proof.commitment} />
          <Value label="Original server nonce" value={proof.nonce} />
          <Value label="Catalog root" value={proof.catalog_root} />
        </dl>
      ),
      source: (
        <>
          <Source href={BLAKE2_SPEC}>BLAKE2 specification</Source>
          <Source href={MERKLE_SOURCE}>Merkle authentication source</Source>
        </>
      ),
    },
    {
      title: "Noir checks the challenge against the hand",
      text: "Each challenge lists facts that must be true and facts that must be false. The circuit compares the assigned challenge with all six facts from the hand. A challenge requiring showdown passes only when the showdown fact is true. Any unmet condition stops proof creation.",
      source: <Source href={CIRCUIT_SOURCE}>Completion constraints</Source>,
    },
    {
      title: "Noir creates a unique claim fingerprint",
      text: "The circuit hashes the hand fingerprint player seat and private value into one claim fingerprint. This fingerprint is called a nullifier. The same challenge completion always creates the same nullifier. The server stores accepted nullifiers and rejects a second claim with the same value.",
      detail: (
        <dl>
          <Value label="Nullifier" value={proof.nullifier ?? ""} />
        </dl>
      ),
      source: <Source href={BLAKE2_SPEC}>BLAKE2 specification</Source>,
    },
    {
      title: "The browser creates the completion proof",
      text: "A Noir circuit is a program that checks rules without publishing the private inputs. This circuit checks the original challenge draw hand facts and unique claim fingerprint together. Barretenberg is the software that creates and verifies UltraHonk proofs. An UltraHonk proof lets anyone confirm that every circuit check passed without receiving the private inputs. The proof does not expose the challenge facts private value Merkle path or salt.",
      detail: (
        <dl>
          <Value label="Proof bytes" value={`${proofBytes ?? 0} bytes in the accepted proof`} />
          <Value label="Public input bytes" value={`${publicBytes ?? 0} bytes containing the visible values covered by the proof`} />
        </dl>
      ),
      source: (
        <>
          <Source href={CIRCUIT_SOURCE}>Challenge circuit source</Source>
        </>
      ),
    },
    {
      title: "The server verifies the completion proof",
      text: "The browser sends the proof and its public values to the server. Public values are the visible values covered by the proof. The server checks the hand and player. It checks the commitment nonce and catalog root. It checks the facts fingerprint and nullifier. It runs the UltraHonk verifier. It also checks that the nullifier has not been used. A mismatch or invalid proof is rejected. An accepted proof becomes public.",
      source: <Source href={SERVER_VERIFIER}>Rust server verifier</Source>,
    },
    {
      title: "This browser verifies the published proof",
      text: "This page downloads the exact proof and public values accepted by the server. It repeats every public comparison and runs the UltraHonk verifier in this browser. The circuit artifact fingerprint identifies the compiled Noir program. The verification key fingerprint identifies the key used to verify proofs from that program.",
      detail: (
        <dl>
          <Value label="Circuit artifact fingerprint" value={proof.artifact_sha256} />
          <Value label="Verification key fingerprint" value={proof.vk_sha256} />
        </dl>
      ),
      source: <Source href={BROWSER_VERIFIER}>Browser verification source</Source>,
    },
    {
      title: "The downloaded file verifies on another computer",
      text: "Download the JSON file with the action above. The file contains the accepted proof public values and circuit fingerprints. Run the command below from the web application folder. The script repeats the public comparisons and UltraHonk verification without trusting this page. Changing one proof byte or public value makes the command fail.",
      detail: verificationActions,
      source: <Source href={LOCAL_VERIFIER}>Local verifier source</Source>,
    },
  ];
}

function Value({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function Source({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} target="_blank" rel="noreferrer">Source&nbsp; {children} ↗</Link>;
}

function encodedBytes(value: string) {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return value.length * 3 / 4 - padding;
}
