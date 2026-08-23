import Link from "next/link";

import styles from "@/components/crypto.module.css";
import type { ContractView } from "@/components/contract";

export function PlayProofs({ room, view }: {
  room: string;
  view: ContractView;
}) {
  if (!view.proofs.length) return null;

  return (
    <section className={styles.strip} aria-label="Challenge proofs">
      <header className={styles.stripHead}>
        <div>
          <p className={styles.label}>CHALLENGE PROOFS</p>
          <h2>PUBLIC PROOF HISTORY</h2>
        </div>
        <p className={styles.proofPrivacy}>PRIVATE OBJECTIVES STAY HIDDEN</p>
      </header>
      <div className={styles.proofRows}>
        {view.proofs.map((proof) => (
          <div className={styles.proofPlayer} key={proof.seat}>
            <div className={styles.proofOwner}>
              <strong>{proof.name.toUpperCase()}</strong>
              <span>{proof.completed} COMPLETED</span>
              <Link href={`/room/${room}/proofs/player/${proof.seat}`} target="_blank">FULL HISTORY</Link>
            </div>
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
  proof?: ContractView["proofs"][number]["draw"];
}) {
  const label = kind === "draw" ? "FAIR DRAW" : "COMPLETION";
  const local = proof?.local === "verified"
    ? "VERIFIED LOCALLY"
    : proof?.local === "failed"
      ? "INVALID LOCALLY"
      : proof?.local === "verifying"
        ? "VERIFYING"
        : undefined;

  return (
    <div className={styles.proofItem}>
      <div>
        <span>{label}</span>
        {proof && <small>HAND {proof.handNo + 1}</small>}
      </div>
      {proof?.published ? (
        <div className={styles.proofStatus}>
          <strong>{local ?? "PUBLISHED"}</strong>
          {local !== "VERIFYING" && (
            <Link
              href={`/room/${room}/proofs/${proof.handNo}/${seat}/${kind}`}
              target="_blank"
              rel="noreferrer"
            >
              VERIFY
            </Link>
          )}
          {proof.receipt && <Link href={proof.receipt} target="_blank" rel="noreferrer">PUBLIC RECEIPT</Link>}
        </div>
      ) : (
        <strong>NOT PUBLISHED</strong>
      )}
    </div>
  );
}
