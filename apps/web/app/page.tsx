import Link from "next/link";

import { Lobby } from "@/components/lobby";
import { SiteHeader } from "@/components/site-header";

export default function Home() {
  return (
    <main className="site-shell">
      <SiteHeader />

      <section className="hero" aria-labelledby="home-title">
        <div className="hero-copy">
          <h1 id="home-title">Poker with a verifiable deck.</h1>
          <p>
            The server commits before player randomness arrives. After each hand, anyone can
            reconstruct all 52 card positions and verify the committed deck was dealt. Secret
            bounty awards are proven in Noir without revealing the objective.
          </p>
          <div className="hero-links">
            <Link href="/protocol">Protocol and verification</Link>
          </div>
        </div>

        <div className="hero-deck" aria-label="A sealed deck becoming auditable">
          <div className="hero-card hero-card-3">A♠</div>
          <div className="hero-card hero-card-2">?</div>
          <div className="hero-card hero-card-1">?</div>
          <div className="hero-proof-line">
            <span>server commits</span>
            <span>players contribute</span>
            <span>deal</span>
            <span>public audit</span>
          </div>
        </div>
      </section>

      <section className="lobby-wrap" aria-labelledby="lobby-title">
        <div>
          <h2 id="lobby-title">Create a game</h2>
          <Lobby />
        </div>
      </section>

      <section className="trust-strip" aria-label="What can be verified">
        <article>
          <span>Deck audit</span>
          <strong>Reconstruct the hand</strong>
          <p>Verify the commitment, entropy, shuffle, hole cards, burns and board after settlement.</p>
        </article>
        <article>
          <span>Private bounty</span>
          <strong>Verify the award</strong>
          <p>Two Noir proofs establish that a hidden catalog objective was fairly drawn and completed.</p>
        </article>
        <article>
          <span>Security model</span>
          <strong>The server sees the cards</strong>
          <p>Completed deck selection is auditable. Server aborts and full collusion remain outside the guarantee.</p>
        </article>
      </section>
    </main>
  );
}
