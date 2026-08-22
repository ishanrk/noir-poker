"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import styles from "@/components/crypto.module.css";
import { SiteHeader } from "@/components/site-header";
import { verifyPublishedProof } from "@/lib/receipt";
import { loadPublishedProof, type ProofKind, type PublishedProof } from "@/lib/server";

type VerifyState = "verifying" | "verified" | "failed";

export function PublishedProofPage({ room, hand, seat, kind }: {
  room: string;
  hand: number;
  seat: number;
  kind: ProofKind;
}) {
  const [proof, setProof] = useState<PublishedProof>();
  const proofRef = useRef<PublishedProof | undefined>(undefined);
  const [state, setState] = useState<VerifyState>("verifying");
  const [error, setError] = useState<string>();

  const verify = useCallback(async (loaded?: PublishedProof) => {
    setState("verifying");
    setError(undefined);
    try {
      const value = loaded ?? proofRef.current ?? await loadPublishedProof(room, hand, seat, kind);
      proofRef.current = value;
      setProof(value);
      await verifyPublishedProof(value);
      setState("verified");
    } catch (cause) {
      setState("failed");
      setError(cause instanceof Error ? cause.message : "proof verification failed");
    }
  }, [hand, kind, room, seat]);

  useEffect(() => { queueMicrotask(() => void verify()); }, [verify]);

  function download() {
    if (!proof) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(proof, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `noir-poker-${kind}-${proof.hand_no}-${proof.seat}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const draw = kind === "draw";

  return (
    <main className="site-shell">
      <SiteHeader compact />
      <div className={styles.page}>
      <header className={styles.hero}>
        <p className={styles.label}>HAND {hand + 1}&nbsp;&nbsp;&nbsp;PLAYER {seat + 1}</p>
        <h1>{draw ? "DRAW PROOF" : "COMPLETION PROOF"}</h1>
      </header>
      <div className={styles.verifyState} data-state={state} aria-live="polite">
        {state === "verifying" ? "VERIFYING LOCALLY" : state === "verified" ? "VERIFIED LOCALLY" : "VERIFICATION FAILED"}
      </div>
      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.detailGrid}>
        <section>
          <h2>PUBLIC STATEMENT</h2>
          <p>{draw
            ? `Player ${seat + 1}'s hidden challenge came from their committed secret the public server nonce and the fixed challenge catalog`
            : `Player ${seat + 1} satisfied the same hidden challenge against the committed hand facts`}</p>
        </section>
        <section>
          <h2>PRIVATE WITNESS</h2>
          <p>{draw
            ? "Challenge browser secret selected index and Merkle path"
            : "Challenge browser secret selected index Merkle path private fact witness and fact salt"}</p>
        </section>
      </div>

      {proof && (
        <section className={styles.public}>
          <h2>PUBLIC INPUTS</h2>
          <dl>
            {Object.entries({
              mode: draw ? "0" : "1",
              "hand tag": proof.hand_tag,
              seat: proof.seat,
              commitment: proof.commitment,
              nonce: proof.nonce,
              ...(draw ? {} : { "facts hash": proof.facts_hash, nullifier: proof.nullifier }),
              "catalog root": proof.catalog_root,
            }).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
          </dl>
        </section>
      )}

      <div className={styles.actions}>
        <button type="button" onClick={() => void verify()} disabled={!proof}>RUN AGAIN</button>
        <button type="button" onClick={download} disabled={!proof}>DOWNLOAD JSON</button>
        <Link href={`/room/${room}/proofs`}>PROOF HISTORY</Link>
      </div>
      <section className={styles.public}>
        <h2>VERIFY YOURSELF</h2>
        <p><code>npm --prefix apps/web run proof:verify -- proof.json</code></p>
        <p>
          <Link href="https://github.com/ishanrk/noir-poker/blob/main/circuits/challenge-v2/src/main.nr">CIRCUIT SOURCE</Link>
          {"  "}
          <Link href="https://github.com/ishanrk/noir-poker/blob/main/apps/web/lib/challenge-proof.ts">BROWSER VERIFIER</Link>
          {"  "}
          <Link href="https://github.com/ishanrk/noir-poker/blob/main/apps/web/lib/challenge-proof.ts">BROWSER PROVER</Link>
          {"  "}
          <Link href="https://github.com/ishanrk/noir-poker/blob/main/apps/server/src/proof.rs">RUST VERIFIER</Link>
          {"  "}
          <Link href="https://github.com/ishanrk/noir-poker/blob/main/apps/web/scripts/verify-receipt.mjs">NODE VERIFIER</Link>
        </p>
      </section>
      </div>
    </main>
  );
}
