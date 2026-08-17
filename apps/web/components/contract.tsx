export type ProofState =
  | "idle"
  | "preparing"
  | "proving"
  | "verifying"
  | "verified"
  | "failed";

export type ContractAssignment =
  | { kind: "available" }
  | { kind: "choose"; handNo: number }
  | {
      kind: "assigned";
      handNo: number;
      objective: string;
      reward: number;
      active: boolean;
      drawVerified: boolean;
      drawState: ProofState;
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
  onChoose: () => void;
  onDraw: () => void;
  onProve: () => void;
};

function proofStatus(state: ProofState) {
  switch (state) {
    case "preparing":
      return "Preparing witness";
    case "proving":
      return "Generating proof";
    case "verifying":
      return "Verifying";
    case "verified":
      return "Proof verified";
    case "failed":
      return "Proof failed";
    case "idle":
      return undefined;
  }
}

function claimStatus(claim: ContractClaim) {
  return (
    proofStatus(claim.state) ??
    (claim.completed
      ? "Completed"
      : claim.completed === false
        ? "Missed"
        : "Result unavailable")
  );
}

export function Contract({
  view,
  disabled = false,
  onChoose,
  onDraw,
  onProve,
}: ContractProps) {
  const claim = view.claim;
  const active =
    claim?.state === "preparing" ||
    claim?.state === "proving" ||
    claim?.state === "verifying";
  const assignment = view.assignment;
  const handNo =
    claim?.handNo ?? (assignment.kind === "available" ? undefined : assignment.handNo);
  const verified = claim?.state === "verified";

  return (
    <section
      className={`contract-panel${verified ? " contract-verified" : ""}`}
      aria-label="Secret contract"
    >
      <header className="contract-header">
        <span>Secret contract</span>
        {handNo !== undefined && <small>Hand {handNo}</small>}
      </header>

      {claim && (
        <div className="contract-claim">
          <span className="contract-state">{claimStatus(claim)}</span>
          {verified ? (
            <>
              <strong className="contract-reward">+{claim.reward} proof points</strong>
              {claim.receipt && <a href={claim.receipt}>View proof receipt</a>}
            </>
          ) : (
            <>
              {claim.objective && (
                <strong className="contract-objective">{claim.objective}</strong>
              )}
              {claim.completed && (
                <span className="contract-available">
                  {claim.reward} proof points available
                </span>
              )}
              {claim.completed && !active && (
                <button type="button" onClick={onProve} disabled={disabled}>
                  Generate proof
                </button>
              )}
            </>
          )}
        </div>
      )}

      {view.claim && assignment.kind !== "available" && (
        <div className="contract-divider" />
      )}

      {assignment.kind === "available" && (
        <span className="contract-empty">available after this hand</span>
      )}

      {assignment.kind === "choose" && (
        <div className="contract-choice">
          <strong>Draw a hidden objective for Hand {assignment.handNo}</strong>
          <button type="button" onClick={onChoose} disabled={disabled}>
            Draw objective
          </button>
          <span className="contract-private">commit first · server entropy second</span>
        </div>
      )}

      {assignment.kind === "assigned" && (
        <div className="contract-assigned">
          <span className="contract-state">
            {assignment.drawVerified
              ? "Fair draw verified"
              : proofStatus(assignment.drawState) ?? "Draw proof required"}
          </span>
          <strong className="contract-objective">{assignment.objective}</strong>
          <div className="contract-meta">
            <div>
              <span>Reward</span>
              <strong>{assignment.reward} proof points</strong>
            </div>
            <div>
              <span>Status</span>
              <strong>{assignment.active ? "in play" : "ready for hand"}</strong>
            </div>
          </div>
          {!assignment.drawVerified && assignment.drawState === "idle" && (
            <button type="button" onClick={onDraw} disabled={disabled}>
              Prove fair draw
            </button>
          )}
        </div>
      )}

      {view.error && <span className="room-error">{view.error}</span>}
    </section>
  );
}
