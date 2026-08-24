"use client";

import { useEffect, useState } from "react";

const TOUR_VERSION = 3;

const STEPS = [
  {
    target: "deck",
    title: "The last hand has a deck proof",
    text: "Open it to check every encrypted shuffle and the cards dealt in that hand",
  },
  {
    target: "challenge",
    title: "Each hand has a new challenge",
    text: "Your challenge stays private while the hand plays",
  },
  {
    target: "challenge-proofs",
    title: "Challenge proofs publish here",
    text: "The draw proof checks the challenge choice and the completion proof checks the finished hand",
  },
  {
    target: "leaderboard",
    title: "Challenge wins set the final bonus",
    text: "Each completed challenge adds one win. First place gets the full buy in then each lower rank gets sixteen percent less",
  },
] as const;

function storageKey(room: string, seat: number) {
  return `noir-poker-proof-tour-${TOUR_VERSION}-${room}-${seat}`;
}

export function ProofTour({ room, seat, handNo }: {
  room: string;
  seat: number;
  handNo: number;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (handNo !== 1) return;

    try {
      if (localStorage.getItem(storageKey(room, seat)) === "complete") return;
    } catch {}

    const timer = window.setTimeout(() => setOpen(true), 0);
    return () => window.clearTimeout(timer);
  }, [handNo, room, seat]);

  useEffect(() => {
    if (!open || handNo !== 1) return;
    const target = document.querySelector<HTMLElement>(
      `[data-proof-tour="${STEPS[step].target}"]`,
    );
    if (!target) return;

    target.dataset.proofFocus = "true";
    const frame = window.requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    });

    return () => {
      window.cancelAnimationFrame(frame);
      delete target.dataset.proofFocus;
    };
  }, [handNo, open, step]);

  function advance() {
    if (step < STEPS.length - 1) {
      setStep((value) => value + 1);
      return;
    }

    try {
      localStorage.setItem(storageKey(room, seat), "complete");
    } catch {}
    setOpen(false);
  }

  if (!open || handNo !== 1) return null;
  const current = STEPS[step];

  return (
    <section className="proof-tour-note" aria-labelledby="proof-tour-title">
      <span>Step {step + 1} of {STEPS.length}</span>
      <div>
        <h2 id="proof-tour-title">{current.title}</h2>
        <p>{current.text}</p>
      </div>
      <button type="button" onClick={advance}>
        {step === STEPS.length - 1 ? "Okay" : "Next"}
      </button>
    </section>
  );
}
