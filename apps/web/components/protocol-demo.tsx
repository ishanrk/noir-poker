"use client";

import { useMemo, useState } from "react";

import { cardValue, dealCommitment, dealLayout, dealSeed, encodeHex, shuffleDeck } from "@/lib/deal";

const ROOM = "00112233-4455-6677-8899-aabbccddeeff";
const SECRET = new Uint8Array(32).fill(0x11);
const SHARES = [0x22, 0x33, 0x44].map((byte) => new Uint8Array(32).fill(byte));

const STEPS = [
  {
    label: "Server commitment",
    title: "The server fixes its random value first.",
    copy: "A 32 byte server secret is committed before any player random value is accepted.",
  },
  {
    label: "Player randomness",
    title: "Each occupied seat contributes 32 random bytes.",
    copy: "The values are bound to seat order and mixed with the already committed server secret.",
  },
  {
    label: "Shuffle",
    title: "One seed determines one 52 card permutation.",
    copy: "SHA 256 counter output feeds rejection sampling and Fisher Yates, so the same seed always replays the same deck.",
  },
  {
    label: "Deal map",
    title: "Poker consumes fixed positions from that permutation.",
    copy: "Two hole card rounds are followed by burn, flop, burn, turn, burn and river positions.",
  },
] as const;

export function ProtocolDemo() {
  const [step, setStep] = useState(0);
  const values = useMemo(() => {
    const commitment = dealCommitment(ROOM, BigInt(7), SECRET);
    const seed = dealSeed(ROOM, BigInt(7), SECRET, SHARES);
    const deck = shuffleDeck(seed);
    return { commitment, seed, deck, layout: dealLayout(deck, 3, 1) };
  }, []);
  const current = STEPS[step];

  return (
    <div className="protocol-demo">
      <div className="demo-controls">
        {STEPS.map((item, index) => (
          <button
            key={item.label}
            type="button"
            data-active={step === index}
            onClick={() => setStep(index)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="demo-stage" data-step={step}>
        <div className="demo-stack">{Array.from({ length: 6 }, (_, index) => <i key={index} />)}</div>
        <div className="demo-output">
          <strong>{current.title}</strong>
          <p>{current.copy}</p>
          <code>
            {step === 0 && `commitment ${encodeHex(values.commitment).slice(0, 24)}…`}
            {step === 1 && `seed ${encodeHex(values.seed).slice(0, 24)}…`}
            {step === 2 && values.deck.slice(0, 10).map(cardValue).join("  ")}
            {step === 3 && `board ${values.layout.board.map(cardValue).join("  ")}`}
          </code>
        </div>
      </div>
    </div>
  );
}
