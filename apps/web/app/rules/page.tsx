import Link from "next/link";

import { SiteHeader } from "@/components/site-header";

const WSOP_RULES = "https://assets.wsopcdn.com/wsop/853ee602-e1e9-4019-a0cf-381419d805c6.pdf";

const CHALLENGES = [
  { title: "See the flop", kind: "flop" },
  { title: "Raise before the flop", kind: "raise" },
  { title: "Reach showdown", kind: "showdown" },
  { title: "Bluff and win with seven-deuce", kind: "seven-two" },
] as const;

function ChallengeVisual({ kind }: { kind: (typeof CHALLENGES)[number]["kind"] }) {
  if (kind === "flop") {
    return (
      <div className="challenge-example-flop" aria-hidden="true">
        <span>2♣</span><span>8♥</span><span>K♠</span>
      </div>
    );
  }

  if (kind === "raise") {
    return (
      <div className="challenge-example-raise" aria-hidden="true">
        <div className="raise-stack raise-stack-before"><i /><i /><i /></div>
        <span>preflop raise</span>
        <div className="raise-stack raise-stack-after"><i /><i /><i /><i /><i /></div>
      </div>
    );
  }

  if (kind === "showdown") {
    return (
      <div className="challenge-example-showdown" aria-hidden="true">
        <div><span>A♠</span><span>Q♦</span></div>
        <b>showdown</b>
      </div>
    );
  }

  return (
    <div className="challenge-example-seven-two" aria-hidden="true">
      <div><span>7♠</span><span>2♥</span></div>
      <b>win by fold</b>
    </div>
  );
}

function ChallengePanel({ state }: { state: "assigned" | "hit" | "miss" | "verified" }) {
  if (state === "assigned") {
    return (
      <article className="challenge-ui-sample">
        <div className="challenge-ui-line"><span>Selection / next hand</span><strong>verified</strong></div>
        <div className="challenge-ui-private"><span>Only this browser knows</span><strong>Reach showdown</strong><small>20 points, ready for next hand</small></div>
      </article>
    );
  }

  if (state === "hit") {
    return (
      <article className="challenge-ui-sample">
        <div className="challenge-ui-line"><span>Completion / hand 12</span><strong>ready</strong></div>
        <p className="challenge-ui-objective">Only you see: Reach showdown</p>
        <button type="button" tabIndex={-1}>Prove completion →</button>
      </article>
    );
  }

  if (state === "miss") {
    return (
      <article className="challenge-ui-sample">
        <div className="challenge-ui-line"><span>Completion / hand 12</span><strong>missed</strong></div>
        <p>Challenge missed. No proof can be generated.</p>
        <b className="challenge-ui-zero">+0 proof points</b>
      </article>
    );
  }

  return (
    <article className="challenge-ui-sample challenge-ui-verified">
      <div className="challenge-ui-line"><span>Completion / hand 12</span><strong>verified</strong></div>
      <div className="challenge-ui-award"><strong>+20 proof points</strong><span>challenge still hidden</span><em>Open public verifier →</em></div>
    </article>
  );
}

export default function RulesPage() {
  return (
    <main className="site-shell rules-page rules-page-clear">
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
          <p>The first three are in the current circuit catalog. Seven-deuce is the card-specific challenge design.</p>
        </div>
        <div className="challenge-example-grid challenge-example-grid-clear">
          {CHALLENGES.map((challenge) => (
            <article key={challenge.title}>
              <ChallengeVisual kind={challenge.kind} />
              <strong>{challenge.title}</strong>
            </article>
          ))}
        </div>
      </section>

      <section className="challenge-ui-guide" aria-labelledby="challenge-ui-guide-title">
        <header>
          <h2 id="challenge-ui-guide-title">How one challenge works in the game</h2>
          <p>These are small versions of the states shown by the real in-game challenge panel.</p>
        </header>
        <div className="challenge-ui-grid">
          <div><h3>Dealt between hands</h3><ChallengePanel state="assigned" /></div>
          <div><h3>If you complete it</h3><ChallengePanel state="hit" /></div>
          <div><h3>If you miss it</h3><ChallengePanel state="miss" /></div>
          <div><h3>After verification</h3><ChallengePanel state="verified" /></div>
        </div>
      </section>

      <section className="proof-check-guide" aria-labelledby="proof-check-title">
        <div className="proof-receipt-sample" aria-hidden="true">
          <span>Public challenge verifier</span>
          <h3>The challenge was completed.</h3>
          <dl>
            <div><dt>Private selection proof</dt><dd>verified</dd></div>
            <div><dt>Completion proof</dt><dd>verified</dd></div>
            <div><dt>Proof points</dt><dd>+20</dd></div>
          </dl>
          <div><button type="button" tabIndex={-1}>Run again</button><button type="button" tabIndex={-1}>Export JSON</button></div>
        </div>
        <div className="proof-check-copy">
          <h2 id="proof-check-title">Checking another player&apos;s proof</h2>
          <p>
            A public receipt exists only after the server accepts that player&apos;s completion proof. Its
            page is <code>/proof/&lt;nullifier&gt;</code>, where the nullifier is the public id for that one-time claim.
          </p>
          <p>
            Share that URL. Opening it downloads the receipt and verifies both UltraHonk proofs in the
            visitor&apos;s browser. The challenge and the player&apos;s hole cards are not included in the receipt.
          </p>
          <p>
            For an independent command-line check, choose <strong>Export JSON</strong> on the receipt page,
            then run:
          </p>
          <code className="proof-check-command">npm --prefix apps/web run proof:verify -- receipt.json</code>
        </div>
      </section>

      <footer className="rules-links">
        <Link href="/motivation">Motivation</Link>
        <Link href="/protocol">Protocol</Link>
      </footer>
    </main>
  );
}
