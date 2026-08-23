"use client";

import { useState } from "react";

const STEPS = [
  {
    label: "Commit",
    title: "The browser fixes one private secret.",
    copy: "Only its BLAKE2s commitment is sent. The server stores that value before returning a fresh public nonce.",
    code: 'commitment = BLAKE2s("NPCOMM02" || hand || seat || secret)',
  },
  {
    label: "Assign",
    title: "Secret and nonce select one catalog rule.",
    copy: "The browser learns the objective. Other players see only that a challenge exists.",
    code: 'index = BLAKE2s("NPSELE02" || hand || seat || nonce || secret)[0] & 7',
  },
  {
    label: "Prove",
    title: "The player chooses when to generate a proof.",
    copy: "Mode 0 becomes available after assignment. Mode 1 becomes available after a completed objective. Neither proof blocks poker actions.",
    code: "UltraHonkBackend.generateProof(witness)",
  },
  {
    label: "Verify",
    title: "Accepted proof bytes become public.",
    copy: "The server checks them before publication. Any browser can fetch the accepted bytes and verify them again.",
    code: "UltraHonkBackend.verifyProof(proof, publicInputs)",
  },
] as const;

export function ChallengeProofDemo() {
  const [step, setStep] = useState(0);
  const value = STEPS[step];

  return (
    <div className="challenge-demo">
      <div className="challenge-demo-controls">
        {STEPS.map((item, index) => (
          <button
            data-active={step === index}
            key={item.label}
            onClick={() => setStep(index)}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="challenge-demo-stage" data-step={step}>
        <div className="challenge-demo-cards" aria-hidden="true">
          <span className="challenge-demo-secret">SECRET</span>
          <span className="challenge-demo-hole">A♠</span>
          <span className="challenge-demo-proof">ZK</span>
        </div>
        <div className="challenge-demo-copy">
          <strong>{value.title}</strong>
          <p>{value.copy}</p>
          <code>{value.code}</code>
        </div>
      </div>
    </div>
  );
}
