import Link from "next/link";

import { Lobby } from "@/components/lobby";
import { SiteHeader } from "@/components/site-header";

export default function Home() {
  return (
    <main className="site-shell home-page">
      <SiteHeader />

      <section className="hero" aria-labelledby="home-title">
        <div className="hero-copy">
          <h1 id="home-title">
            <span className="hero-title-noir">Noir</span> Poker
          </h1>
          <p className="hero-tagline">The game server cannot secretly choose a favorable deck.</p>
          <div className="hero-stack" aria-label="Technology stack">
            <span>
              <strong>Backend</strong> Rust
            </span>
            <span>
              <strong>Frontend</strong> Next.js and TypeScript
            </span>
            <span>
              <strong>Circuits</strong> Noir
            </span>
          </div>
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
          <Link href="/rules">Full rules</Link>
        </div>
        <div className="home-rules-grid">
          <article>
            <h3>Texas Hold’em</h3>
            <p>
              Standard no-limit rules apply. Tables seat two to six players and use play chips.
            </p>
          </article>
          <article>
            <h3>Private challenges</h3>
            <p>
              Between hands, each active player receives one private challenge for the next hand.
              A completed challenge earns proof points without revealing the objective.
            </p>
          </article>
        </div>
      </section>
    </main>
  );
}
