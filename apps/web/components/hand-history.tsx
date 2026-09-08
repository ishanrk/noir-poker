"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import styles from "@/components/crypto.module.css";
import { SiteHeader } from "@/components/site-header";
import { loadHandHistory, type HandMeta } from "@/lib/server";

export function HandHistory({ room }: { room: string }) {
  const [hands, setHands] = useState<HandMeta[]>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let live = true;
    void loadHandHistory(room)
      .then((value) => { if (live) setHands([...value].reverse()); })
      .catch((cause) => { if (live) setError(cause instanceof Error ? cause.message : "history unavailable"); });
    return () => { live = false; };
  }, [room]);

  return (
    <main className="site-shell">
      <SiteHeader compact />
      <div className={styles.page}>
        <header className={styles.hero}>
          <p className={styles.label}>Room <code>{room}</code></p>
          <h1>Hand history</h1>
          <p>Completed hands with a public deal transcript</p>
        </header>
        {error && <p className={styles.error}>{error}</p>}
        <div className={styles.list}>
          {hands?.map((hand) => (
            <article className={styles.entry} key={hand.hand_no}>
              <strong>Hand {hand.hand_no + 1}</strong>
              <span>Transcript ready. Dealer is Player {hand.dealer + 1}.</span>
              <Link href={`/audit/${room}/${hand.hand_no}`}>Check this deal</Link>
            </article>
          ))}
          {!hands && !error && <p role="status">Loading hand history…</p>}
          {hands?.length === 0 && <p>No completed hands yet.</p>}
        </div>
      </div>
    </main>
  );
}
