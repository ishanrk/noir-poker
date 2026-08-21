import type { CSSProperties } from "react";

const PIECES = [
  {
    title: "Rust engine",
    detail: "Settles the hand and records the public facts.",
    meta: "game-core",
  },
  {
    title: "Player browser",
    detail: "Keeps the challenge secret and builds the private witness.",
    meta: "private input",
  },
  {
    title: "NoirJS",
    detail: "Executes challenge_v2 and produces the witness data.",
    meta: "circuit",
  },
  {
    title: "Barretenberg",
    detail: "Generates an UltraHonk proof in a browser worker.",
    meta: "proof",
  },
  {
    title: "Public verifier",
    detail: "Checks the accepted bytes without learning the hidden values.",
    meta: "verify",
  },
] as const;

export function ProofPuzzle() {
  return (
    <ol className="proof-puzzle" aria-label="Challenge proof stack">
      {PIECES.map((piece, index) => (
        <li key={piece.title} style={{ "--piece": index } as CSSProperties}>
          <span>{String(index + 1).padStart(2, "0")}</span>
          <strong>{piece.title}</strong>
          <p>{piece.detail}</p>
          <code>{piece.meta}</code>
        </li>
      ))}
    </ol>
  );
}
