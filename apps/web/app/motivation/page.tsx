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
        <h1>Online poker makes you trust a server you cannot see.</h1>
        <p>
          The server chooses the deck and decides whether private challenge claims are real. A normal
          client can only believe those decisions were honest. Noir Poker makes both decisions checkable.
        </p>
      </header>

      <section className="motivation-cases" aria-label="Online poker trust failures">
        <article className="case-card case-card-blue">
          <span>UltimateBet</span>
          <strong>Insiders could see opponents&apos; hole cards.</strong>
          <p>
            A hidden superuser system exposed private cards during live online play. PokerNews reports
            that players were cheated out of more than $50 million across the UltimateBet and Absolute
            Poker scandals.
          </p>
          <a href={ULTIMATE_BET} target="_blank" rel="noreferrer">Read the case ↗</a>
        </article>
        <article className="case-card">
          <span>Full Tilt Poker</span>
          <strong>The operator told players their money was safe when it was not.</strong>
          <p>
            This was a different failure, but the trust model was the same. The U.S. Department of
            Justice said Full Tilt owed players hundreds of millions while holding only a fraction of
            that amount in its bank accounts.
          </p>
          <a href={FULL_TILT} target="_blank" rel="noreferrer">Read the DOJ case ↗</a>
        </article>
      </section>

      <section className="motivation-story">
        <div className="motivation-story-copy">
          <p className="motivation-kicker">Deal fairness</p>
          <h2>The server cannot wait for a good deck and pretend it was random.</h2>
          <p>
            Before player randomness arrives, the server commits to its own secret value. Every player
            then contributes fresh randomness. Those values determine the final deck together.
          </p>
          <p>
            After the hand, the transcript opens. Any player can rebuild the seed, shuffle and card
            positions independently. If the server changed its earlier contribution, the commitment no
            longer matches.
          </p>
        </div>
        <div className="motivation-flow" aria-label="Deal verification sequence">
          <span>server commits</span>
          <i />
          <span>players add randomness</span>
          <i />
          <span>hand is dealt</span>
          <i />
          <span>everyone can replay it</span>
        </div>
      </section>

      <section className="motivation-story motivation-story-challenge">
        <div className="motivation-story-copy">
          <p className="motivation-kicker">Private challenge</p>
          <h2>A player should not have to reveal the challenge or hole cards to prove completion.</h2>
          <p>
            In a normal online game, the server can simply announce that a private challenge was
            completed. Everyone else either trusts that verdict or asks the player to reveal private
            information.
          </p>
          <p>
            Here the browser proves that the challenge came from the fixed challenge catalog and that
            the same hidden challenge was completed. Other players can verify the proof without seeing
            the objective or the player&apos;s hole cards.
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
          challenge and hole cards stay private, but a fully server independent challenge verifier still
          needs a public action transcript that can rebuild those facts.
        </p>
        <Link href="/protocol">Open the protocol →</Link>
      </section>
    </main>
  );
}
