import Link from "next/link";

export type ProofState =
  | "idle"
  | "preparing"
  | "proving"
  | "verifying"
  | "verified"
  | "failed";

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

export type ContractView = {
  assignment: ContractAssignment;
  claim?: ContractClaim;
  error?: string;
};

type ContractProps = {
  view: ContractView;
  disabled?: boolean;
  onCommit: () => void;
  onVerifyDraw: () => void;
  onProve: () => void;
};

function proofStatus(state: ProofState) {
  switch (state) {
    case "preparing":
      return "preparing witness";
    case "proving":
      return "generating proof";
    case "verifying":
      return "server verification";
    case "verified":
      return "verified";
    case "failed":
      return "proof failed";
    case "idle":
      return undefined;
  }
}

function proofBusy(state: ProofState) {
  return state === "preparing" || state === "proving" || state === "verifying";
}

function ProofFlow({ state }: { state: ProofState }) {
  const current =
    state === "preparing" ? 0 : state === "proving" ? 1 : state === "verifying" ? 2 : -1;
  const complete = state === "verified";
  const steps = ["witness", "proving", "server verification"];

  return (
    <div className="proof-flow" aria-label="Proof progress">
      {steps.map((step, index) => {
        const done = complete || (current >= 0 && index < current);
        const active = index === current;

        return (
          <span
            className={`proof-step${done ? " proof-step-done" : ""}${active ? " proof-step-active" : ""}`}
            key={step}
          >
            {step}
          </span>
        );
      })}
    </div>
  );
}

function claimStatus(claim: ContractClaim) {
  return (
    proofStatus(claim.state) ??
    (claim.completed
      ? "completion proof available"
      : claim.completed === false
        ? "objective missed"
        : "result unavailable")
  );
}

export function Contract({
  view,
  disabled = false,
  onCommit,
  onVerifyDraw,
  onProve,
}: ContractProps) {
  const claim = view.claim;
  const assignment = view.assignment;
  const claimBusy = claim ? proofBusy(claim.state) : false;

  return (
    <section className="contract-panel" aria-label="Fair draw">
      <header className="contract-header">
        <span>Fair draw</span>
        <small>commit · entropy · proof</small>
      </header>

      {claim && (
        <div className="contract-block">
          <div className="contract-line">
            <span>Completion / Hand {claim.handNo}</span>
            <strong className={claim.state === "verified" ? "state-ok" : undefined}>
              {claimStatus(claim)}
            </strong>
          </div>

          {claim.state === "verified" ? (
            <div className="contract-result">
              <strong>+{claim.reward} proof points</strong>
              {claim.receipt && <Link href={claim.receipt}>view proof receipt →</Link>}
            </div>
          ) : (
            <>
              {claim.objective && (
                <strong className="contract-objective">{claim.objective}</strong>
              )}
              {claim.completed === false && (
                <span className="contract-note">no completion proof generated</span>
              )}
              {claim.completed && (
                <>
                  <span className="contract-note">{claim.reward} proof points available</span>
                  {claim.state !== "idle" && <ProofFlow state={claim.state} />}
                  {!claimBusy && (
                    <button type="button" onClick={onProve} disabled={disabled}>
                      {claim.state === "failed" ? "Retry completion proof" : "Generate completion proof"}
                    </button>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}

      {claim && assignment.kind !== "available" && <div className="contract-divider" />}

      {assignment.kind === "available" && (
        <span className="contract-empty">hidden objective available after this hand</span>
      )}

      {assignment.kind === "draw" && (
        <div className="contract-block">
          <div className="contract-line">
            <span>Next objective / Hand {assignment.handNo}</span>
            <strong>not drawn</strong>
          </div>
          <strong className="contract-objective">One of eight committed objectives</strong>
          <span className="contract-note">client commitment → server entropy → hidden index</span>
          <button type="button" onClick={onCommit} disabled={disabled}>
            Commit &amp; draw
          </button>
        </div>
      )}

      {assignment.kind === "assigned" && (
        <div className="contract-block">
          <div className="contract-line">
            <span>Selection / Hand {assignment.handNo}</span>
            <strong className={assignment.drawVerified ? "state-ok" : undefined}>
              {assignment.drawVerified
                ? "verified"
                : proofStatus(assignment.drawState) ?? "proof required"}
            </strong>
          </div>

          <div className="protocol-list" aria-label="Fair draw protocol">
            <div>
              <span>client commitment</span>
              <strong>locked</strong>
            </div>
            <div>
              <span>server entropy</span>
              <strong>received</strong>
            </div>
            <div>
              <span>objective pool</span>
              <strong>8 leaves</strong>
            </div>
            <div>
              <span>selection proof</span>
              <strong className={assignment.drawVerified ? "state-ok" : undefined}>
                {assignment.drawVerified ? "verified" : "pending"}
              </strong>
            </div>
          </div>

          {!assignment.drawVerified && assignment.drawState !== "idle" && (
            <ProofFlow state={assignment.drawState} />
          )}

          {!assignment.drawVerified && !proofBusy(assignment.drawState) && (
            <button type="button" onClick={onVerifyDraw} disabled={disabled}>
              {assignment.drawState === "failed" ? "Retry fair draw proof" : "Prove fair draw"}
            </button>
          )}

          <div className="private-objective">
            <span>Private objective</span>
            <strong>{assignment.objective}</strong>
            <small>
              visible only in this browser · {assignment.reward} proof points ·{" "}
              {assignment.active ? "in play" : assignment.drawVerified ? "ready for hand" : "verify draw"}
            </small>
          </div>

          <details className="protocol-details">
            <summary>inspect protocol</summary>
            <dl>
              <div>
                <dt>commitment</dt>
                <dd>{assignment.commitment}</dd>
              </div>
              <div>
                <dt>server nonce</dt>
                <dd>{assignment.nonce}</dd>
              </div>
              <div>
                <dt>catalog root</dt>
                <dd>{assignment.catalogRoot}</dd>
              </div>
              <div>
                <dt>protocol</dt>
                <dd>v2</dd>
              </div>
            </dl>
          </details>
        </div>
      )}

      {view.error && <span className="room-error">{view.error}</span>}
    </section>
  );
}
