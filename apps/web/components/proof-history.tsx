"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import styles from "@/components/crypto.module.css";
import { SiteHeader } from "@/components/site-header";
import { loadProofHistory, type ProofMeta } from "@/lib/server";

export function ProofHistory({ room }: { room: string }) {
  const [proofs, setProofs] = useState<ProofMeta[]>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let live = true;
    void loadProofHistory(room)
      .then((value) => { if (live) setProofs([...value].reverse()); })
      .catch((cause) => { if (live) setError(cause instanceof Error ? cause.message : "history unavailable"); });
    return () => { live = false; };
  }, [room]);

  return (
    <main className="site-shell">
      <SiteHeader compact />
      <div className={styles.page}>
        <header className={styles.hero}>
          <p className={styles.label}>ROOM {room}</p>
          <h1>PROOF HISTORY</h1>
          <p>Published challenge evidence without private objectives or witnesses</p>
        </header>
        {error && <p className={styles.error}>{error}</p>}
        <div className={styles.list}>
          {proofs?.flatMap((proof) => [
            proof.draw_published && (
              <ProofEntry key={`${proof.hand_no}-${proof.seat}-draw`} room={room} proof={proof} kind="draw" />
            ),
            proof.completion_published && (
              <ProofEntry key={`${proof.hand_no}-${proof.seat}-completion`} room={room} proof={proof} kind="completion" />
            ),
          ])}
        </div>
      </div>
    </main>
  );
}

function ProofEntry({ room, proof, kind }: {
  room: string;
  proof: ProofMeta;
  kind: "draw" | "completion";
}) {
  return (
    <article className={styles.entry}>
      <strong>HAND {proof.hand_no + 1}</strong>
      <span>
        PLAYER {proof.seat + 1}&nbsp;&nbsp;&nbsp;{kind === "draw" ? "DRAW PROOF" : "COMPLETION PROOF"}
        {kind === "completion" && proof.points ? `   +${proof.points} PROOF POINTS` : ""}
      </span>
      <Link href={`/room/${room}/proofs/${proof.hand_no}/${proof.seat}/${kind}`}>VIEW</Link>
    </article>
  );
}
