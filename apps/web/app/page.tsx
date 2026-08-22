import Link from "next/link";

import { Lobby } from "@/components/lobby";
import { SiteHeader } from "@/components/site-header";

export default function Home() {
  return (
    <main className="site-shell home-page home-story">
      <SiteHeader />

      <section className="hero" aria-labelledby="home-title">
        <div className="hero-copy">
          <h1 id="home-title" aria-label="Noir Poker">
            <span className="hero-title-noir" aria-hidden="true">
              {[
                ["N", "n"],
                ["o", "o"],
                ["i", "i"],
                ["r", "r"],
              ].map(([letter, key]) => (
                <span className={`noir-letter noir-letter-${key}`} key={key}>
                  <span className="noir-letter-inner">
                    <span className="noir-letter-face">{letter}</span>
                    <span className="noir-letter-face noir-letter-question">?</span>
                  </span>
                </span>
              ))}
            </span>
            <span className="hero-title-poker">Poker</span>
          </h1>
          <p className="hero-tagline">Poker where the server cannot cheat even if it wanted to.</p>
          <p className="hero-tech">
            Written in <span className="tech-rust">Rust</span> and{" "}
            <span className="tech-typescript">TypeScript</span> with{" "}
            <a className="tech-noir" href="https://github.com/noir-lang/noir" target="_blank" rel="noreferrer">Noir</a> and{" "}
            <a className="tech-barretenberg" href="https://github.com/AztecProtocol/aztec-packages/tree/next/barretenberg" target="_blank" rel="noreferrer">Barretenberg</a> for ZK protocols
          </p>
          <div className="home-actions">
            <a href="#play">Create a game</a>
            <Link href="/protocol">See how verification works</Link>
          </div>
        </div>

        <div className="hero-deck" aria-label="Animated sealed cards">
          <div className="hero-card hero-card-3">A♠</div>
          <div className="hero-card hero-card-2">?</div>
          <div className="hero-card hero-card-1">?</div>
        </div>
      </section>

      <section className="lobby-wrap" id="play" aria-labelledby="lobby-title">
        <div>
          <h2 id="lobby-title">Create a game</h2>
          <Lobby />
        </div>
      </section>
    </main>
  );
}
