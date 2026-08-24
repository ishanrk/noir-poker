"use client";

import { useEffect, useState } from "react";

const TOUR_VERSION = 2;

const STEPS = [
  {
    title: "Open the previous hand deck proof",
    text: "The deck proof above the table checks the encrypted shuffles and the final card order for the previous hand",
  },
  {
    title: "Open a challenge draw proof",
    text: "A published draw entry below the table checks that the player received one challenge from the fixed list",
  },
  {
    title: "Open a completion proof",
    text: "A published completion entry checks that the hidden challenge matched the recorded hand actions",
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
        {step === STEPS.length - 1 ? "Close" : "Next"}
      </button>
    </section>
  );
}
