import Link from "next/link";

import { SiteHeader } from "@/components/site-header";

export default function MotivationPage() {
  return (
    <main className="site-shell motivation-page">
      <SiteHeader compact />

      <header className="motivation-hero">
        <h1>Motivation</h1>
        <p>
          Online poker asks players to trust the server with two decisions: the deck and private
          challenge claims. Noir Poker makes both decisions independently checkable.
        </p>
      </header>

      <section className="motivation-section">
        <h2>Deal integrity</h2>
        <p>
          In a normal hosted game, the server chooses the shuffle. A player cannot distinguish a
          fair shuffle from a server that keeps trying seeds until a favored seat receives stronger
          cards.
        </p>
        <p>
          Noir Poker fixes the server contribution first. The server commits to a secret before
          player randomness arrives. Each player then adds fresh randomness. After settlement, the
          secret and player shares become public. Anyone can recompute the final seed, every shuffle
          swap and all 52 card positions.
        </p>
        <div className="motivation-example">
          <span>Example</span>
          <p>
            A server that wants seat 3 to receive aces cannot wait for every player share, search
            for a favorable seed, then present that seed as its original choice. The earlier
            commitment binds the server contribution before those shares exist.
          </p>
        </div>
      </section>

      <section className="motivation-section">
        <h2>Private challenges</h2>
        <p>
          After a hand, each player receives a private challenge for the next hand. The challenge
          should remain hidden from the other players.
        </p>
        <p>
          In a conventional online game, public verification creates a bad choice. The player can
          reveal the challenge and any private evidence needed to support the claim, or everyone can
          accept the server&apos;s verdict.
        </p>
        <p>
          The zero knowledge circuit proves that the player committed before server entropy arrived,
          that the resulting secret selected one challenge from the fixed catalog, and that the same
          hidden challenge is satisfied by the committed hand facts. The challenge stays secret.
        </p>
        <div className="motivation-example">
          <span>Example</span>
          <p>
            A challenge such as reach showdown can be proven as a hidden catalog statement. The
            public receipt reveals the hand, seat, commitment, server nonce, facts commitment and
            proof while the objective remains private.
          </p>
        </div>
      </section>

      <section className="motivation-section">
        <h2>Current boundary</h2>
        <p>
          The current receipt relies on the server committed hand facts. It proves the hidden
          challenge against that commitment, but it does not independently reconstruct the six facts
          from a public action transcript. Full server independent challenge verification needs that
          extra audit layer.
        </p>
      </section>

      <section className="motivation-section motivation-last">
        <h2>Two cryptographic layers</h2>
        <p>
          Deal integrity uses SHA 256 commitments and deterministic replay. Challenge privacy uses
          Noir, BLAKE2s, Merkle membership and UltraHonk. The protocol page gives exact encodings and
          verifier steps.
        </p>
        <Link href="/protocol">Open protocol →</Link>
      </section>
    </main>
  );
}
