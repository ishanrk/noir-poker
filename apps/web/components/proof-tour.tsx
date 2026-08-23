"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

const TOUR_VERSION = 1;

const STEPS = [
  {
    target: "deck",
    title: "Deck proof",
    text: "This opens the prior hand transcript. The verifier checks every key every encrypted shuffle every reveal and the final deck.",
  },
  {
    target: "challenge-draw",
    title: "Challenge draw proof",
    text: "This proves the browser secret was fixed before the server nonce selected one challenge from the fixed catalog. Select a published cell to inspect the accepted proof.",
  },
  {
    target: "challenge-completion",
    title: "Completion proof",
    text: "A completed cell opens the proof that the hidden challenge matched the committed hand facts. A missed cell means no completion proof exists.",
  },
] as const;

type FocusBox = {
  top: number;
  left: number;
  width: number;
  height: number;
};

function storageKey(room: string, seat: number) {
  return `noir-poker-proof-tour-${TOUR_VERSION}-${room}-${seat}`;
}

export function ProofTour({ room, seat, handNo, onOpenChange }: {
  room: string;
  seat: number;
  handNo: number;
  onOpenChange: (state: { handNo: number; open: boolean }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [focus, setFocus] = useState<FocusBox>();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const current = STEPS[step];

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (handNo !== 1) {
        setOpen(false);
        onOpenChange({ handNo, open: false });
        return;
      }

      try {
        if (localStorage.getItem(storageKey(room, seat)) === "complete") {
          onOpenChange({ handNo, open: false });
          return;
        }
      } catch {}

      setStep(0);
      setOpen(true);
      onOpenChange({ handNo, open: true });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [handNo, onOpenChange, room, seat]);

  const placeFocus = useCallback(() => {
    const target = document.querySelector<HTMLElement>(
      `[data-proof-tour="${current.target}"]`,
    );
    if (!target) {
      setFocus(undefined);
      return;
    }

    const rect = target.getBoundingClientRect();
    const inset = 8;
    const width = Math.min(window.innerWidth - inset * 2, rect.width + inset * 2);
    const height = Math.min(window.innerHeight - inset * 2, rect.height + inset * 2);
    setFocus({
      top: Math.min(window.innerHeight - height - inset, Math.max(inset, rect.top - inset)),
      left: Math.min(window.innerWidth - width - inset, Math.max(inset, rect.left - inset)),
      width,
      height,
    });
  }, [current.target]);

  useEffect(() => {
    if (!open) return;
    const target = document.querySelector<HTMLElement>(
      `[data-proof-tour="${current.target}"]`,
    );
    target?.scrollIntoView({ block: "center", behavior: "smooth" });

    const initial = window.requestAnimationFrame(placeFocus);
    const settle = window.setTimeout(placeFocus, 260);
    const retry = window.setInterval(placeFocus, 500);
    const observer = new ResizeObserver(placeFocus);
    observer.observe(document.documentElement);
    window.addEventListener("scroll", placeFocus, true);
    window.addEventListener("resize", placeFocus);
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      event.preventDefault();
      buttonRef.current?.focus();
    };
    document.addEventListener("keydown", trap);
    buttonRef.current?.focus();

    return () => {
      window.cancelAnimationFrame(initial);
      window.clearTimeout(settle);
      window.clearInterval(retry);
      observer.disconnect();
      window.removeEventListener("scroll", placeFocus, true);
      window.removeEventListener("resize", placeFocus);
      document.removeEventListener("keydown", trap);
    };
  }, [current.target, open, placeFocus]);

  function advance() {
    if (step < STEPS.length - 1) {
      setStep((value) => value + 1);
      return;
    }

    try {
      localStorage.setItem(storageKey(room, seat), "complete");
    } catch {}
    setOpen(false);
    onOpenChange({ handNo, open: false });
  }

  if (!open) return null;

  const style = focus ? {
    "--proof-tour-top": `${focus.top}px`,
    "--proof-tour-left": `${focus.left}px`,
    "--proof-tour-width": `${focus.width}px`,
    "--proof-tour-height": `${focus.height}px`,
  } as CSSProperties : undefined;

  return (
    <>
      <div className="proof-tour-layer" aria-hidden="true" />
      {focus && <div className="proof-tour-focus" style={style} aria-hidden="true" />}
      <section
        className="proof-tour-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="proof-tour-title"
        aria-describedby="proof-tour-copy"
      >
        <span>{step + 1} / {STEPS.length}</span>
        <h2 id="proof-tour-title">{current.title}</h2>
        <p id="proof-tour-copy">{current.text}</p>
        <button ref={buttonRef} type="button" onClick={advance}>
          {step === STEPS.length - 1 ? "Okay Start Hand 2" : "Okay"}
        </button>
      </section>
    </>
  );
}
