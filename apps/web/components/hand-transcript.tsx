import Link from "next/link";

import styles from "@/components/crypto.module.css";
import type { DealView } from "@/components/deal-integrity";

export function HandTranscript({ room, hand, deal, settled }: {
  room: string;
  hand: number;
  deal?: DealView;
  settled: boolean;
}) {
  return (
    <section className={styles.strip} aria-label="Hand transcript">
      <div className={styles.stripHead}>
        <div>
          <p className={styles.label}>HAND TRANSCRIPT</p>
          <h2>HAND {hand + 1}</h2>
        </div>
        <div className={styles.state}>
          <strong>{settled && deal?.audit ? "TRANSCRIPT READY" : "DECK COMMITTED"}</strong>
          {!settled && deal?.commitment && <span>{deal.commitment.slice(0, 12).toUpperCase()}</span>}
        </div>
      </div>
      {settled && deal?.audit && (
        <nav className={styles.links} aria-label="Transcript links">
          <Link href={`/audit/${room}/${hand}`} target="_blank">VERIFY LAST HAND</Link>
          <Link href={`/room/${room}/hands`} target="_blank">HAND HISTORY</Link>
        </nav>
      )}
    </section>
  );
}
