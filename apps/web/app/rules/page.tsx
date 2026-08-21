import Link from "next/link";

import { ChallengeUiPreview } from "@/components/challenge-ui-preview";
import { SiteHeader } from "@/components/site-header";

const WSOP_RULES =
  "https://assets.wsopcdn.com/wsop/853ee602-e1e9-4019-a0cf-381419d805c6.pdf";
const BOT_PAPER =
  "https://www.cs.mun.ca/~lourdes/public/publication/billings-pss-99/";

const CHALLENGES = [
  "See the flop",
  "Raise before the flop",
  "Call before the flop",
  "Check on the flop",
  "Reach showdown",
  "Finish the hand ahead",
  "Raise before the flop and finish ahead",
  "Reach showdown, finish ahead and never raise before the flop",
] as const;

const POKER_FLOW = [
  ["Deal", "Two private cards for each active seat."],
  ["Preflop", "Action starts left of the big blind."],
  ["Flop", "Three community cards after one burn."],
  ["Turn", "A second burn, then one community card."],
  ["River", "A third burn, then the final community card."],
  ["Settle", "Fold wins immediately. Showdown compares the best five-card hands."],
] as const;

const CHALLENGE_RULES = [
  ["Draw before ready", "A human seat needs an assigned challenge before it can ready for the next hand."],
  ["Fair draw proof is optional", "Publishing the draw proof never blocks normal play."],
  ["Completion proof claims points", "Generate it only after the hand and only when the objective was met."],
  ["Verification is optional", "Any browser may verify an accepted proof. Gameplay does not wait for it."],
  ["The objective stays private", "Other players see proof status and points, not the hidden rule."],
  ["One claim per challenge", "A public nullifier prevents the same completion proof from paying twice."],
] as const;

function ChallengeGlyph({ index }: { index: number }) {
  const cards = [
    ["2♣", "K♠"],
    ["A♦", "9♣"],
    ["Q♠", "J♥"],
    ["8♣", "8♦"],
    ["A♠", "Q♦"],
    ["K♣", "7♥"],
    ["A♥", "5♣"],
    ["J♠", "4♦"],
  ][index];

  return (
    <div className="challenge-glyph" aria-hidden="true">
      <span>{cards[0]}</span>
      <span>{cards[1]}</span>
      <i>{String(index + 1).padStart(2, "0")}</i>
    </div>
  );
}

export default function RulesPage() {
  return (
    <main className="site-shell story-page story-rules">
      <SiteHeader compact />

      <header className="story-hero">
        <div>
          <p className="story-kicker">Rules</p>
          <h1>Texas Hold&apos;em with one private objective.</h1>
          <p>
            The betting game is standard no-limit Hold&apos;em. Noir Poker adds an optional proof layer
            between hands.
          </p>
        </div>
        <a className="story-source-card" href={WSOP_RULES} target="_blank" rel="noreferrer">
          <span>Poker rules</span>
          <strong>WSOP rulebook</strong>
          <small>Open source</small>
        </a>
      </header>

      <section className="story-section" aria-labelledby="modes-title">
        <header className="story-section-head">
          <p className="story-index">01</p>
          <div>
            <h2 id="modes-title">Choose the table</h2>
            <p>All three modes share the same Rust game engine and table interface.</p>
          </div>
        </header>

        <div className="mode-rule-grid">
          <article>
            <span>Single player</span>
            <h3>You and server-side bots</h3>
            <p>
              Bots sample possible hidden cards, estimate hand strength and compare the result with
              pot odds before choosing a legal action.
            </p>
            <a href={BOT_PAPER} target="_blank" rel="noreferrer">
              Simulation strategy reference
            </a>
          </article>
          <article>
            <span>Multiplayer</span>
            <h3>Two to six human seats</h3>
            <p>
              Every browser contributes deal entropy. Private views, reconnection and durable room
              recovery use the same server path as single player.
            </p>
          </article>
          <article>
            <span>Aztec poker</span>
            <h3>Wallet-gated table entry</h3>
            <p>
              The current prototype locks a private PLAY buy-in before opening the table. On-chain
              settlement remains a later step.
            </p>
          </article>
        </div>
      </section>

      <section className="story-section" aria-labelledby="poker-title">
        <header className="story-section-head">
          <p className="story-index">02</p>
          <div>
            <h2 id="poker-title">One hand</h2>
            <p>The table advances only through legal actions returned by the engine.</p>
          </div>
        </header>

        <ol className="poker-flow">
          {POKER_FLOW.map(([title, copy], index) => (
            <li key={title}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{title}</strong>
              <p>{copy}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="story-section" aria-labelledby="catalog-title">
        <header className="story-section-head">
          <p className="story-index">03</p>
          <div>
            <h2 id="catalog-title">Challenge catalog</h2>
            <p>These eight definitions are committed into the current Merkle root.</p>
          </div>
        </header>

        <div className="challenge-catalog">
          {CHALLENGES.map((challenge, index) => (
            <article key={challenge}>
              <ChallengeGlyph index={index} />
              <span>Challenge {String(index + 1).padStart(2, "0")}</span>
              <h3>{challenge}</h3>
              <p>Worth 20 proof points after an accepted completion proof.</p>
            </article>
          ))}
        </div>
      </section>

      <section className="story-section" aria-labelledby="challenge-rules-title">
        <header className="story-section-head">
          <p className="story-index">04</p>
          <div>
            <h2 id="challenge-rules-title">Challenge rules</h2>
            <p>Proofs add evidence. They do not pause the poker game.</p>
          </div>
        </header>

        <dl className="rule-ledger">
          {CHALLENGE_RULES.map(([term, copy], index) => (
            <div key={term}>
              <dt>
                <span>{String(index + 1).padStart(2, "0")}</span>
                {term}
              </dt>
              <dd>{copy}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="story-section" aria-labelledby="states-title">
        <header className="story-section-head">
          <p className="story-index">05</p>
          <div>
            <h2 id="states-title">What the challenge panel shows</h2>
            <p>The objective stays pinned above the table. Public proof status appears by player.</p>
          </div>
        </header>

        <div className="challenge-state-grid">
          <article>
            <h3>Assigned</h3>
            <ChallengeUiPreview state="assigned" />
          </article>
          <article>
            <h3>Completed</h3>
            <ChallengeUiPreview state="hit" />
          </article>
          <article>
            <h3>Missed</h3>
            <ChallengeUiPreview state="miss" />
          </article>
          <article>
            <h3>Published</h3>
            <ChallengeUiPreview state="verified" />
          </article>
        </div>
      </section>

      <section className="story-section story-next">
        <div>
          <h2>Verify a deal or challenge</h2>
          <p>The protocol page gives the browser path, exported artifact and command-line check.</p>
        </div>
        <Link className="story-link" href="/protocol">
          Open the protocol
        </Link>
      </section>
    </main>
  );
}
