"use client";

import { useState, type CSSProperties, type ReactNode } from "react";

export type ProofGuideStep = {
  title: string;
  text: string;
  detail?: ReactNode;
  result?: ReactNode;
  source?: ReactNode;
};

export function ProofGuide({
  label,
  title,
  intro,
  actions,
  steps,
}: {
  label: string;
  title: string;
  intro: string;
  actions?: ReactNode;
  steps: readonly ProofGuideStep[];
}) {
  const [currentStep, setCurrentStep] = useState(0);
  const current = steps[currentStep];

  return (
    <section
      className="proof-guide"
      aria-label={title}
      style={{ "--proof-step-count": steps.length } as CSSProperties}
    >
      <header className="proof-guide-head">
        <p>{label}</p>
        <h2>{title}</h2>
        <span>{intro}</span>
      </header>

      {actions && <div className="proof-guide-actions" aria-label="Proof actions">{actions}</div>}

      <nav className="proof-guide-path" aria-label={`${title} steps`}>
        {steps.map((step, index) => (
          <button
            type="button"
            key={step.title}
            data-current={index === currentStep}
            aria-current={index === currentStep ? "step" : undefined}
            aria-label={`Step ${index + 1} ${step.title}`}
            onClick={() => setCurrentStep(index)}
          >
            {String(index + 1).padStart(2, "0")}
          </button>
        ))}
      </nav>

      <article className="proof-guide-step" key={current.title}>
        <span>STEP {String(currentStep + 1).padStart(2, "0")}</span>
        <h2>{current.title}</h2>
        <p>{current.text}</p>
        {current.detail && <div className="proof-guide-detail">{current.detail}</div>}
        {current.result && <strong className="proof-guide-result">{current.result}</strong>}
        {current.source && <div className="proof-guide-source">{current.source}</div>}
      </article>

      <div className="proof-guide-controls">
        <button
          type="button"
          disabled={currentStep === 0}
          onClick={() => setCurrentStep((value) => value - 1)}
        >
          Previous
        </button>
        <output>{currentStep + 1} / {steps.length}</output>
        <button
          type="button"
          disabled={currentStep === steps.length - 1}
          onClick={() => setCurrentStep((value) => value + 1)}
        >
          Next Step
        </button>
      </div>
    </section>
  );
}
