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
        title: "The browser creates one private secret",
        text: "The browser creates 32 random bytes when the challenge draw begins. Those bytes form the secret. The secret stays in this browser and never reaches the server.",
        result: "Only the player browser knows the secret",
        source: <Source href={RANDOM_SOURCE}>Browser randomness</Source>,
      },
      {
        title: "The browser sends a commitment",
        text: "The browser combines the secret with a fingerprint for this room hand and player. BLAKE2s is a cryptographic hash function. It turns those values into the public fingerprint below called a commitment. The same inputs always make the same commitment. Changing any input makes a different commitment. The server stores it before continuing.",
        detail: (
          <dl>
            <Value label="Commitment fingerprint" value={proof.commitment} />
            <Value label="Private secret" value="Kept in the player browser" />
          </dl>
        ),
        result: "The player cannot replace the secret after this point",
        source: <Source href={BLAKE2_SPEC}>BLAKE2 specification</Source>,
      },
      {
        title: "The server sends a random value",
        text: "After storing the commitment the server creates a fresh random 32 byte value called a nonce. A nonce is a random value used once. The browser had already locked its secret before receiving it. The server cannot predict the result without the secret.",
        detail: (
          <dl>
            <Value label="Server nonce" value={proof.nonce} />
            <Value label="Required order" value="Commitment stored before nonce created" />
          </dl>
        ),
        result: "Neither side can choose the challenge alone",
        source: <Source href={RANDOM_SOURCE}>Secure random values</Source>,
      },
      {
        title: "The two random values select one challenge",
        text: "The browser hashes the private secret with the server nonce and the fingerprint for this hand and player. The first three result bits form a number from 0 through 7. That number selects one of eight challenges. Repeating the same inputs always selects the same challenge.",
        detail: (
          <dl>
            <Value label="Possible challenges" value="8" />
            <Value label="Selected challenge" value="Private to this player" />
          </dl>
        ),
        result: "The commitment and nonce fix one hidden challenge",
        source: <Source href={BLAKE2_SPEC}>BLAKE2 specification</Source>,
      },
      {
        title: "Noir checks the fixed challenge list",
        text: "Noir Poker has eight fixed challenge rules. A catalog root is one public fingerprint covering that complete list. The circuit receives the selected rule and three supporting hashes in private. Those supporting hashes form a Merkle path. The circuit rebuilds the catalog root and rejects any rule outside the list.",
        detail: (
          <dl>
            <Value label="Catalog root" value={proof.catalog_root} />
            <Value label="Catalog size" value="8 fixed challenge rules" />
            <Value label="Private values" value="Selected rule and Merkle path" />
          </dl>
        ),
        result: "A player cannot invent an easier challenge",
        source: <Source href={MERKLE_SOURCE}>Merkle authentication source</Source>,
      },
      {
        title: "Noir checks the challenge draw",
        text: "A Noir circuit is a program that checks public and private values while keeping the private values hidden. This circuit recreates the commitment from the secret. It recreates the challenge number from the secret and nonce. It checks that the selected rule rebuilds the catalog root. Barretenberg then creates an UltraHonk proof certifying that all three checks passed.",
        detail: (
          <dl>
            <Value label="Proof bytes" value={`${proofBytes ?? 0} bytes forming the cryptographic certificate`} />
            <Value label="Public input bytes" value={`${publicBytes ?? 0} bytes containing the public values tied to that certificate`} />
            <Value label="Hidden inputs" value="Secret challenge and Merkle path" />
          </dl>
        ),
        result: "One proof covers the commitment selection and catalog checks",
        source: (
          <>
            <Source href={CIRCUIT_SOURCE}>Challenge circuit source</Source>
          </>
        ),
      },
      {
        title: "The server checks before publishing",
        text: "The browser sends the proof and its public values. The server compares the hand player commitment nonce and catalog root with the values already stored for this draw. It then runs the UltraHonk verifier. A mismatch or invalid proof is rejected. Only an accepted proof becomes public.",
        result: "Published means the server accepted every binding and the proof",
        source: <Source href={SERVER_VERIFIER}>Rust server verifier</Source>,
      },
      {
        title: "This browser checks the published proof",
        text: "This page downloads the exact proof and public values accepted by the server. It repeats every public comparison and runs UltraHonk locally. The artifact fingerprint identifies the exact compiled Noir circuit. The verification key fingerprint identifies the exact key used to check that circuit.",
        detail: (
          <dl>
            <Value label="Circuit artifact fingerprint" value={proof.artifact_sha256} />
            <Value label="Verification key fingerprint" value={proof.vk_sha256} />
            <Value label="Current result" value="Shown above this explanation" />
          </dl>
        ),
        result: "The browser does not rely on the server verification result",
        source: <Source href={BROWSER_VERIFIER}>Browser verification source</Source>,
      },
      {
        title: "The downloaded file verifies in a terminal",
        text: "Download the JSON with the action above. The file contains the exact accepted proof public values and circuit fingerprints. Run the command below from the web application folder. The local script repeats the public checks and UltraHonk verification. Changing one proof byte or public value makes the command fail.",
        detail: verificationActions,
        result: "Browser and terminal checks use the same accepted proof",
        source: <Source href={LOCAL_VERIFIER}>Local verifier source</Source>,
      },
    ];
  }

  return [
    {
      title: "The finished hand records six facts",
      text: "When the hand ends the game records six true or false facts for this player. They record reaching the flop raising before the flop calling before the flop checking on the flop reaching showdown and finishing with a net profit.",
      detail: (
        <dl>
          <Value label="Fact 1" value="Reached the flop" />
          <Value label="Fact 2" value="Raised before the flop" />
          <Value label="Fact 3" value="Called before the flop" />
          <Value label="Fact 4" value="Checked on the flop" />
          <Value label="Fact 5" value="Reached showdown" />
          <Value label="Fact 6" value="Finished with a net profit" />
        </dl>
      ),
      result: "These six facts contain every condition used by the challenge list",
      source: <Source href={CIRCUIT_SOURCE}>Challenge circuit source</Source>,
    },
    {
      title: "The facts receive a private random value",
      text: "The player browser receives the six facts and a fresh random value called a salt. A salt is extra randomness mixed into a hash. BLAKE2s combines the hand player salt and six facts into the facts fingerprint below. The salt stays private so another person cannot test every possible fact combination against the fingerprint.",
      detail: (
        <dl>
          <Value label="Facts fingerprint" value={proof.facts_hash ?? ""} />
          <Value label="Private values" value="Six facts and random salt" />
        </dl>
      ),
      result: "The public fingerprint locks the facts without revealing them",
      source: <Source href={BLAKE2_SPEC}>BLAKE2 specification</Source>,
    },
    {
      title: "Noir recreates the original challenge",
      text: "The completion circuit recreates the earlier commitment from the private secret. It combines that secret with the stored server nonce to recreate the challenge number. It then checks that the selected challenge belongs to the fixed eight rule catalog. A separate draw proof is not required because these assignment checks run again inside this proof.",
      detail: (
        <dl>
          <Value label="Original commitment" value={proof.commitment} />
          <Value label="Original server nonce" value={proof.nonce} />
          <Value label="Catalog root" value={proof.catalog_root} />
        </dl>
      ),
      result: "The completion claim uses the challenge assigned before play",
      source: (
        <>
          <Source href={BLAKE2_SPEC}>BLAKE2 specification</Source>
          <Source href={MERKLE_SOURCE}>Merkle authentication source</Source>
        </>
      ),
    },
    {
      title: "Noir compares the challenge with the hand facts",
      text: "Each catalog rule lists facts that must be true and facts that must be false. The circuit compares the selected private rule with all six private hand facts. A challenge requiring showdown passes only when the showdown fact is true. Any unmet condition stops proof creation.",
      result: "A valid proof means every condition in the assigned challenge passed",
      source: <Source href={CIRCUIT_SOURCE}>Completion constraints</Source>,
    },
    {
      title: "The completion can only be counted once",
      text: "The circuit hashes the hand fingerprint player seat and private secret into the nullifier shown below. A nullifier is a unique public fingerprint for one challenge claim. The server accepts it once. Reusing the same completion proof produces the same nullifier and is rejected.",
      detail: (
        <dl>
          <Value label="Nullifier" value={proof.nullifier ?? ""} />
          <Value label="Private input" value="Challenge secret" />
        </dl>
      ),
      result: "One completed challenge can be counted once",
      source: <Source href={BLAKE2_SPEC}>BLAKE2 specification</Source>,
    },
    {
      title: "The browser creates the completion proof",
      text: "A Noir circuit is a program that checks public and private values while keeping the private values hidden. This circuit runs every assignment fact and nullifier check together. Barretenberg creates an UltraHonk proof certifying that all checks passed without exposing the secret challenge path facts or salt.",
      detail: (
        <dl>
          <Value label="Proof bytes" value={`${proofBytes ?? 0} bytes forming the cryptographic certificate`} />
          <Value label="Public input bytes" value={`${publicBytes ?? 0} bytes containing the public values tied to that certificate`} />
          <Value label="Hidden inputs" value="Secret challenge path facts and salt" />
        </dl>
      ),
      result: "The proof reveals completion without revealing the challenge or hand facts",
      source: (
        <>
          <Source href={CIRCUIT_SOURCE}>Challenge circuit source</Source>
        </>
      ),
    },
    {
      title: "The server checks before publishing",
      text: "The browser sends the proof and its public values. The server compares the hand player commitment nonce catalog root facts fingerprint and nullifier with the stored hand data. It runs the UltraHonk verifier and checks that the nullifier has not been used. Only an accepted proof becomes public.",
      result: "Published means the bindings proof and duplicate check passed",
      source: <Source href={SERVER_VERIFIER}>Rust server verifier</Source>,
    },
    {
      title: "This browser checks the published proof",
      text: "This page downloads the exact proof and public values accepted by the server. It repeats every public comparison and runs UltraHonk locally. The artifact fingerprint identifies the exact compiled Noir circuit. The verification key fingerprint identifies the exact key used to check that circuit.",
      detail: (
        <dl>
          <Value label="Circuit artifact fingerprint" value={proof.artifact_sha256} />
          <Value label="Verification key fingerprint" value={proof.vk_sha256} />
          <Value label="Current result" value="Shown above this explanation" />
        </dl>
      ),
      result: "The browser verifies the claim independently",
      source: <Source href={BROWSER_VERIFIER}>Browser verification source</Source>,
    },
    {
      title: "The downloaded file verifies in a terminal",
      text: "Download the JSON with the action above. The file contains the exact accepted proof public values and circuit fingerprints. Run the command below from the web application folder. The local script repeats the public checks and UltraHonk verification. Changing one proof byte or public value makes the command fail.",
      detail: verificationActions,
      result: "Browser and terminal checks use the same accepted proof",
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
