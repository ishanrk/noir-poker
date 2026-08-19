import Link from "next/link";

export type ProofState = "idle" | "preparing" | "proving" | "verifying" | "verified" | "failed";
export type ContractAssignment =
  | { kind: "available" }
  | { kind: "draw"; handNo: number }
  | {
      kind: "assigned";
      handNo: number;
      objective: string;
      reward: number;
      active: boolean;
      drawVerified: boolean;
      drawState: ProofState;
      commitment: string;
      nonce: string;
      catalogRoot: string;
    };
export type ContractClaim = {
  handNo: number;
  objective?: string;
  reward: number;
  completed?: boolean;
  state: ProofState;
  receipt?: string;
};
export type ContractView = { assignment: ContractAssignment; claim?: ContractClaim; error?: string };

type ContractProps = {
  view: ContractView;
  disabled?: boolean;
  onCommit: () => void;
  onVerifyDraw: () => void;
  onProve: () => void;
};

const busy = (state: ProofState) => ["preparing", "proving", "verifying"].includes(state);
const label = (state: ProofState) =>
  ({
    idle: "ready",
    preparing: "building witness",
    proving: "proving in browser",
    verifying: "server verification",
    verified: "verified",
    failed: "failed",
  })[state];

function ProofRail({ state }: { state: ProofState }) {
  const active = state === "preparing" ? 0 : state === "proving" ? 1 : state === "verifying" ? 2 : -1;
  const complete = state === "verified";

  return (
    <ol className="proof-rail" aria-label="Proof progress">
      {["witness", "proof", "verify"].map((step, index) => (
        <li key={step} data-active={index === active} data-complete={complete || (active >= 0 && index < active)}>
          <i />
          <span>{step}</span>
        </li>
      ))}
    </ol>
  );
}

function SealedBounty({ verified = false }: { verified?: boolean }) {
  return (
    <div className="sealed-bounty" data-verified={verified} aria-label="Hidden bounty remains sealed">
      <div className="sealed-bounty-face">
        <span>Private bounty</span>
        <strong>?</strong>
        <small>{verified ? "proof accepted" : "objective concealed"}</small>
      </div>
      <i aria-hidden="true" />
    </div>
  );
}

export function Contract({ view, disabled = false, onCommit, onVerifyDraw, onProve }: ContractProps) {
  const { assignment, claim } = view;

  return (
    <section className="contract-panel" aria-label="Private bounty protocol">
      <header className="contract-header">
        <div>
          <p className="protocol-label">ZK bounty</p>
          <h2>Prove the sealed objective.</h2>
        </div>
        <Link href="/protocol#bounties">What a verifier learns →</Link>
      </header>

      <div className="contract-layout">
        <SealedBounty verified={claim?.state === "verified"} />

        <div className="contract-work">
          {claim && (
            <section className="contract-phase">
              <div className="contract-line">
                <span>Completion / hand {claim.handNo}</span>
                <strong data-state={claim.state}>{label(claim.state)}</strong>
              </div>
              {claim.state === "verified" ? (
                <div className="proof-award">
                  <strong>+{claim.reward} proof points</strong>
                  <span>objective still hidden</span>
                  {claim.receipt && <Link href={claim.receipt}>Open public verifier →</Link>}
                </div>
              ) : (
                <>
                  {claim.objective && <p className="private-copy">Only you see: {claim.objective}</p>}
                  {claim.completed === false && <p className="contract-note">Objective missed. No proof can be generated.</p>}
                  {claim.completed && (
                    <>
                      <ProofRail state={claim.state} />
                      {!busy(claim.state) && (
                        <button type="button" onClick={onProve} disabled={disabled}>
                          {claim.state === "failed" ? "Retry completion proof" : "Prove completion"} →
                        </button>
                      )}
                    </>
                  )}
                </>
              )}
            </section>
          )}

          {assignment.kind === "available" && (
            <p className="contract-empty">The next sealed bounty appears when this hand settles.</p>
          )}

          {assignment.kind === "draw" && (
            <section className="contract-phase">
              <div className="contract-line">
                <span>Selection / hand {assignment.handNo}</span>
                <strong>not drawn</strong>
              </div>
              <p>
                Lock a browser secret first. The server then adds fresh entropy. Neither side can
                choose the objective after seeing the other side&apos;s value.
              </p>
              <button type="button" onClick={onCommit} disabled={disabled}>Commit & draw →</button>
            </section>
          )}

          {assignment.kind === "assigned" && (
            <section className="contract-phase">
              <div className="contract-line">
                <span>Selection / hand {assignment.handNo}</span>
                <strong data-state={assignment.drawVerified ? "verified" : assignment.drawState}>
                  {assignment.drawVerified ? "verified" : label(assignment.drawState)}
                </strong>
              </div>
              {!assignment.drawVerified && <ProofRail state={assignment.drawState} />}
              {!assignment.drawVerified && !busy(assignment.drawState) && (
                <button type="button" onClick={onVerifyDraw} disabled={disabled}>
                  {assignment.drawState === "failed" ? "Retry selection proof" : "Prove fair selection"} →
                </button>
              )}
              <div className="private-copy">
                <span>Only this browser knows</span>
                <strong>{assignment.objective}</strong>
                <small>{assignment.reward} points — {assignment.active ? "in play" : "ready for next hand"}</small>
              </div>
              <details className="protocol-details">
                <summary>Inspect public bindings</summary>
                <dl>
                  <div><dt>commitment</dt><dd>{assignment.commitment}</dd></div>
                  <div><dt>server nonce</dt><dd>{assignment.nonce}</dd></div>
                  <div><dt>catalog root</dt><dd>{assignment.catalogRoot}</dd></div>
                </dl>
              </details>
            </section>
          )}

          {view.error && <p className="form-error">{view.error}</p>}
        </div>
      </div>
    </section>
  );
}
