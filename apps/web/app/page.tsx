import Link from "next/link";

import { Lobby } from "@/components/lobby";
import { SiteHeader } from "@/components/site-header";

const WSOP_RULES = "https://assets.wsopcdn.com/wsop/853ee602-e1e9-4019-a0cf-381419d805c6.pdf";

export default function Home() {
  return (
    <main className="site-shell home-page">
      <SiteHeader />

      <section className="hero" aria-labelledby="home-title">
        <div className="hero-copy">
          <h1 id="home-title" aria-label="Noir Poker">
            <span className="hero-title-noir" aria-hidden="true">
              <span className="noir-letter noir-letter-n">N</span>
              <span className="noir-letter noir-letter-o">o</span>
              <span className="noir-letter noir-letter-i">i</span>
              <span className="noir-letter noir-letter-r">r</span>
            </span>{" "}
            Poker
          </h1>
          <p className="hero-tagline">The server cannot secretly choose a favorable completed deck.</p>
        </div>

        <div className="hero-deck" aria-label="Animated sealed cards">
          <div className="hero-card hero-card-3">A♠</div>
          <div className="hero-card hero-card-2">?</div>
          <div className="hero-card hero-card-1">?</div>
        </div>
      </section>

      <section className="lobby-wrap" aria-labelledby="lobby-title">
        <div>
          <h2 id="lobby-title">Create a game</h2>
          <Lobby />
        </div>
      </section>

      <section className="home-rules" aria-labelledby="home-rules-title">
        <div className="home-rules-heading">
          <h2 id="home-rules-title">Rules</h2>
          <Link href="/rules">Challenge rules</Link>
        </div>

        <div className="home-rule-row">
          <div>
            <h3>Texas Hold&apos;em</h3>
            <p>Normal no-limit Texas Hold&apos;em rules apply.</p>
          </div>
          <a href={WSOP_RULES} target="_blank" rel="noreferrer">
            WSOP rules ↗
          </a>
        </div>

        <div className="home-rule-row">
          <div>
            <h3>Private challenge</h3>
            <p>
              Between hands, every active player receives one random private challenge. A completed
              challenge earns proof points without revealing the challenge or the player&apos;s hole cards.
            </p>
          </div>
          <Link href="/rules">Challenge rules →</Link>
        </div>
      </section>
    </main>
  );
}
