import Link from "next/link";

import { SiteHeader } from "@/components/site-header";

const ULTIMATE_BET = "https://www.pokernews.com/news/2022/11/ultimate-bet-scandal-42623.htm";
const FULL_TILT = "https://www.justice.gov/usao-sdny/pr/former-full-tilt-poker-ceo-pleads-guilty-and-sentenced-manhattan-federal-court";

export default function MotivationPage() {
  return (
    <main className="site-shell motivation-page">
      <SiteHeader compact />

      <header className="motivation-hero motivation-hero-new">
        <p className="motivation-kicker">Motivation</p>
        <h1>An online poker room controls things the players cannot see.</h1>
        <p>
          The deck is generated on someone else&apos;s machine. Private challenge claims are judged on
          someone else&apos;s machine. Without a public check, every player is trusting that machine.
        </p>
      </header>

      <section className="motivation-cases" aria-label="Online poker trust failures">
        <article className="case-card case-card-blue">
          <span>UltimateBet</span>
          <strong>Insiders could see opponents&apos; hole cards.</strong>
          <p>
            A hidden superuser system exposed private cards during live online play. PokerNews reports
            more than $50 million was stolen across the UltimateBet and Absolute Poker scandals.
          </p>
          <a href={ULTIMATE_BET} target="_blank" rel="noreferrer">PokerNews report ↗</a>
        </article>
        <article className="case-card">
          <span>Full Tilt Poker</span>
          <strong>Players had to trust claims made by the operator.</strong>
          <p>
            The failure was different, but the lesson is useful. The U.S. Department of Justice said
            Full Tilt owed players hundreds of millions while holding only a fraction of that amount.
          </p>
          <a href={FULL_TILT} target="_blank" rel="noreferrer">DOJ case ↗</a>
        </article>
      </section>

      <section className="motivation-story motivation-story-deck">
        <div className="motivation-story-copy">
          <p className="motivation-kicker">The deck</p>
          <h2>The server has to commit before it sees player randomness.</h2>
          <p>
            The server fixes its contribution first. Players then add fresh randomness. Together those
            values determine the deck. After the hand, anyone can rebuild the same shuffle and every
            card position.
          </p>
          <p>
            So the server cannot keep trying completed decks until one favors a particular seat and
            then pretend that was the original random result.
          </p>
        </div>
        <div className="motivation-deck-scene" aria-hidden="true">
          <span className="motivation-server-card">server</span>
          <span className="motivation-player-card">player</span>
          <span className="motivation-deck-card">?</span>
          <i />
        </div>
      </section>

      <section className="motivation-story motivation-story-challenge">
        <div className="motivation-story-copy">
          <p className="motivation-kicker">The challenge</p>
          <h2>A public result should not require a player to reveal private information.</h2>
          <p>
            Suppose the private challenge is <strong>reach showdown</strong>. A normal server can simply
            announce that it was completed. Everyone else either trusts the server or asks for enough
            information to check the claim themselves.
          </p>
          <p>
            Noir Poker instead publishes a proof. Other players can verify that the private challenge
            was selected from the fixed catalog and completed without learning the challenge or the
            player&apos;s hole cards.
          </p>
        </div>
        <div className="challenge-proof-scene" aria-hidden="true">
          <span className="challenge-scene-card challenge-scene-secret">?</span>
          <span className="challenge-scene-card challenge-scene-hole">A♠</span>
          <span className="challenge-scene-proof">proof ✓</span>
        </div>
      </section>

      <section className="motivation-boundary">
        <h2>Current boundary</h2>
        <p>
          Challenge completion is currently proven against hand facts committed by the server. The
          challenge and hole cards stay private, but complete server independent reconstruction of
          those hand facts still needs a public action transcript.
        </p>
        <Link href="/protocol">Open the protocol →</Link>
      </section>
    </main>
  );
}
