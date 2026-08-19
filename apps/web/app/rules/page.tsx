import Link from "next/link";

import { SiteHeader } from "@/components/site-header";

const RULES = [
  {
    title: "Table setup",
    body: "Two to six players use play chips. Each hand is standard no-limit Texas Hold’em with a small blind and big blind.",
    cards: ["2♣", "6♦", "A♠"],
  },
  {
    title: "Before the deal",
    body: "The server commits to its shuffle secret before player randomness arrives. Every occupied seat contributes fresh entropy before cards are dealt.",
    cards: ["?", "?", "A♥"],
  },
  {
    title: "Betting",
    body: "Players may fold, check, call or raise when the action is legal. Raises are limited by the exact no-limit minimum and the player’s remaining stack.",
    cards: ["10♠", "J♠", "Q♠"],
  },
  {
    title: "Board and showdown",
    body: "Each player receives two hole cards. The board is dealt as flop, turn and river. At showdown, the best five-card hand wins each pot under normal Texas Hold’em rankings.",
    cards: ["K♥", "K♣", "7♦"],
  },
  {
    title: "Private challenge",
    body: "Between hands, each active player receives one private challenge for the next hand. The challenge is selected from the fixed challenge catalog and stays hidden from the server and the other players.",
    cards: ["?", "7♣", "?"],
  },
  {
    title: "Challenge proof",
    body: "If the challenge condition is met, the player’s browser generates a Noir proof. A valid proof awards proof points without revealing the challenge or the private witness used to satisfy it. Each challenge can be claimed once.",
    cards: ["?", "✓", "20"],
  },
] as const;

export default function RulesPage() {
  return (
    <main className="site-shell rules-page">
      <SiteHeader compact />

      <header className="rules-hero">
        <h1>Rules</h1>
        <p>Normal no-limit Texas Hold’em with one private challenge per player between hands.</p>
      </header>

      <section className="rules-list" aria-label="Game rules">
        {RULES.map((rule, index) => (
          <article className={`rule-row rule-row-${index + 1}`} key={rule.title}>
            <span className="rule-number">{String(index + 1).padStart(2, "0")}</span>
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
