import styles from "@/components/crypto.module.css";
import type { ContractView } from "@/components/contract";

export function PrivateChallengeBar({ view, onRetry }: {
  view: ContractView;
  onRetry: (kind: "draw" | "completion") => void;
}) {
  const assignment = view.assignment;
  if (assignment.kind !== "assigned") return null;

  const draw = assignment.drawVerified
    ? "DRAW PROOF PUBLISHED"
    : assignment.drawState === "failed"
      ? "DRAW PROOF FAILED"
      : assignment.drawState === "idle"
        ? "DRAW PROOF QUEUED"
        : "DRAW PROOF RUNNING";
  const claim = view.claim?.state === "verified"
    ? "COMPLETION PROOF PUBLISHED"
    : view.claim?.state === "failed"
      ? "COMPLETION PROOF FAILED"
      : view.claim?.completed
        ? "COMPLETION PROOF RUNNING"
        : undefined;

  return (
    <section className={`${styles.strip} ${styles.private}`} aria-label="Private challenge">
      <div>
        <p className={styles.label}>PRIVATE CHALLENGE</p>
        <strong>{assignment.objective}</strong>
        <small>+{assignment.reward} PROOF POINTS</small>
      </div>
      <div className={styles.state}>
        <span>{draw}</span>
        {claim && <span>{claim}</span>}
        {assignment.drawState === "failed" && (
          <button className={styles.retry} type="button" onClick={() => onRetry("draw")}>RETRY PROOF</button>
        )}
        {view.claim?.completed === false && <span>CHALLENGE MISSED</span>}
        {view.claim?.state === "failed" && (
          <button className={styles.retry} type="button" onClick={() => onRetry("completion")}>RETRY PROOF</button>
        )}
      </div>
    </section>
  );
}
