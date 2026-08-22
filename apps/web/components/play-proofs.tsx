import Link from "next/link";

import styles from "@/components/crypto.module.css";
import type { ContractView } from "@/components/contract";

export function PlayProofs({ room, view }: { room: string; view: ContractView }) {
  if (!view.proofs.length) return null;

  return (
    <section className={styles.strip} aria-label="Challenge proofs">
      <p className={styles.label}>CHALLENGE PROOFS</p>
      <div className={styles.proofRows}>
        {view.proofs.map((proof) => (
          <div className={styles.proofPlayer} key={proof.seat}>
            <strong>
              {proof.name.toUpperCase()}
              <Link href={`/room/${room}/proofs/player/${proof.seat}`} target="_blank">HISTORY</Link>
            </strong>
            <ProofItem room={room} seat={proof.seat} kind="draw" proof={proof.draw} />
            <ProofItem room={room} seat={proof.seat} kind="completion" proof={proof.completion} />
          </div>
        ))}
      </div>
      <nav className={styles.links}>
        <Link href={`/room/${room}/proofs`} target="_blank">VIEW PROOF HISTORY</Link>
      </nav>
    </section>
  );
}

function ProofItem({ room, seat, kind, proof }: {
  room: string;
  seat: number;
  kind: "draw" | "completion";
  proof?: { handNo: number; published: boolean };
}) {
  const label = kind === "draw" ? "DRAW PROOF" : "COMPLETION PROOF";

  return (
    <div className={styles.proofItem}>
      <span>{label}</span>
      {proof?.published ? (
        <Link href={`/room/${room}/proofs/${proof.handNo}/${seat}/${kind}`} target="_blank">PUBLISHED&nbsp;&nbsp;VIEW</Link>
      ) : (
        <span>NOT PUBLISHED</span>
      )}
    </div>
  );
}
