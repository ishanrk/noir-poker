import Link from "next/link";

import { SiteHeader } from "@/components/site-header";

const WSOP_RULES = "https://assets.wsopcdn.com/wsop/853ee602-e1e9-4019-a0cf-381419d805c6.pdf";

const CHALLENGES = [
  { title: "See the flop", cards: ["?", "2♣", "8♥"] },
  { title: "Raise before the flop", cards: ["?", "A♦", "5♣"] },
  { title: "Reach showdown", cards: ["?", "K♠", "K♥"] },
  { title: "Finish the hand ahead", cards: ["?", "7♠", "Q♦"] },
] as const;

const CHALLENGE_RULES = [
  {
    title: "A challenge is dealt between hands",
    body: "Every active player receives one random challenge for the next hand. The selection comes from the fixed eight challenge catalog using randomness from the player and server.",
    cards: ["?", "?", "A♥"],
  },
  {
    title: "The challenge stays private",
    body: "Only that player’s browser learns the challenge. The server and other players do not need the objective or the player’s hole cards while the hand is being played.",
    cards: ["7♣", "?", "K♠"],
  },
  {
    title: "The browser proves completion",
    body: "After the hand, the browser checks whether the private condition was met. If it was, the browser generates a Noir proof for the same hidden challenge.",
    cards: ["?", "✓", "?"],
  },
  {
    title: "The proof is accepted once",
    body: "The server verifies the UltraHonk proof before awarding 20 proof points. A nullifier prevents the same challenge from being claimed twice.",
    cards: ["?", "20", "✓"],
  },
] as const;

export default function RulesPage() {
  return (
    <main className="site-shell rules-page">
      <SiteHeader compact />

      <header className="rules-hero">
        <h1>Rules</h1>
        <p>Noir Poker is normal no-limit Texas Hold&apos;em plus one private challenge between hands.</p>
        <a className="rules-poker-link" href={WSOP_RULES} target="_blank" rel="noreferrer">
          Texas Hold&apos;em rules from WSOP ↗
        </a>
      </header>

      <section className="challenge-examples" aria-labelledby="challenge-examples-title">
        <div>
          <h2 id="challenge-examples-title">Challenge examples</h2>
          <p>These are real entries from the fixed challenge catalog used by the circuit.</p>
        </div>
        <div className="challenge-example-grid">
          {CHALLENGES.map((challenge) => (
            <article key={challenge.title}>
              <div className="challenge-example-cards" aria-hidden="true">
                {challenge.cards.map((card, index) => (
                  <span className={card === "?" ? "challenge-example-sealed" : ""} key={`${card}-${index}`}>
                    {card}
                  </span>
                ))}
              </div>
              <strong>{challenge.title}</strong>
            </article>
          ))}
        </div>
      </section>

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

      <section className="challenge-proof-help" aria-labelledby="challenge-proof-help-title">
        <div>
          <h2 id="challenge-proof-help-title">Checking another player&apos;s proof</h2>
          <p>
            Every accepted challenge has a public receipt at <code>/proof/&lt;nullifier&gt;</code>. Open
            that link and the browser verifies both UltraHonk proofs locally. The challenge and hole
            cards are not revealed.
          </p>
        </div>
        <div>
          <h3>Download</h3>
          <p>Use <strong>Export JSON</strong> on the receipt page to save the proof receipt.</p>
          <h3>Verify from the repository</h3>
          <code>npm --prefix apps/web run proof:verify -- receipt.json</code>
        </div>
      </section>

      <footer className="rules-links">
        <Link href="/motivation">Motivation</Link>
        <Link href="/protocol">Cryptographic protocol</Link>
      </footer>
    </main>
  );
}
