import styles from "@/components/crypto.module.css";
import type { ContractView } from "@/components/contract";

export function PrivateChallengeBar({ view }: { view: ContractView }) {
  const claim = view.claim;

  if (claim) {
    const result = claim.completed === false
      ? "MISSED"
      : claim.completed
        ? "COMPLETED"
        : "CHECKING RESULT";

    return (
      <section
        className={`${styles.strip} ${styles.private} private-challenge-surface`}
        aria-label="Private challenge"
        data-proof-tour="challenge"
      >
        <div className={styles.privateIntro}>
          <p className={styles.label}>PRIVATE CHALLENGE · HAND {claim.handNo + 1}</p>
          <strong>{claim.objective ?? "PRIVATE OBJECTIVE"}</strong>
          <small>{result}</small>
        </div>
        {view.error && <p className={styles.privateError} role="alert">{view.error}</p>}
      </section>
    );
  }

  if (view.assignment.kind === "assigned") {
    return (
      <section
        className={`${styles.strip} ${styles.private} private-challenge-surface`}
        aria-label="Private challenge"
        data-proof-tour="challenge"
      >
        <div className={styles.privateIntro}>
          <p className={styles.label}>PRIVATE CHALLENGE · HAND {view.assignment.handNo + 1}</p>
          <strong>{view.assignment.objective}</strong>
          <small>IN PLAY</small>
        </div>
        {view.error && <p className={styles.privateError} role="alert">{view.error}</p>}
      </section>
    );
  }

  if (view.assignment.kind === "draw") {
    return (
      <section
        className={`${styles.strip} ${styles.private} private-challenge-surface`}
        aria-label="Private challenge"
        data-proof-tour="challenge"
      >
        <div className={styles.privateIntro}>
          <p className={styles.label}>PRIVATE CHALLENGE · HAND {view.assignment.handNo + 1}</p>
          <strong>DRAWING YOUR NEXT CHALLENGE</strong>
        </div>
        {view.error && <p className={styles.privateError} role="alert">{view.error}</p>}
      </section>
    );
  }

  return null;
}
