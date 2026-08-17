export type ClaimState =
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
    };

export type ContractClaim = {
  handNo: number;
  objective?: string;
  reward: number;
  completed?: boolean;
  state: ClaimState;
};

export type ContractView = {
  assignment: ContractAssignment;
  claim?: ContractClaim;
  error?: string;
};

type ContractProps = {
  view: ContractView;
  disabled?: boolean;
  onChoose: (tier: number) => void;
  onProve: () => void;
};

function claimStatus(claim: ContractClaim) {
  switch (claim.state) {
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
      return claim.completed
        ? "Completed"
        : claim.completed === false
          ? "Missed"
          : "Result unavailable";
  }
}

export function Contract({ view, disabled = false, onChoose, onProve }: ContractProps) {
  const claim = view.claim;
  const active =
    claim?.state === "preparing" ||
    claim?.state === "proving" ||
    claim?.state === "verifying";
  const assignment = view.assignment;
  const handNo = claim?.handNo ??
    (view.assignment.kind === "available" ? undefined : view.assignment.handNo);
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
            <strong className="contract-reward">+{claim.reward} proof points</strong>
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

      {view.claim && view.assignment.kind !== "available" && (
        <div className="contract-divider" />
      )}

      {assignment.kind === "available" && (
        <span className="contract-empty">available after this hand</span>
      )}

      {assignment.kind === "choose" && (
        <div className="contract-choice">
          <strong>Choose your risk for Hand {assignment.handNo}</strong>
          <div className="contract-tiers">
            <button type="button" onClick={() => onChoose(0)} disabled={disabled}>
              <span>Easy</span>
              <strong>10</strong>
              <small>proof points</small>
            </button>
            <button type="button" onClick={() => onChoose(1)} disabled={disabled}>
              <span>Hard</span>
              <strong>25</strong>
              <small>proof points</small>
            </button>
          </div>
          <span className="contract-private">tier public · exact objective private</span>
        </div>
      )}

      {assignment.kind === "assigned" && (
        <div className="contract-assigned">
          <span className="contract-state">Private objective</span>
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
        </div>
      )}

      {view.error && <span className="room-error">{view.error}</span>}
    </section>
  );
}
