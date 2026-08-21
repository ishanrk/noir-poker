import Link from "next/link";

import { Lobby } from "@/components/lobby";
import { SiteHeader } from "@/components/site-header";

const PROOFS = [
  {
    number: "01",
    title: "Replay the deal",
    copy: "A completed hand exposes the commitment, entropy shares, seed and 52-card permutation.",
    href: "/protocol#deal",
    link: "Deal protocol",
  },
  {
    number: "02",
    title: "Keep the objective private",
    copy: "The player browser holds the challenge secret and private witness.",
    href: "/rules",
    link: "Challenge rules",
  },
  {
    number: "03",
    title: "Verify accepted proofs",
    copy: "Anyone can check the exact proof bytes published by the server.",
    href: "/protocol",
    link: "Verification guide",
  },
] as const;

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
          <p className="hero-tagline">Play poker with a deck anyone can replay after the hand.</p>
          <p className="hero-tech">
            Rust settles the game. Browser randomness fixes the deck. Noir proves private challenges.
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

      <section className="home-proof-strip" aria-label="Project verification paths">
        {PROOFS.map((item) => (
          <article key={item.number}>
            <span>{item.number}</span>
            <h2>{item.title}</h2>
            <p>{item.copy}</p>
            <Link href={item.href}>{item.link}</Link>
          </article>
        ))}
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
