import styles from "@/components/crypto.module.css";
import type { ContractView } from "@/components/contract";

type ProofKind = "draw" | "completion";

export function PrivateChallengeBar({ view, disabled = false, onCommit, onDraw, onClaimDraw, onClaim, onRetry }: {
  view: ContractView;
  disabled?: boolean;
  onCommit?: () => void;
  onDraw?: () => void;
  onClaimDraw?: () => void;
  onClaim?: () => void;
  onRetry?: (kind: ProofKind) => void;
}) {
  const assignment = view.assignment;
  if (assignment.kind === "available") {
    if (!view.claim) return null;
    return (
      <section className={`${styles.strip} ${styles.private}`} aria-label="Private challenge">
        <div className={styles.privateIntro}>
          <p className={styles.label}>PRIVATE CHALLENGE</p>
          <strong>{view.claim.objective ?? "PRIVATE OBJECTIVE"}</strong>
          <small>HAND {view.claim.handNo + 1}</small>
        </div>
        <div className={styles.privateProofs}>
          <Completion
            claim={view.claim}
            disabled={disabled || (!onClaim && !onRetry)}
            drawDisabled={disabled || (!onClaimDraw && !onRetry)}
            onDraw={() => onClaimDraw ? onClaimDraw() : onRetry?.("draw")}
            onGenerate={() => onClaim ? onClaim() : onRetry?.("completion")}
          />
        </div>
      </section>
    );
  }

  if (assignment.kind === "draw") {
    return (
      <section className={`${styles.strip} ${styles.private}`} aria-label="Private challenge">
        <div className={styles.privateIntro}>
          <p className={styles.label}>PRIVATE CHALLENGE</p>
          <strong>DRAW CHALLENGE FOR HAND {assignment.handNo + 1}</strong>
          <small>OBJECTIVE STAYS ON THIS DEVICE</small>
        </div>
        <button
          className={styles.retry}
          type="button"
          onClick={onCommit}
          disabled={disabled || !onCommit}
        >
          DRAW CHALLENGE
        </button>
        {view.claim && (
          <div className={styles.privateProofs}>
            <Completion
              claim={view.claim}
              disabled={disabled || (!onClaim && !onRetry)}
              drawDisabled={disabled || (!onClaimDraw && !onRetry)}
              onDraw={() => onClaimDraw ? onClaimDraw() : onRetry?.("draw")}
              onGenerate={() => onClaim ? onClaim() : onRetry?.("completion")}
            />
          </div>
        )}
      </section>
    );
  }

  const run = (kind: ProofKind) => {
    if (kind === "draw" && onDraw) onDraw();
    else if (kind === "completion" && onClaim) onClaim();
    else onRetry?.(kind);
  };

  const draw = assignment.drawVerified
    ? "PUBLISHED"
    : proofState(assignment.drawState);
  const claim = view.claim;

  return (
    <section className={`${styles.strip} ${styles.private}`} aria-label="Private challenge">
      <div className={styles.privateIntro}>
        <p className={styles.label}>PRIVATE CHALLENGE</p>
        <strong>{assignment.objective}</strong>
        <small>HAND {assignment.handNo + 1}</small>
      </div>
      <div className={styles.privateProofs}>
        <div className={styles.privateProof}>
          <span>FAIR DRAW</span>
          <strong>{draw}</strong>
          <small>OPTIONAL</small>
          {!assignment.drawVerified && !busy(assignment.drawState) && (
            <button
              className={styles.retry}
              type="button"
              onClick={() => run("draw")}
              disabled={disabled || (!onDraw && !onRetry)}
            >
              {assignment.drawState === "failed" ? "RETRY PROOF" : "GENERATE FAIR DRAW PROOF"}
            </button>
          )}
        </div>
        {claim && (
          <Completion
            claim={claim}
            disabled={disabled || (!onClaim && !onRetry)}
            drawDisabled={disabled || (!onClaimDraw && !onRetry)}
            onDraw={() => onClaimDraw ? onClaimDraw() : onRetry?.("draw")}
            onGenerate={() => run("completion")}
          />
        )}
      </div>
    </section>
  );
}

function Completion({ claim, disabled, drawDisabled, onDraw, onGenerate }: {
  claim: NonNullable<ContractView["claim"]>;
  disabled: boolean;
  drawDisabled: boolean;
  onDraw: () => void;
  onGenerate: () => void;
}) {
  const completion = claim.state === "verified" ? (
      <div className={styles.privateProof}>
        <span>HAND {claim.handNo + 1} COMPLETION</span>
        {claim.objective && <small>{claim.objective}</small>}
        <strong>PUBLISHED</strong>
        <small>CHALLENGE COMPLETED</small>
      </div>
    ) : claim.completed === false ? (
      <div className={styles.privateProof}>
        <span>HAND {claim.handNo + 1} COMPLETION</span>
        {claim.objective && <small>{claim.objective}</small>}
        <strong>CHALLENGE MISSED</strong>
        <small>NO COMPLETION PROOF</small>
      </div>
    ) : claim.completed ? (
    <div className={styles.privateProof}>
      <span>HAND {claim.handNo + 1} COMPLETION</span>
      {claim.objective && <small>{claim.objective}</small>}
      <strong>{proofState(claim.state)}</strong>
      {!busy(claim.state) && (
        <button className={styles.retry} type="button" onClick={onGenerate} disabled={disabled}>
          {claim.state === "failed" ? "RETRY PROOF" : "GENERATE COMPLETION PROOF"}
        </button>
      )}
    </div>
  ) : null;

  return (
    <>
      <div className={styles.privateProof}>
        <span>HAND {claim.handNo + 1} FAIR DRAW</span>
        <strong>{claim.drawVerified ? "PUBLISHED" : proofState(claim.drawState)}</strong>
        <small>OPTIONAL</small>
        {!claim.drawVerified && !busy(claim.drawState) && (
          <button className={styles.retry} type="button" onClick={onDraw} disabled={drawDisabled}>
            {claim.drawState === "failed" ? "RETRY PROOF" : "GENERATE FAIR DRAW PROOF"}
          </button>
        )}
      </div>
      {completion}
    </>
  );
}

function busy(state: NonNullable<ContractView["claim"]>["state"]) {
  return state === "preparing" || state === "proving" || state === "verifying";
}

function proofState(state: NonNullable<ContractView["claim"]>["state"]) {
  if (state === "preparing" || state === "proving") return "GENERATING";
  if (state === "verifying") return "SERVER CHECKING";
  if (state === "failed") return "PROOF FAILED";
  if (state === "verified") return "PUBLISHED";
  return "NOT PUBLISHED";
}
