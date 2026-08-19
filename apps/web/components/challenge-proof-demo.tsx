"use client";

import { useState } from "react";

const STEPS = [
  {
    label: "Hidden challenge",
    title: "Reach showdown",
    copy: "Only the player browser sees the selected challenge.",
  },
  {
    label: "Hand completes",
    title: "Private evidence stays private",
    copy: "The browser checks the hand facts needed by the hidden challenge.",
  },
  {
    label: "Public proof",
    title: "Verified without opening it",
    copy: "Anyone can verify the proof receipt. The challenge and hole cards stay hidden.",
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
        <div>
          <strong>{value.title}</strong>
          <p>{value.copy}</p>
        </div>
      </div>
    </div>
  );
}
