import { ProtocolDemo } from "@/components/protocol-demo";
import { SiteHeader } from "@/components/site-header";

export default function ProtocolPage() {
  return (
    <main className="site-shell protocol-page">
      <SiteHeader compact />

      <header className="protocol-hero">
        <h1>Protocol and verification.</h1>
        <p>
          Every settled hand has a public deal audit. Every bounty award has a zero-knowledge
          receipt. Both can be checked independently in the browser or from the command line.
        </p>
      </header>

      <section className="protocol-section">
        <div className="protocol-copy">
          <h2>Why it matters</h2>
          <p>
            Server-authoritative poker usually requires players to trust the backend shuffle. Noir
            Poker commits the server&apos;s randomness before player entropy is known. After settlement,
            the complete transcript is revealed and the deck can be reconstructed exactly.
          </p>
          <p>
            Bounties use a separate Noir proof. A verifier can confirm that a hidden objective came
            from the fixed catalog and was completed using the recorded hand facts while the
            objective remains private.
          </p>
        </div>
      </section>

      <section className="protocol-section" id="deals">
        <div className="protocol-copy">
          <h2>Deal protocol</h2>
          <p>
            For room <code>R</code> and hand <code>h</code>, the server samples a 32-byte secret
            <code> S</code> and durably stores
            <code> SHA256(&quot;NPDEAL01&quot; || R || u64_be(h) || S)</code> before player shares are
            accepted.
          </p>
          <p>
            Seat <code>i</code> samples a fresh 32-byte share <code>E_i</code> with the browser
            cryptographic RNG. The final seed is
            <code>
              SHA256(&quot;NPSEED01&quot; || R || u64_be(h) || player_count || ordered(u8(i), E_i) || S)
            </code>
            . Seat indices are encoded explicitly, so changing share order changes the seed.
          </p>
          <p>
            Card ids 0 through 51 use suit-major order: clubs, diamonds, hearts, spades; each suit
            contains ranks 2 through ace. Fisher–Yates consumes 32-bit words from
            <code> SHA256(&quot;NPSTRM01&quot; || seed || u64_be(counter))</code>. Rejection sampling removes
            modulo bias. Hole cards are dealt in two clockwise rounds starting left of the dealer,
            followed by burn, flop, burn, turn, burn, river.
          </p>

          <ProtocolDemo />

          <div className="protocol-facts">
            <article>
              <span>Before the hand</span>
              <strong>Server commitment and contribution count</strong>
            </article>
            <article>
              <span>During the hand</span>
              <strong>Secret, shares and final seed stay sealed</strong>
            </article>
            <article>
              <span>After settlement</span>
              <strong>Secret, ordered shares, seed and all 52 positions</strong>
            </article>
          </div>

          <p>
            If at least one player share is unpredictable and comes from a non-colluding player, the
            server cannot choose the completed seed after seeing all player entropy without breaking
            its earlier commitment.
          </p>
        </div>
      </section>

      <section className="protocol-section" id="bounties">
        <div className="protocol-copy">
          <h2>Private bounty protocol</h2>
          <p>
            The browser commits to a private 32-byte secret before the server returns its nonce. The
            selector hashes the hand tag, seat, nonce and secret, then uses the low three bits to
            choose one of eight objective leaves. A private three-level Merkle path proves that the
            selected objective belongs to the published catalog root.
          </p>

          <div className="circuit-statement">
            <div>
              <span>Public inputs</span>
              <code>mode hand_tag seat commitment nonce facts_hash nullifier catalog_root</code>
            </div>
            <div>
              <span>Private witness</span>
              <code>secret facts_salt six hand facts objective literals Merkle siblings</code>
            </div>
          </div>

          <p>
            Draw mode proves fair objective selection before the next hand starts. Completion mode
            proves that the same hidden objective is satisfied by the server-bound facts commitment.
            The six facts are: saw flop, raised preflop, called preflop, checked flop, reached
            showdown and net profit.
          </p>
          <p>
            NoirJS executes the circuit in the browser. Barretenberg generates an UltraHonk proof.
            The Rust server verifies the proof and exact public inputs before awarding 20 proof
            points. The public receipt viewer runs the same proof verification again in the visitor&apos;s
            browser.
          </p>

          <dl className="protocol-stack">
            <div><dt>Circuit</dt><dd>Noir 1.0.0-beta.26</dd></div>
            <div><dt>Proof system</dt><dd>UltraHonk</dd></div>
            <div><dt>Backend</dt><dd>Barretenberg 5.2.0</dd></div>
            <div><dt>Deal hash</dt><dd>SHA-256</dd></div>
            <div><dt>Bounty hash</dt><dd>BLAKE2s-256</dd></div>
            <div><dt>Circuit artifact</dt><dd>1c89fb88ae0fb02558efa61de73260f871b323cba2a8a3d7c6423a302237bd5d</dd></div>
            <div><dt>Verification key</dt><dd>b435db9d240683e181d8bad47203bf85d57ca27982bc676cf2686b5cf3de1d67</dd></div>
          </dl>
        </div>
      </section>

      <section className="protocol-section" id="verify">
        <div className="protocol-copy verifier-commands">
          <h2>Verify it yourself</h2>

          <h3>Settled hand</h3>
          <p>
            Open <code>/audit/&lt;room&gt;/&lt;hand&gt;</code>. The browser checks the server commitment
            opening, ordered player shares, derived seed, complete 52-card permutation, both hole-card
            rounds, all three burns and the five board positions.
          </p>
          <code>npm --prefix apps/web run deal:verify -- audit.json</code>

          <h3>Bounty award</h3>
          <p>
            Open <code>/proof/&lt;nullifier&gt;</code>. The browser verifies both UltraHonk proofs and
            checks that draw and completion use the same hand tag, seat, commitment, nonce and catalog
            root. It also checks the completion facts hash, nullifier and 20-point award binding.
          </p>
          <code>npm --prefix apps/web run proof:verify -- receipt.json</code>

          <p>
            The proof establishes the hidden objective statement. PostgreSQL separately enforces one
            accepted claim per nullifier and persists the awarded points.
          </p>
        </div>
      </section>

      <section className="protocol-section">
        <div className="protocol-copy">
          <h2>Security limits</h2>
          <ul className="protocol-list">
            <li>The authoritative server sees every card during play.</li>
            <li>The server can abort a ceremony before a completed transcript is published.</li>
            <li>The deal guarantee requires one unpredictable non-colluding player contribution.</li>
            <li>Full server and player collusion defeats the honest-contribution assumption.</li>
          </ul>
        </div>
      </section>
    </main>
  );
}
