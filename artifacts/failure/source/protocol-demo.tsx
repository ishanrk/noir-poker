"use client";

import { useMemo, useState } from "react";

import { cardValue, dealCommitment, dealLayout, dealSeed, encodeHex, shuffleDeck } from "@/lib/deal";

const ROOM = "00112233-4455-6677-8899-aabbccddeeff";
const SECRET = new Uint8Array(32).fill(0x11);
const SHARES = [0x22, 0x33, 0x44].map((byte) => new Uint8Array(32).fill(byte));

export function ProtocolDemo() {
  const [step, setStep] = useState(0);
  const values = useMemo(() => {
    const commitment = dealCommitment(ROOM, BigInt(7), SECRET);
    const seed = dealSeed(ROOM, BigInt(7), SECRET, SHARES);
    const deck = shuffleDeck(seed);
    return { commitment, seed, deck, layout: dealLayout(deck, 3, 1) };
  }, []);
  const labels = ["Commit server secret", "Add three ordered shares", "Shuffle all 52 positions", "Deal seats, burns and board"];

  return (
    <div className="protocol-demo">
      <div className="demo-controls">
        {labels.map((label, index) => (
          <button key={label} type="button" data-active={step === index} onClick={() => setStep(index)}>
            <span>0{index + 1}</span>{label}
          </button>
        ))}
      </div>
      <div className="demo-stage" data-step={step}>
        <div className="demo-stack">{Array.from({ length: 6 }, (_, index) => <i key={index} />)}</div>
        <div className="demo-output">
          <span>{labels[step]}</span>
          <code>
            {step === 0 && `${encodeHex(values.commitment).slice(0, 32)}…`}
            {step === 1 && "seat 0 · seat 1 · seat 2"}
            {step === 2 && values.deck.slice(0, 12).map(cardValue).join("  ")}
            {step === 3 && values.layout.board.map(cardValue).join("  ")}
          </code>
          <p>
            {step === 0 && "The commitment is published before the final joining player reveals entropy."}
            {step === 1 && "Seat indices are encoded, so reordering the same shares changes the seed."}
            {step === 2 && "SHA-256 counter blocks feed rejection sampling, then Fisher–Yates."}
            {step === 3 && "The engine and public verifier consume the same canonical positions."}
          </p>
        </div>
      </div>
    </div>
  );
}
