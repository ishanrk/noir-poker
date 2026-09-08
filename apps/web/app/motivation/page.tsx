import type { ReactNode } from "react";

import { SiteHeader } from "@/components/site-header";

const ULTIMATE_BET =
  "https://kahnawakenews.com/gaming-commission-releases-final-decision-on-ultimate-bet-cheating-p421-1.htm";
const FULL_TILT =
  "https://www.justice.gov/usao-sdny/united-states-v-pokerstars-et-al-11-civ-2564-lbsfull-tilt-poker-information";
const MENTAL_POKER =
  "https://research-information.bris.ac.uk/en/publications/mental-poker-revisited/";
const VERIFIABLE_SHUFFLE = "https://doi.org/10.1145/501983.502000";

export default function MotivationPage() {
  return (
    <main className="site-shell story-page brief-page story-motivation">
      <SiteHeader compact />

      <header className="brief-hero">
        <p className="brief-kicker">Motivation</p>
        <h1>The reason for Noir Poker</h1>
        <p className="brief-description">
          It is easy for a normal poker server to cheat because it controls the deck and hides its
          internal state.
        </p>
      </header>

      <div className="brief-stack">
        <section className="brief-panel" data-tone="cobalt">
          <span>01</span>
          <h2>A server can cheat</h2>
          <ol>
            <li>The server can know every private card and every future community card</li>
            <li>It can choose the deck order or send different information to different players</li>
            <li>The normal game screen cannot prove that the hidden deck stayed fair</li>
          </ol>
        </section>

        <section className="brief-panel" data-tone="lime">
          <span>02</span>
          <h2>This has happened before</h2>
          <ol>
            <li>People connected to UltimateBet manipulated its poker software</li>
            <li>The investigation led to more than 22 million dollars returned to affected players</li>
            <li>Full Tilt showed player balances that it lacked enough money to repay</li>
            <li>A deck proof does not solve custody or prove that balances can be repaid</li>
          </ol>
          <footer>
            <Source href={ULTIMATE_BET}>Kahnawake commission decision coverage</Source>
            <Source href={FULL_TILT}>United States Justice Department record</Source>
          </footer>
        </section>

        <section className="brief-panel" data-tone="cobalt">
          <span>03</span>
          <h2>Noir Poker makes the shuffle checkable</h2>
          <ol>
            <li>The server and every player lock the 52 cards under one shared deck key</li>
            <li>Each participant secretly shuffles the encrypted cards</li>
            <li>A proof confirms that every shuffle kept the same 52 cards</li>
            <li>One honest shuffle stops the server from choosing the final order</li>
            <li>During play, only the cards needed for play become visible</li>
            <li>The completed deck opening reveals every card afterward, including folded cards</li>
            <li>Participants can still stop the deal by disconnecting or withholding an opening</li>
            <li>A hash chain does not stop a server presenting different histories to different people</li>
          </ol>
          <footer>
            <Source href={MENTAL_POKER}>Mental Poker Revisited</Source>
            <Source href={VERIFIABLE_SHUFFLE}>Neff on verifiable secret shuffles</Source>
          </footer>
        </section>
      </div>
    </main>
  );
}

function Source({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer">
      Source&nbsp; {children} ↗
    </a>
  );
}
