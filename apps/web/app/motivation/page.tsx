import type { ReactNode } from "react";

import { SiteHeader } from "@/components/site-header";

const ULTIMATE_BET =
  "https://kahnawakenews.com/gaming-commission-releases-final-decision-on-ultimate-bet-cheating-p421-1.htm";
const FULL_TILT =
  "https://www.justice.gov/usao-sdny/united-states-v-pokerstars-et-al-11-civ-2564-lbsfull-tilt-poker-information";
const MENTAL_POKER =
  "https://research-information.bris.ac.uk/en/publications/mental-poker-revisited/";
const VERIFIABLE_SHUFFLE = "https://doi.org/10.1145/501983.502000";

type Scene = "peek" | "order" | "split" | "ultimate" | "tilt" | "shuffle" | "proof" | "check";

export default function MotivationPage() {
  return (
    <main className="site-shell story-page brief-page story-motivation">
      <SiteHeader compact />

      <header className="brief-hero">
        <p className="brief-kicker">Motivation</p>
        <h1>The reason for Noir Poker</h1>
        <p className="brief-description">
          A normal poker site asks you to trust the same server that sees every card and deals every hand.
          Noir Poker makes the deal something the players can check.
        </p>
      </header>

      <div className="brief-stack motivation-stack">
        <section className="brief-panel motivation-panel" data-tone="cobalt">
          <span className="motivation-panel-number">01</span>
          <h2>What a normal server can do</h2>
          <p className="motivation-panel-intro">Focus or hover over a point to see the trick.</p>
          <ol className="motivation-points">
            <StoryPoint title="Read your hand" scene="peek">
              The server sees your hole cards. An insider or favored player could see them too.
            </StoryPoint>
            <StoryPoint title="Pick what comes next" scene="order">
              A dishonest dealer can arrange the hidden deck and quietly steer the biggest pots.
            </StoryPoint>
            <StoryPoint title="Tell two stories" scene="split">
              It can show players different records and ask each of them to trust its private log.
            </StoryPoint>
          </ol>
        </section>

        <section className="brief-panel motivation-panel" data-tone="lime">
          <span className="motivation-panel-number">02</span>
          <h2>Poker sites have abused hidden power</h2>
          <p className="motivation-panel-intro">These cases are why “trust the operator” is not enough.</p>
          <ol className="motivation-points motivation-cases">
            <StoryPoint title="UltimateBet" scene="ultimate">
              Unauthorized software let people connected to the site see opponents&apos; hole cards.
              The Kahnawake investigation ordered money returned to affected players.
            </StoryPoint>
            <StoryPoint title="Full Tilt" scene="tilt">
              Player balances appeared on screen while the company lacked enough money to repay them.
              This was a custody failure, not a rigged deck, and a shuffle proof does not solve it.
            </StoryPoint>
          </ol>
          <footer>
            <Source href={ULTIMATE_BET}>UltimateBet investigation</Source>
            <Source href={FULL_TILT}>United States Justice Department record</Source>
          </footer>
        </section>

        <section className="brief-panel motivation-panel" data-tone="cobalt">
          <span className="motivation-panel-number">03</span>
          <h2>How Noir Poker checks the deal</h2>
          <p className="motivation-panel-intro">The server no longer gets the only shuffle.</p>
          <ol className="motivation-points">
            <StoryPoint title="You shuffle too" scene="shuffle">
              Every participant secretly mixes the encrypted deck. One honest shuffle keeps the server
              from choosing the final order.
            </StoryPoint>
            <StoryPoint title="Prove the same 52 remain" scene="proof">
              Each shuffle comes with a proof that it rerandomized and reordered the input deck without
              adding, removing, or changing a card.
            </StoryPoint>
            <StoryPoint title="Check the completed hand" scene="check">
              The completed transcript opens the deck so another browser can reconstruct every card and
              verify the shuffle chain.
            </StoryPoint>
          </ol>
          <p className="motivation-honest-note">
            Cards stay private during play. The completed opening reveals all cards afterward, including
            folded cards. Proofs do not guarantee that the server stays online, holds player funds, or
            shows one global history to everyone.
          </p>
          <footer>
            <Source href={MENTAL_POKER}>Mental Poker Revisited</Source>
            <Source href={VERIFIABLE_SHUFFLE}>Verifiable secret shuffles</Source>
          </footer>
        </section>
      </div>
    </main>
  );
}

function StoryPoint({ title, scene, children }: { title: string; scene: Scene; children: ReactNode }) {
  return (
    <li className="motivation-point" tabIndex={0}>
      <div className="motivation-point-copy">
        <strong>{title}</strong>
        <p>{children}</p>
      </div>
      <PointScene kind={scene} />
    </li>
  );
}

function PointScene({ kind }: { kind: Scene }) {
  return (
    <div className={`motivation-scene motivation-scene-${kind}`} aria-hidden="true">
      {kind === "peek" && <>
        <span className="scene-card scene-card-back">NP</span>
        <span className="scene-card scene-card-face">A♠</span>
        <span className="scene-label">SERVER SEES</span>
      </>}
      {kind === "order" && <>
        <span className="scene-mini-card">2</span><span className="scene-mini-card">7</span>
        <span className="scene-mini-card">K</span><span className="scene-mini-card">A</span>
        <span className="scene-label">DECK ORDER</span>
      </>}
      {kind === "split" && <>
        <span className="scene-record scene-record-a">PLAYER 1<br />CALL<br />RIVER 7</span>
        <span className="scene-record scene-record-b">PLAYER 2<br />CALL<br />RIVER A</span>
      </>}
      {kind === "ultimate" && <>
        <span className="scene-site">UB</span><span className="scene-eye">HOLE CARDS</span>
        <span className="scene-warning">HIDDEN ACCESS</span>
      </>}
      {kind === "tilt" && <>
        <span className="scene-balance">PLAYER BALANCE</span><span className="scene-bank">BANK</span>
        <span className="scene-shortfall">SHORTFALL</span>
      </>}
      {kind === "shuffle" && <>
        <span className="scene-hand">SERVER</span><span className="scene-hand">YOU</span>
        <span className="scene-hand">PLAYER 2</span><span className="scene-result">MIXED DECK</span>
      </>}
      {kind === "proof" && <>
        <span className="scene-deck-count">52</span><span className="scene-proof-arrow">→</span>
        <span className="scene-deck-count">52</span><span className="scene-proof-seal">PROOF OK</span>
      </>}
      {kind === "check" && <>
        <span className="scene-transcript">HAND 8<br />52 CARDS<br />3 SHUFFLES</span>
        <span className="scene-checkmark">✓</span>
      </>}
    </div>
  );
}

function Source({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer">
      Read source: {children}
    </a>
  );
}
