"use client";

import { PrivateChallenge, type ContractView } from "@/components/contract";

type ChallengePreviewState = "assigned" | "hit" | "miss" | "verified";

const noop = () => undefined;
const hex = "11".repeat(32);

export function ChallengeUiPreview({ state }: { state: ChallengePreviewState }) {
  return (
    <div className="challenge-live-preview" data-state={state}>
      <PrivateChallenge
        view={previewView(state)}
        disabled
        onCommit={noop}
        onDraw={noop}
        onClaim={noop}
      />
    </div>
  );
}

function previewView(state: ChallengePreviewState): ContractView {
  if (state === "assigned") {
    return {
      assignment: {
        kind: "assigned",
        handNo: 12,
        objective: "Reach showdown",
        reward: 20,
        active: false,
        drawVerified: true,
        drawState: "verified",
        commitment: hex,
        nonce: hex,
        catalogRoot: hex,
      },
      proofs: [],
    };
  }

  return {
    assignment: { kind: "available" },
    claim: {
      handNo: 12,
      objective: "Reach showdown",
      reward: 20,
      completed: state !== "miss",
      state: state === "verified" ? "verified" : "idle",
    },
    proofs: [],
  };
}
