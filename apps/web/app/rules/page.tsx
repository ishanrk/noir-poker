import Link from "next/link";

import { SiteHeader } from "@/components/site-header";

const WSOP_RULES = "https://assets.wsopcdn.com/wsop/853ee602-e1e9-4019-a0cf-381419d805c6.pdf";

const CHALLENGE_RULES = [
  {
    title: "Random assignment",
    body: "Between hands, every active player receives one challenge for the next hand. The challenge is selected from the fixed challenge catalog using randomness from the player and server.",
    cards: ["?", "?", "A♥"],
  },
  {
    title: "Private during play",
    body: "Only the player’s browser learns the challenge. Other players do not see it, and the player does not need to reveal hole cards to keep the challenge active.",
    cards: ["7♣", "?", "K♠"],
  },
  {
    title: "Proof after the hand",
    body: "If the condition is met, the browser generates a Noir proof. Anyone can verify that the private challenge was valid and completed without learning the objective or the player’s hole cards.",
    cards: ["?", "✓", "?"],
  },
  {
    title: "One claim",
    body: "A completed challenge awards proof points once. The public receipt can be checked again later without opening the challenge.",
    cards: ["?", "20", "✓"],
  },
] as const;

export default function RulesPage() {
  return (
    <main className="site-shell rules-page">
      <SiteHeader compact />

      <header className="rules-hero">
        <h1>Rules</h1>
        <p>Noir Poker uses ordinary no-limit Texas Hold&apos;em plus one private challenge between hands.</p>
        <a className="rules-poker-link" href={WSOP_RULES} target="_blank" rel="noreferrer">
          Texas Hold&apos;em rules from WSOP ↗
        </a>
      </header>

      <section className="rules-list" aria-label="Private challenge rules">
        {CHALLENGE_RULES.map((rule, index) => (
          <article className={`rule-row rule-row-${index + 1}`} key={rule.title}>
            <div className="rule-copy">
              <h2>{rule.title}</h2>
              <p>{rule.body}</p>
            </div>
            <div className="rule-visual" aria-hidden="true">
              <span className={`rule-card rule-card-one${rule.cards[0] === "?" ? " rule-card-sealed" : ""}`}>
                {rule.cards[0]}
              </span>
              <span className={`rule-card rule-card-two${rule.cards[1] === "?" ? " rule-card-sealed" : ""}`}>
                {rule.cards[1]}
              </span>
              <span className={`rule-card rule-card-three${rule.cards[2] === "?" ? " rule-card-sealed" : ""}`}>
                {rule.cards[2]}
              </span>
            </div>
          </article>
        ))}
      </section>

      <footer className="rules-links">
        <Link href="/motivation">Motivation</Link>
        <Link href="/protocol">Cryptographic protocol</Link>
      </footer>
    </main>
  );
}
