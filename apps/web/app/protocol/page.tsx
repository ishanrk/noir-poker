import { ProtocolDemo } from "@/components/protocol-demo";
import { SiteHeader } from "@/components/site-header";

export default function ProtocolPage() {
  return (
    <main className="site-shell protocol-page protocol-page-new">
      <SiteHeader compact />

      <header className="protocol-hero protocol-hero-new">
        <p className="protocol-kicker">Protocol</p>
        <h1>Everything a player can verify.</h1>
        <p>
          The deck audit and challenge proof are public. The exact constructions are below for anyone
          who wants to reproduce them from source.
        </p>
      </header>

      <section className="verify-board" aria-label="Available verification">
        <article>
          <span>Deal audit</span>
          <h2>Rebuild the complete hand.</h2>
          <p>
            Open <code>/audit/&lt;room&gt;/&lt;hand&gt;</code>. The browser checks the server commitment,
            player randomness, final seed, all 52 shuffle positions, hole cards, burns and board.
          </p>
          <code>npm --prefix apps/web run deal:verify -- audit.json</code>
        </article>
        <article>
          <span>Challenge receipt</span>
          <h2>Verify selection and completion.</h2>
          <p>
            Open <code>/proof/&lt;nullifier&gt;</code>. The browser checks both UltraHonk proofs while the
            challenge, player secret and hole cards remain private.
          </p>
          <code>npm --prefix apps/web run proof:verify -- receipt.json</code>
        </article>
      </section>

      <section className="protocol-demo-wrap" aria-label="Interactive deal construction">
        <div className="protocol-demo-intro">
          <h2>Deal construction</h2>
          <p>Click through the same deterministic steps used by the Rust server and browser verifier.</p>
        </div>
        <ProtocolDemo />
      </section>

      <section className="protocol-details-list">
        <details className="protocol-detail" open>
          <summary>
            <span>Deal generation</span>
            <strong>commitment, player randomness, SHA 256 stream, Fisher Yates</strong>
          </summary>
          <div className="protocol-detail-body">
            <h3>Server commitment</h3>
            <p>
              For room <code>R</code> and hand <code>h</code>, the server samples a 32 byte secret
              <code>S</code> and persists this commitment before player randomness is accepted.
            </p>
            <code className="protocol-formula">SHA256(&quot;NPDEAL01&quot; || R[16] || u64_be(h) || S[32])</code>

            <h3>Player randomness</h3>
            <p>
              Every occupied seat samples a fresh 32 byte value with the browser cryptographic random
              generator. Seat order is encoded into the final seed input.
            </p>
            <code className="protocol-formula">
              SHA256(&quot;NPSEED01&quot; || R || u64_be(h) || player_count || seat_0 || share_0 || ... || S)
            </code>

            <h3>Shuffle</h3>
            <p>
              Card ids 0 through 51 use suit major order. SHA 256 counter blocks produce 32 bit words.
              Rejection sampling removes modulo bias before each Fisher Yates swap.
            </p>
            <code className="protocol-formula">SHA256(&quot;NPSTRM01&quot; || seed || u64_be(counter))</code>

            <h3>Deal map</h3>
            <p>
              Hole cards are dealt in two clockwise rounds beginning left of the dealer. The remaining
              positions are burn, flop, burn, turn, burn, river.
            </p>
          </div>
        </details>

        <details className="protocol-detail" id="challenge">
          <summary>
            <span>Challenge selection</span>
            <strong>private secret, server randomness, fixed eight challenge catalog</strong>
          </summary>
          <div className="protocol-detail-body">
            <p>
              The browser first commits to a private 32 byte secret. The server persists that
              commitment, then returns fresh randomness. The two values select one challenge from the
              fixed eight leaf Merkle catalog.
            </p>
            <code className="protocol-formula">
              commitment = BLAKE2s(&quot;NPCOMM02&quot; || hand_tag || seat || secret)
            </code>
            <code className="protocol-formula">
              selector = BLAKE2s(&quot;NPSELE02&quot; || hand_tag || seat || nonce || secret)
            </code>
            <p>
              The draw proof shows that the committed secret produced the hidden catalog leaf and that
              the leaf belongs to the published Merkle root. The challenge itself is not public.
            </p>
          </div>
        </details>

        <details className="protocol-detail">
          <summary>
            <span>Challenge completion</span>
            <strong>same hidden challenge, committed hand facts, one time claim</strong>
          </summary>
          <div className="protocol-detail-body">
            <p>The server commits six Boolean hand facts after settlement:</p>
            <ul className="protocol-list">
              <li>saw the flop</li>
              <li>raised before the flop</li>
              <li>called before the flop</li>
              <li>checked on the flop</li>
              <li>reached showdown</li>
              <li>finished with a net profit</li>
            </ul>
            <code className="protocol-formula">
              facts_hash = BLAKE2s(&quot;NPFACT02&quot; || hand_tag || seat || facts_salt || facts[6])
            </code>
            <code className="protocol-formula">
              nullifier = BLAKE2s(&quot;NPNULL02&quot; || hand_tag || seat || secret)
            </code>
            <p>
              Completion mode proves that the same hidden challenge is satisfied by those committed
              facts. A valid claim awards 20 proof points. The nullifier prevents a second claim.
            </p>
          </div>
        </details>

        <details className="protocol-detail">
          <summary>
            <span>Noir and UltraHonk</span>
            <strong>circuit source, public inputs, private witness, browser verifier</strong>
          </summary>
          <div className="protocol-detail-body">
            <p>
              The circuit is <code>circuits/challenge-v2/src/main.nr</code>. Nargo 1.0.0 beta 26
              compiles it. NoirJS builds the witness. Barretenberg 5.2.0 generates and verifies the
              UltraHonk proof in the browser.
            </p>
            <div className="circuit-statement">
              <div>
                <span>Public inputs</span>
                <code>mode hand_tag seat commitment nonce facts_hash nullifier catalog_root</code>
              </div>
              <div>
                <span>Private witness</span>
                <code>secret facts_salt facts must_true must_false Merkle siblings</code>
              </div>
            </div>
            <dl className="protocol-stack">
              <div><dt>Proof system</dt><dd>UltraHonk</dd></div>
              <div><dt>Noir</dt><dd>1.0.0 beta 26</dd></div>
              <div><dt>Barretenberg</dt><dd>5.2.0</dd></div>
              <div><dt>Circuit artifact SHA 256</dt><dd>1c89fb88ae0fb02558efa61de73260f871b323cba2a8a3d7c6423a302237bd5d</dd></div>
              <div><dt>Verification key SHA 256</dt><dd>b435db9d240683e181d8bad47203bf85d57ca27982bc676cf2686b5cf3de1d67</dd></div>
            </dl>
          </div>
        </details>

        <details className="protocol-detail protocol-limit-detail">
          <summary>
            <span>Security limits</span>
            <strong>server card visibility, aborts, challenge fact derivation</strong>
          </summary>
          <div className="protocol-detail-body">
            <p>
              The server still sees cards during play and can abort before a hand settles. Deal
              selection is protected when at least one player contributes unpredictable randomness.
            </p>
            <p>
              Challenge completion is currently proven against hand facts committed by the server.
              The challenge and hole cards stay private, but fully server independent challenge
              verification still needs a public action transcript that reconstructs those facts.
            </p>
          </div>
        </details>
      </section>
    </main>
  );
}
