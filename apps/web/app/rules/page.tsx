import Link from "next/link";

import { SiteHeader } from "@/components/site-header";

const WSOP_RULES = "https://assets.wsopcdn.com/wsop/853ee602-e1e9-4019-a0cf-381419d805c6.pdf";

const CHALLENGES = [
  { title: "See the flop", kind: "flop" },
  { title: "Raise before the flop", kind: "raise" },
  { title: "Reach showdown", kind: "showdown" },
  { title: "Bluff and win with seven-deuce", kind: "seven-two" },
] as const;

const CHALLENGE_RULES = [
  {
    title: "A challenge is dealt between hands",
    body: "Every active player receives one random challenge for the next hand. The selection uses randomness from the player and server.",
    kind: "draw",
  },
  {
    title: "The challenge stays private",
    body: "Only that player’s browser learns the challenge. The server and other players do not need the objective or the player’s hole cards while the hand is being played.",
    kind: "private",
  },
  {
    title: "The browser proves completion",
    body: "After the hand, the browser checks whether the private condition was met. If it was, the browser generates a Noir proof for the same hidden challenge.",
    kind: "proof",
  },
  {
    title: "The proof is accepted once",
    body: "The server verifies the UltraHonk proof before awarding 20 proof points. A nullifier prevents the same challenge from being claimed twice.",
    kind: "once",
  },
] as const;

function ChallengeVisual({ kind }: { kind: (typeof CHALLENGES)[number]["kind"] }) {
  if (kind === "flop") {
    return (
      <div className="example-flop-clean" aria-hidden="true">
        <span>2♣</span><span>8♥</span><span>K♠</span>
      </div>
    );
  }

  if (kind === "raise") {
    return (
      <div className="example-raise-clean" aria-hidden="true">
        <div className="raise-chip-stack"><i /><i /><i /></div>
        <b>raise</b>
      </div>
    );
  }

  if (kind === "showdown") {
    return (
      <div className="example-showdown-clean" aria-hidden="true">
        <div><span>A♠</span><span>Q♦</span></div>
        <b>showdown</b>
      </div>
    );
  }

  return (
    <div className="example-seven-two-clean" aria-hidden="true">
      <div><span>7♠</span><span>2♥</span></div>
      <b>bluff</b>
    </div>
  );
}

function RuleVisual({ kind }: { kind: (typeof CHALLENGE_RULES)[number]["kind"] }) {
  if (kind === "draw") {
    return (
      <div className="rule-symbol rule-symbol-draw-clean" aria-hidden="true">
        <span>?</span>
      </div>
    );
  }

  if (kind === "private") {
    return (
      <div className="rule-symbol rule-symbol-private-clean" aria-hidden="true">
        <span>?</span>
        <b>private</b>
      </div>
    );
  }

  if (kind === "proof") {
    return (
      <div className="rule-symbol rule-symbol-proof-clean" aria-hidden="true">
        <span className="rule-hidden-challenge">?</span>
        <span className="rule-proof-check">✓</span>
      </div>
    );
  }

  return (
    <div className="rule-symbol rule-symbol-once-clean" aria-hidden="true">
      <span className="rule-first-claim">✓</span>
      <span className="rule-second-claim">×</span>
    </div>
  );
}

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
          <p>Examples of the private goals a player can be asked to complete.</p>
        </div>
        <div className="challenge-example-grid challenge-example-grid-clean">
          {CHALLENGES.map((challenge) => (
            <article key={challenge.title}>
              <ChallengeVisual kind={challenge.kind} />
              <strong>{challenge.title}</strong>
            </article>
          ))}
        </div>
      </section>

      <section className="rules-list" aria-label="Private challenge rules">
        {CHALLENGE_RULES.map((rule) => (
          <article className="rule-row rule-row-clean" key={rule.title}>
            <div className="rule-copy">
              <h2>{rule.title}</h2>
              <p>{rule.body}</p>
            </div>
            <RuleVisual kind={rule.kind} />
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
