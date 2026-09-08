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
          <p className={styles.label}>ROOM {room}</p>
          <h1>{seat === undefined ? "PROOF HISTORY" : `PLAYER ${seat + 1} PROOFS`}</h1>
          <p>Published challenge evidence without private objectives or hidden inputs</p>
        </header>
        {!proofs && !error && <p className={styles.proofNote}>LOADING PROOF HISTORY</p>}
        {error && (
          <div className={styles.actions}>
            <p className={styles.error}>{error}</p>
            <button type="button" onClick={retry}>RETRY</button>
          </div>
        )}
        {shown?.length === 0 && <p className={styles.proofNote}>NO CHALLENGE PROOFS YET</p>}
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
      <strong>HAND {proof.hand_no + 1}</strong>
      <div className={styles.historyProofs}>
        <span>PLAYER {proof.seat + 1}</span>
        <span>
          DRAW PROOF&nbsp;&nbsp;&nbsp;{proof.draw_published ? "PUBLISHED" : "NOT PUBLISHED"}
          {proof.draw_published && <Link href={`/room/${room}/proofs/${proof.hand_no}/${proof.seat}/draw`} target="_blank">VIEW</Link>}
        </span>
        <span>
          COMPLETION&nbsp;&nbsp;&nbsp;{proof.completion_published
            ? "CHALLENGE COMPLETED"
            : proof.finished
              ? "MISSED"
              : "ASSIGNED"}
          {proof.completion_published && <Link href={`/room/${room}/proofs/${proof.hand_no}/${proof.seat}/completion`} target="_blank">VIEW</Link>}
        </span>
      </div>
    </article>
  );
}
