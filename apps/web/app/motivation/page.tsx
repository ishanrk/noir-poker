import Link from "next/link";

import { SiteHeader } from "@/components/site-header";

const ULTIMATE_BET = "https://www.pokernews.com/news/2022/11/ultimate-bet-scandal-42623.htm";
const FULL_TILT = "https://www.justice.gov/usao-sdny/pr/former-full-tilt-poker-ceo-pleads-guilty-and-sentenced-manhattan-federal-court";

export default function MotivationPage() {
  return (
    <main className="site-shell motivation-page motivation-page-clear">
      <SiteHeader compact />

      <header className="motivation-plain-hero">
        <span>Motivation</span>
        <h1>Online poker and server trust</h1>
        <p>
          At a physical table you can see a dealer shuffle, deal and handle the cards. Online, the
          shuffle and deal happen inside software running on the poker operator&apos;s server. Your browser
          receives the cards that server says were dealt, so a normal online room ultimately depends on
          trusting the operator&apos;s software and internal access controls.
        </p>
      </header>

      <section className="motivation-plain-section">
        <h2>This has failed in real poker rooms</h2>
        <div className="motivation-case-list">
          <article>
            <h3>UltimateBet and Absolute Poker</h3>
            <p>
              Insiders used a hidden superuser capability that exposed opponents&apos; hole cards during
              live online play. PokerNews reports that players were cheated out of more than $50 million
              across the two scandals. The important point here is simple: software running inside the
              operator could see information ordinary players could not inspect.
            </p>
            <a href={ULTIMATE_BET} target="_blank" rel="noreferrer">PokerNews report ↗</a>
          </article>
          <article>
            <h3>Full Tilt Poker</h3>
            <p>
              This was not deck manipulation, but it is another example of the same visibility problem.
              Players were told their money was safe while the operator&apos;s internal finances said otherwise.
              The U.S. Department of Justice reported that Full Tilt owed roughly $390 million to players
              while holding about $60 million in its bank accounts shortly before the 2011 enforcement action.
            </p>
            <a href={FULL_TILT} target="_blank" rel="noreferrer">U.S. Department of Justice ↗</a>
          </article>
        </div>
      </section>

      <section className="motivation-plain-section">
        <h2>How the deck is fixed in Noir Poker</h2>
        <p>
          The server does not get to choose the final shuffle by itself. Before it accepts player
          randomness for a hand, it generates a fresh 32 byte secret and publishes a commitment to it.
          A commitment is a cryptographic way to lock in a value: the server can reveal the value later,
          and everyone can check that it matches the earlier commitment, but changing the value changes
          the commitment.
        </p>
        <p>
          Each player&apos;s browser then generates its own 32 random bytes with the browser cryptographic
          random generator, <code>crypto.getRandomValues</code>. The server&apos;s committed value and every
          player value are hashed together to produce the shuffle seed. That seed deterministically
          produces the 52 card order.
        </p>
        <p>
          If at least one player contributes randomness the server could not predict when it committed,
          the server cannot know the final completed deck at commitment time. After the hand settles,
          the server secret and player values are revealed, so anyone can rebuild the same seed, shuffle
          and card positions independently.
        </p>
      </section>

      <section className="motivation-plain-section">
        <h2>Private challenges are an extra rule in this game</h2>
        <p>
          Normal poker does not have the challenge system. Noir Poker adds one private challenge for
          each active player between hands. The player&apos;s browser learns the challenge; the other players
          do not.
        </p>
        <p>
          If the player misses the challenge, there is no completion proof and no proof points. If the
          player completes it, the browser generates a zero knowledge proof. Other players can verify
          that the challenge was selected from the fixed catalog and that the same hidden challenge was
          completed without learning the challenge itself or the player&apos;s hole cards.
        </p>
        <p>
          Once the server accepts the completion proof, it publishes a receipt at
          <code> /proof/&lt;nullifier&gt;</code>. Anyone can open that page and verify the proof again in
          their own browser.
        </p>
      </section>

      <section className="motivation-plain-section motivation-limitations">
        <h2>Limitations</h2>
        <p>
          The server still sees the cards while a hand is being played, and it can abort before a hand
          settles. The deal audit protects the choice of the completed deck; it is not a mental-poker
          protocol that hides cards from the server.
        </p>
        <p>
          Challenge completion is currently proved against six hand facts committed by the server.
          The challenge stays private, but fully independent reconstruction of those facts still needs a
          public action transcript.
        </p>
        <Link href="/protocol">Protocol details →</Link>
      </section>
    </main>
  );
}
