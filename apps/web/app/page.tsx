import Link from "next/link";

import { Lobby } from "@/components/lobby";
import { SiteHeader } from "@/components/site-header";

export default function Home() {
  return (
    <main className="site-shell">
      <SiteHeader />

      <section className="hero" aria-labelledby="home-title">
        <div className="hero-copy">
          <p className="eyebrow">Noir · UltraHonk · six-max hold&apos;em</p>
          <h1 id="home-title">Poker whose hidden parts leave public evidence.</h1>
          <p>
            Play ordinary no-limit hold&apos;em. Every deck is fixed by server and player
            entropy before the deal. Every secret bounty can be proven complete without
            disclosing what it asked you to do.
          </p>
          <div className="hero-links">
            <Link href="/protocol">Read the protocol</Link>
            <span>no wallet · no account · play chips only</span>
          </div>
        </div>

        <div className="hero-deck" aria-label="A sealed deck becoming auditable">
          <div className="hero-card hero-card-3">A♠</div>
          <div className="hero-card hero-card-2">?</div>
          <div className="hero-card hero-card-1">?</div>
          <div className="hero-proof-line">
            <span>commit</span>
            <span>contribute</span>
            <span>deal</span>
            <span>reveal</span>
          </div>
        </div>
      </section>

      <section className="lobby-wrap" aria-labelledby="lobby-title">
        <div className="section-index">
          <span>01</span>
          <p>Open a table</p>
        </div>
        <div>
          <h2 id="lobby-title">Choose the game, not a dashboard.</h2>
          <Lobby />
        </div>
      </section>

      <section className="trust-strip" aria-label="What the cryptography establishes">
        <article>
          <span>Deal integrity</span>
          <strong>Rebuild all 52 positions</strong>
          <p>After settlement, anyone can recompute the commitment, seed, shuffle and deal.</p>
        </article>
        <article>
          <span>Private bounty</span>
          <strong>Verify the win, not the objective</strong>
          <p>The public sees two valid proofs and one award while the objective stays sealed.</p>
        </article>
        <article>
          <span>Honest limit</span>
          <strong>Auditable, not mental poker</strong>
          <p>The authoritative server sees cards. The protocol proves the deck was not changed.</p>
        </article>
      </section>
    </main>
  );
}
