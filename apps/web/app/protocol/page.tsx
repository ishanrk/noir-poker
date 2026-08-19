import { ChallengeProofDemo } from "@/components/challenge-proof-demo";
import { ProtocolDemo } from "@/components/protocol-demo";
import { SiteHeader } from "@/components/site-header";

export default function ProtocolPage() {
  return (
    <main className="site-shell protocol-page protocol-page-new">
      <SiteHeader compact />

      <header className="protocol-hero protocol-hero-new">
        <p className="protocol-kicker">Protocol</p>
        <h1>Verify the deck. Verify a challenge.</h1>
        <p>Start with the public verifier. Open the technical construction only if you need it.</p>
      </header>

      <section className="verify-board" aria-label="Available verification">
        <article>
          <span>Deal audit</span>
          <h2>Rebuild all 52 card positions.</h2>
          <p>
            Open <code>/audit/&lt;room&gt;/&lt;hand&gt;</code>. The browser checks the server commitment,
            player randomness, final seed, shuffle, hole cards, burns and board.
          </p>
          <p><strong>Download:</strong> choose Export JSON on the audit page.</p>
          <code>npm --prefix apps/web run deal:verify -- audit.json</code>
        </article>
        <article>
          <span>Challenge receipt</span>
          <h2>Verify selection and completion.</h2>
          <p>
            Open <code>/proof/&lt;nullifier&gt;</code>. The browser verifies both UltraHonk proofs while the
            challenge and hole cards remain private.
          </p>
          <p><strong>Download:</strong> choose Export JSON on the receipt page.</p>
          <code>npm --prefix apps/web run proof:verify -- receipt.json</code>
        </article>
      </section>

      <section className="protocol-demo-wrap protocol-two-demos" aria-label="Interactive protocol demos">
        <div className="protocol-demo-panel">
          <div className="protocol-demo-intro">
            <h2>Deal construction</h2>
            <p>Click through the exact public sequence.</p>
          </div>
          <ProtocolDemo />
        </div>
        <div className="protocol-demo-panel">
          <div className="protocol-demo-intro">
            <h2>Challenge proof</h2>
            <p>Move from a hidden challenge to a public result.</p>
          </div>
          <ChallengeProofDemo />
        </div>
      </section>

      <section className="protocol-details-list">
        <details className="protocol-detail" open>
          <summary>
            <span>Deal generation</span>
            <strong>commitment, player randomness, SHA 256, Fisher Yates</strong>
          </summary>
          <div className="protocol-detail-body">
            <h3>Server commitment</h3>
            <p>The server persists this value before player randomness is accepted.</p>
            <code className="protocol-formula">SHA256(&quot;NPDEAL01&quot; || room[16] || u64_be(hand) || secret[32])</code>

            <h3>Final seed</h3>
            <p>Every occupied seat adds a fresh 32 byte random value in fixed seat order.</p>
            <code className="protocol-formula">
              SHA256(&quot;NPSEED01&quot; || room || hand || player_count || seat_0 || share_0 || ... || secret)
            </code>

            <h3>Shuffle and deal</h3>
            <p>
              SHA 256 counter output feeds rejection sampling and Fisher Yates. Hole cards are dealt
              in two clockwise rounds, followed by burn, flop, burn, turn, burn, river.
            </p>
          </div>
        </details>

        <details className="protocol-detail" id="challenge">
          <summary>
            <span>Challenge selection</span>
            <strong>private browser secret, server randomness, fixed eight challenge catalog</strong>
          </summary>
          <div className="protocol-detail-body">
            <p>
              The browser commits to a private secret first. The server then returns fresh randomness.
              Together they select one of eight fixed challenge leaves.
            </p>
            <code className="protocol-formula">
              commitment = BLAKE2s(&quot;NPCOMM02&quot; || hand_tag || seat || secret)
            </code>
            <code className="protocol-formula">
              selector = BLAKE2s(&quot;NPSELE02&quot; || hand_tag || seat || nonce || secret)
            </code>
            <p>
              The draw proof shows that this hidden leaf came from the published challenge catalog.
              Examples include see the flop, raise before the flop, reach showdown and finish ahead.
            </p>
          </div>
        </details>

        <details className="protocol-detail">
          <summary>
            <span>Challenge completion</span>
            <strong>same hidden challenge, committed hand facts, one claim</strong>
          </summary>
          <div className="protocol-detail-body">
            <p>The circuit can use six hand facts:</p>
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
              A valid completion proof awards 20 proof points. The nullifier prevents the same
              challenge from being claimed twice.
            </p>
          </div>
        </details>

        <details className="protocol-detail">
          <summary>
            <span>Noir and UltraHonk</span>
            <strong>circuit source, witness, proof, browser verification</strong>
          </summary>
          <div className="protocol-detail-body">
            <p>
              The circuit is <code>circuits/challenge-v2/src/main.nr</code>. Nargo 1.0.0 beta 26
              compiles it. NoirJS builds the witness. Barretenberg 5.2.0 generates and verifies the
              UltraHonk proof.
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
              The server still sees cards during play and can abort before settlement. Deal selection
              is protected when at least one player contributes unpredictable randomness.
            </p>
            <p>
              Challenge completion is currently proven against hand facts committed by the server.
              Full server independent reconstruction of those facts still needs a public action transcript.
            </p>
          </div>
        </details>
      </section>
    </main>
  );
}
