"use client";

import { useState } from "react";

const STEPS = [
  {
    label: "Commit",
    title: "The browser commits to a private secret.",
    copy: "The server sees only a BLAKE2s commitment. After storing it, the server returns fresh public randomness.",
    code: "commitment = BLAKE2s(hand, seat, secret)",
  },
  {
    label: "Assign",
    title: "Secret plus server randomness selects one challenge.",
    copy: "The Noir circuit proves the hidden challenge is one of the eight fixed catalog definitions without revealing which definition was selected.",
    code: "index = BLAKE2s(hand, seat, nonce, secret)[0] & 7",
  },
  {
    label: "Complete",
    title: "The same hidden challenge is checked against the hand.",
    copy: "The circuit receives six private hand facts and proves that every required condition of the hidden challenge is satisfied.",
    code: "objective_met(hidden challenge, private facts) = true",
  },
  {
    label: "Verify",
    title: "Anyone can verify both UltraHonk proofs.",
    copy: "The receipt contains public bindings and proof bytes. The challenge definition, browser secret and private fact vector are not disclosed.",
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
          <span className="challenge-demo-secret">?</span>
          <span className="challenge-demo-hole">A♠</span>
          <span className="challenge-demo-proof">✓</span>
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
