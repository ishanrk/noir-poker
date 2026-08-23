import Link from "next/link";

import { SiteHeader } from "@/components/site-header";

const ULTIMATE_BET =
  "https://kahnawakenews.com/gaming-commission-releases-final-decision-on-ultimate-bet-cheating-p421-1.htm";
const FULL_TILT =
  "https://www.justice.gov/usao-sdny/united-states-v-pokerstars-et-al-11-civ-2564-lbsfull-tilt-poker-information";
const MENTAL_POKER =
  "https://research-information.bris.ac.uk/en/publications/mental-poker-revisited/";
const VERIFIABLE_SHUFFLE = "https://doi.org/10.1145/501983.502000";
const NOIR = "https://noir-lang.org/docs/";

const DECK_STEPS = [
  {
    number: "01",
    title: "Encrypt every card",
    copy: "The hand begins with 52 known cards hidden under one joint key No player or server owns the full key",
  },
  {
    number: "02",
    title: "Shuffle together",
    copy: "The server and each human secretly reorder the encrypted deck Each shuffle includes a proof that no card changed",
  },
  {
    number: "03",
    title: "Open only the deal",
    copy: "Key shares reveal each hole card to its owner and board cards to the table The completed transcript checks every step",
  },
] as const;

export default function MotivationPage() {
  return (
    <main className="site-shell story-page story-motivation">
      <SiteHeader compact />

      <header className="story-hero story-hero-motivation">
        <div>
          <p className="story-kicker">Motivation</p>
          <h1>The server should not be the only witness.</h1>
          <p>
            An online table can look fair while the code choosing the cards stays hidden Noir Poker
            publishes evidence for the deck and private challenges
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
            <h2 id="failures-title">Real tables have hidden the wrong facts</h2>
            <p>The screen only shows what the operator chooses to send</p>
          </div>
        </header>

        <div className="case-grid">
          <article className="case-card">
            <div className="case-mark" aria-hidden="true">
              <span>A♠</span>
              <span>?</span>
            </div>
            <p className="case-label">Privileged software</p>
            <h3>UltimateBet</h3>
            <p>
              A regulator found that people connected to the operator manipulated its poker
              software More than 22 million dollars went back to affected players
            </p>
            <a href={ULTIMATE_BET} target="_blank" rel="noreferrer">
              Read the commission report coverage
            </a>
          </article>

          <article className="case-card">
            <div className="case-mark case-mark-ledger" aria-hidden="true">
              <span>$390m</span>
              <span>$60m</span>
            </div>
            <p className="case-label">Unreliable balances</p>
            <h3>Full Tilt Poker</h3>
            <p>
              The US Justice Department said the operator lacked the funds shown in player
              accounts Players kept winning and losing with credits the operator could not repay
            </p>
            <a href={FULL_TILT} target="_blank" rel="noreferrer">
              Read the Justice Department record
            </a>
          </article>
        </div>
      </section>

      <section className="story-section" aria-labelledby="deck-title">
        <header className="story-section-head">
          <p className="story-index">02</p>
          <div>
            <h2 id="deck-title">No trusted dealer</h2>
            <p>One honest participant keeps the final order outside server control</p>
          </div>
        </header>

        <ol className="trust-flow">
          {DECK_STEPS.map((step) => (
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
          This design follows mental poker and verifiable shuffle research See{" "}
          <a href={MENTAL_POKER} target="_blank" rel="noreferrer">
            Mental Poker Revisited
          </a>{" "}
          and{" "}
          <a href={VERIFIABLE_SHUFFLE} target="_blank" rel="noreferrer">
            A Verifiable Secret Shuffle
          </a>
        </p>
      </section>

      <section className="story-section story-private" aria-labelledby="challenge-title">
        <header className="story-section-head">
          <p className="story-index">03</p>
          <div>
            <h2 id="challenge-title">Check the challenge without seeing it</h2>
            <p>The proof checks selection and completion while the objective stays private</p>
          </div>
        </header>

        <div className="privacy-split">
          <article>
            <span>Player browser</span>
            <strong>Objective secret catalog path and private hand witness</strong>
          </article>
          <article>
            <span>Public proof</span>
            <strong>Hand binding seat commitment catalog root fact hash and nullifier</strong>
          </article>
        </div>

        <p>
          A private browser secret and a fresh server nonce select one fixed catalog entry The fair
          draw proof checks that selection The completion proof checks the hidden rule against the
          committed hand facts Other players can verify either accepted proof without learning the
          objective
        </p>

        <p className="story-note">
          Noir separates private witness values from public verifier inputs Read the{" "}
          <a href={NOIR} target="_blank" rel="noreferrer">
            Noir zero knowledge reference
          </a>
        </p>
      </section>

      <section className="story-section story-limits" aria-labelledby="limits-title">
        <header className="story-section-head">
          <p className="story-index">04</p>
          <div>
            <h2 id="limits-title">Evidence has a boundary</h2>
            <p>The protocol makes specific claims rather than trusting a badge</p>
          </div>
        </header>
        <ul>
          <li>A participant can disconnect and stop progress</li>
          <li>A deck transcript proves its recorded encrypted shuffle and openings</li>
          <li>A completion proof relies on the hand fact commitment published by the server</li>
          <li>The implementation still needs independent security review before real stakes</li>
        </ul>
        <Link className="story-link" href="/protocol">
          Read the exact protocol
        </Link>
      </section>
    </main>
  );
}
