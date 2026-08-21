import Link from "next/link";

import { Keycap } from "@/components/keycap";

export type ProofState = "idle" | "preparing" | "proving" | "verifying" | "verified" | "failed";
export type LocalProofState = "idle" | "verifying" | "verified" | "failed";
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
};
export type ProofMeta = {
  handNo: number;
  published: boolean;
  local: LocalProofState;
  receipt?: string;
};
export type PlayerProof = {
  seat: number;
  name: string;
  points: number;
  draw?: ProofMeta;
  completion?: ProofMeta;
};
export type ContractView = {
  assignment: ContractAssignment;
  claim?: ContractClaim;
  proofs: PlayerProof[];
  error?: string;
};

type PrivateProps = {
  view: ContractView;
  disabled?: boolean;
  onCommit: () => void;
  onDraw: () => void;
  onClaim: () => void;
};

type ProofProps = {
  proofs: PlayerProof[];
  disabled?: boolean;
  onVerify: (seat: number, hand: number, kind: "draw" | "completion") => void;
};

const busy = (state: ProofState) => ["preparing", "proving", "verifying"].includes(state);
const proofLabel = (state: ProofState) => {
  if (state === "preparing" || state === "proving") return "generating";
  if (state === "verifying") return "server checking";
  if (state === "verified") return "published";
  if (state === "failed") return "failed";
  return "not published";
};

const localLabel = (proof: ProofMeta | undefined) => {
  if (!proof?.published) return "not published";
  if (proof.local === "verifying") return "verifying";
  if (proof.local === "verified") return "valid proof";
  if (proof.local === "failed") return "invalid proof";
  return "published";
};

export function PrivateChallenge({
  view,
  disabled = false,
  onCommit,
  onDraw,
  onClaim,
}: PrivateProps) {
  const { assignment, claim } = view;

  return (
    <section className="private-challenge" aria-label="Your private challenge">
      <header>
        <div>
          <span>Private challenge</span>
          <strong>
            {assignment.kind === "assigned"
              ? assignment.objective
              : assignment.kind === "draw"
                ? "Draw your next challenge"
                : "Available after this hand"}
          </strong>
        </div>
        {assignment.kind === "assigned" && <b>+{assignment.reward}</b>}
      </header>

      {assignment.kind === "draw" && (
        <button className="key-action key-compact" type="button" onClick={onCommit} disabled={disabled}>
          <Keycap>Draw Challenge</Keycap>
        </button>
      )}

      {assignment.kind === "assigned" && (
        <div className="private-proof">
          <span>Fair draw proof</span>
          <strong>{assignment.drawVerified ? "published" : proofLabel(assignment.drawState)}</strong>
          {!assignment.drawVerified && !busy(assignment.drawState) && (
            <button className="key-action key-compact" type="button" onClick={onDraw} disabled={disabled}>
              <Keycap>
                {assignment.drawState === "failed" ? "Retry Proof" : "Generate Fair Draw Proof"}
              </Keycap>
            </button>
          )}
          <small>{assignment.active ? "current hand" : "next hand"}</small>
        </div>
      )}

      {claim && (
        <div className="private-proof">
          <span>Completion</span>
          {claim.state === "verified" ? (
            <>
              <strong>published</strong>
              <small>+{claim.reward} proof points</small>
            </>
          ) : claim.completed === false ? (
            <>
              <strong>Challenge missed</strong>
              <small>No completion proof +0</small>
            </>
          ) : claim.completed ? (
            <>
              <strong>{proofLabel(claim.state)}</strong>
              {!busy(claim.state) && (
                <button className="key-action key-compact" type="button" onClick={onClaim} disabled={disabled}>
                  <Keycap>
                    {claim.state === "failed" ? "Retry Proof" : "Generate Completion Proof"}
                  </Keycap>
                </button>
              )}
            </>
          ) : (
            <strong>hand active</strong>
          )}
        </div>
      )}

      {assignment.kind === "assigned" && (
        <details>
          <summary>Public bindings</summary>
          <dl>
            <div><dt>commitment</dt><dd>{assignment.commitment}</dd></div>
            <div><dt>server nonce</dt><dd>{assignment.nonce}</dd></div>
            <div><dt>catalog root</dt><dd>{assignment.catalogRoot}</dd></div>
          </dl>
        </details>
      )}

      {view.error && <p className="form-error">{view.error}</p>}
    </section>
  );
}

function ProofLine({
  label,
  kind,
  seat,
  proof,
  disabled,
  onVerify,
}: {
  label: string;
  kind: "draw" | "completion";
  seat: number;
  proof?: ProofMeta;
  disabled: boolean;
  onVerify: ProofProps["onVerify"];
}) {
  return (
    <div className="player-proof-line">
      <span>{label}</span>
      <strong data-state={proof?.local}>{localLabel(proof)}</strong>
      <div>
        {proof?.published && proof.local !== "verifying" && (
          <button className="key-action key-verify" type="button" onClick={() => onVerify(seat, proof.handNo, kind)} disabled={disabled}>
            <Keycap>Verify</Keycap>
          </button>
        )}
        {proof?.receipt && <Link href={proof.receipt}>Public receipt</Link>}
      </div>
    </div>
  );
}

export function ChallengeProofs({ proofs, disabled = false, onVerify }: ProofProps) {
  if (proofs.length === 0) return null;

  return (
    <section className="challenge-proofs" aria-label="Challenge proofs">
      <header>
        <div>
          <p className="protocol-label">Challenge proofs</p>
          <h2>Public proof status</h2>
        </div>
      </header>
      <div className="player-proofs">
        {proofs.map((player) => (
          <article key={player.seat}>
            <header>
              <strong>{player.name}</strong>
              <span>{player.points} proof points</span>
            </header>
            <ProofLine
              label="Fair draw"
              kind="draw"
              seat={player.seat}
              proof={player.draw}
              disabled={disabled}
              onVerify={onVerify}
            />
            <ProofLine
              label="Completion"
              kind="completion"
              seat={player.seat}
              proof={player.completion}
              disabled={disabled}
              onVerify={onVerify}
            />
          </article>
        ))}
      </div>
    </section>
  );
}
