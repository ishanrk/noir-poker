import Link from "next/link";

import { SiteHeader } from "@/components/site-header";

const ULTIMATE_BET =
  "https://www.pokernews.com/news/2022/11/ultimate-bet-scandal-42623.htm";
const FULL_TILT =
  "https://www.justice.gov/usao-sdny/pr/former-full-tilt-poker-ceo-pleads-guilty-and-sentenced-manhattan-federal-court";
const RANDOMNESS =
  "https://developer.mozilla.org/en-US/docs/Web/API/Crypto/getRandomValues";

const TRUST_STEPS = [
  {
    number: "01",
    title: "Commit first",
    copy: "The server publishes a commitment to its secret before any player entropy is accepted.",
  },
  {
    number: "02",
    title: "Mix every seat",
    copy: "Each occupied browser contributes fresh random bytes. Seat order is part of the seed.",
  },
  {
    number: "03",
    title: "Replay the deal",
    copy: "After settlement, the revealed values reproduce the seed, shuffle and every dealt position.",
  },
] as const;

export default function MotivationPage() {
  return (
    <main className="site-shell story-page story-motivation">
      <SiteHeader compact />

      <header className="story-hero story-hero-motivation">
        <div>
          <p className="story-kicker">Motivation</p>
          <h1>The shuffle happens somewhere else.</h1>
          <p>
            At a physical table, the deal is visible. Online, a server chooses the state and sends each
            player a private view. Players need evidence that survives outside that server.
          </p>
        </div>
        <div className="trust-meter" aria-label="Trust moves from claim to evidence">
          <span>operator claim</span>
          <i aria-hidden="true" />
          <strong>public evidence</strong>
        </div>
      </header>

      <section className="story-section" aria-labelledby="failures-title">
        <header className="story-section-head">
          <p className="story-index">01</p>
          <div>
            <h2 id="failures-title">Two failures with the same blind spot</h2>
            <p>Players saw account screens. The decisive facts stayed inside the operator.</p>
          </div>
        </header>

        <div className="case-grid">
          <article className="case-card">
            <div className="case-mark" aria-hidden="true">
              <span>A♠</span>
              <span>?</span>
            </div>
            <p className="case-label">Hidden access</p>
            <h3>UltimateBet and Absolute Poker</h3>
            <p>
              Insider tools exposed opponents&apos; hole cards during live play. The player interface
              could not show who had privileged access behind it.
            </p>
            <a href={ULTIMATE_BET} target="_blank" rel="noreferrer">
              Read the investigation
            </a>
          </article>

          <article className="case-card">
            <div className="case-mark case-mark-ledger" aria-hidden="true">
              <span>$390m</span>
              <span>$60m</span>
            </div>
            <p className="case-label">Hidden balance sheet</p>
            <h3>Full Tilt Poker</h3>
            <p>
              Internal records showed roughly $390 million owed to players and about $60 million in
              bank accounts shortly before the 2011 enforcement action.
            </p>
            <a href={FULL_TILT} target="_blank" rel="noreferrer">
              Read the court release
            </a>
          </article>
        </div>
      </section>

      <section className="story-section" aria-labelledby="deal-evidence-title">
        <header className="story-section-head">
          <p className="story-index">02</p>
          <div>
            <h2 id="deal-evidence-title">The completed deck leaves a transcript</h2>
            <p>The final shuffle is fixed by values from the server and every occupied seat.</p>
          </div>
        </header>

        <ol className="trust-flow">
          {TRUST_STEPS.map((step) => (
            <li key={step.number}>
              <span>{step.number}</span>
              <div>
                <strong>{step.title}</strong>
                <p>{step.copy}</p>
              </div>
            </li>
          ))}
        </ol>

        <p className="story-note">
          Browsers use <code>crypto.getRandomValues</code> for their contributions. The same public
          transcript can be checked in the audit page or with the standalone verifier.{" "}
          <a href={RANDOMNESS} target="_blank" rel="noreferrer">
            Browser randomness reference
          </a>
        </p>
      </section>

      <section className="story-section story-private" aria-labelledby="private-title">
        <header className="story-section-head">
          <p className="story-index">03</p>
          <div>
            <h2 id="private-title">A private challenge can still produce public evidence</h2>
            <p>The objective stays in one browser. A proof can show that its rules were satisfied.</p>
          </div>
        </header>

        <div className="privacy-split">
          <article>
            <span>Kept private</span>
            <strong>Objective, secret, Merkle path and hand facts</strong>
          </article>
          <article>
            <span>Published</span>
            <strong>Room binding, proof bytes, public inputs and one-time claim id</strong>
          </article>
        </div>

        <p>
          A fair-draw proof is optional. A completion proof is only needed when a player claims the 20
          proof points. Anyone can verify an accepted proof in their own browser.
        </p>
      </section>

      <section className="story-section story-limits" aria-labelledby="limits-title">
        <header className="story-section-head">
          <p className="story-index">04</p>
          <div>
            <h2 id="limits-title">Current limits</h2>
            <p>These boundaries matter when reading the claims above.</p>
          </div>
        </header>
        <ul>
          <li>The server sees the cards while a hand is live.</li>
          <li>The server can stop serving a room before settlement.</li>
          <li>Challenge completion currently uses six facts committed by the server.</li>
          <li>The audit covers a completed deal. It is not a mental-poker protocol.</li>
        </ul>
        <Link className="story-link" href="/protocol">
          Read the exact protocol
        </Link>
      </section>
    </main>
  );
}
