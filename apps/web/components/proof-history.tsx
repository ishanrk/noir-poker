"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import styles from "@/components/crypto.module.css";
import { SiteHeader } from "@/components/site-header";
import { loadProofHistory, type ProofMeta } from "@/lib/server";

export function ProofHistory({ room, seat }: { room: string; seat?: number }) {
  const [proofs, setProofs] = useState<ProofMeta[]>();
  const [error, setError] = useState<string>();
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let live = true;
    void loadProofHistory(room)
      .then((value) => { if (live) setProofs([...value].reverse()); })
      .catch((cause) => { if (live) setError(cause instanceof Error ? cause.message : "history unavailable"); });
    return () => { live = false; };
  }, [reload, room]);

  const shown = proofs?.filter((proof) => seat === undefined || proof.seat === seat);

  function retry() {
    setProofs(undefined);
    setError(undefined);
    setReload((value) => value + 1);
  }

  return (
    <main className="site-shell">
      <SiteHeader compact />
      <div className={styles.page}>
        <header className={styles.hero}>
          <p className={styles.label}>Room <code>{room}</code></p>
          <h1>{seat === undefined ? "Proof history" : `Player ${seat + 1} proofs`}</h1>
          <p>Published challenge evidence without private objectives or hidden inputs</p>
        </header>
        {!proofs && !error && <p className={styles.proofNote} role="status">Loading proof history…</p>}
        {error && (
          <div className={styles.actions}>
            <p className={styles.error}>{error}</p>
            <button type="button" onClick={retry}>Retry</button>
          </div>
        )}
        {shown?.length === 0 && <p className={styles.proofNote}>No challenge proofs yet.</p>}
        <div className={styles.list}>
          {shown?.map((proof) => (
            <ProofEntry key={`${proof.hand_no}-${proof.seat}`} room={room} proof={proof} />
          ))}
        </div>
      </div>
    </main>
  );
}

function ProofEntry({ room, proof }: {
  room: string;
  proof: ProofMeta;
}) {
  return (
    <article className={styles.entry}>
      <strong>Hand {proof.hand_no + 1}</strong>
      <div className={styles.historyProofs}>
        <span>Player {proof.seat + 1}</span>
        <span>
          Draw proof: {proof.draw_published ? "Published" : "Not published"}
          {proof.draw_published && <Link href={`/room/${room}/proofs/${proof.hand_no}/${proof.seat}/draw`} target="_blank">View proof</Link>}
        </span>
        <span>
          Completion: {proof.completion_published
            ? "Challenge completed"
            : proof.finished
              ? "Missed"
              : "Assigned"}
          {proof.completion_published && <Link href={`/room/${room}/proofs/${proof.hand_no}/${proof.seat}/completion`} target="_blank">View proof</Link>}
        </span>
      </div>
    </article>
  );
}
