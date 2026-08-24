"use client";

import { useEffect, useState } from "react";

const TOUR_VERSION = 4;

const STEPS = [
  {
    target: "deck",
    title: "Deck proof from the last hand",
    text: "Every hand uses a new encrypted deck. After the hand ends this link opens the accepted shuffle proofs and the final card openings",
  },
  {
    target: "challenge",
    title: "A new challenge for every hand",
    text: "Your browser draws one private challenge from the fixed catalog. Other players only see its public proof after the hand finishes",
  },
  {
    target: "challenge-proofs",
    title: "Challenge proof history",
    text: "Draw checks that the challenge was selected fairly. Completion checks that the recorded hand met it. Missed means no completion proof was created",
  },
  {
    target: "leaderboard",
    title: "Leaderboard score and final bonus",
    text: "A completed challenge adds one point. Consecutive folded hands remove 0.1 then 0.2 then 0.4 points and keep doubling while the score stays at least zero. Final rank adds bonus chips based on the buy in. First receives 100 percent then each lower rank receives 16 percentage points less",
  },
] as const;

function storageKey(room: string, seat: number) {
  return `noir-poker-proof-tour-${TOUR_VERSION}-${room}-${seat}`;
}

export function ProofTour({ room, seat, handNo, onOpenChange }: {
  room: string;
  seat: number;
  handNo: number;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (handNo !== 1) return;

    try {
      if (localStorage.getItem(storageKey(room, seat)) === "complete") return;
    } catch {}

    onOpenChange?.(true);
    const timer = window.setTimeout(() => setOpen(true), 0);
    return () => {
      window.clearTimeout(timer);
      onOpenChange?.(false);
    };
  }, [handNo, onOpenChange, room, seat]);

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
    onOpenChange?.(false);
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
