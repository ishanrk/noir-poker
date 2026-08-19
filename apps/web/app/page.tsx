import { Lobby } from "@/components/lobby";
import { SiteHeader } from "@/components/site-header";

export default function Home() {
  return (
    <main className="site-shell home-page">
      <SiteHeader />

      <section className="hero" aria-labelledby="home-title">
        <div className="hero-copy">
          <h1 id="home-title">Noir Poker</h1>
          <p>
            Online hold&apos;em with independently verifiable dealing and private zero knowledge
            challenges.
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
