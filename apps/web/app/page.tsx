import { Lobby } from "@/components/lobby";
import { SiteHeader } from "@/components/site-header";

export default function Home() {
  return (
    <main className="site-shell home-page">
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
          <p className="hero-tagline">The game server cannot cheat even if it wanted to.</p>
          <p className="hero-tech">
            Rust backend, Next.js and TypeScript frontend, Noir zero knowledge circuits.
          </p>
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
    </main>
  );
}
