import { SiteHeader } from "@/components/site-header";

export default function ProtocolPage() {
  return (
    <main className="site-shell protocol-page">
      <SiteHeader compact />

      <header className="protocol-hero">
        <h1>Protocol</h1>
        <p>Exact artifacts, constructions, circuit inputs and verifier steps used by Noir Poker.</p>
      </header>

      <section className="protocol-section" id="verification">
        <div className="protocol-copy">
          <h2>Available verification</h2>
          <div className="protocol-artifacts">
            <article>
              <h3>Settled deal audit</h3>
              <code>/audit/&lt;room&gt;/&lt;hand&gt;</code>
              <p>
                The browser verifies the server commitment opening, ordered player entropy, final
                seed, all Fisher Yates swaps, both hole card rounds, three burn cards and the five
                board cards.
              </p>
              <p>The audit can be exported as JSON and checked with the source controlled verifier.</p>
              <code>npm --prefix apps/web run deal:verify -- audit.json</code>
            </article>
            <article>
              <h3>Bounty receipt</h3>
              <code>/proof/&lt;nullifier&gt;</code>
              <p>
                The browser verifies the draw proof and completion proof with the pinned Noir circuit
                artifact and Barretenberg. The hidden challenge and private witness stay absent from
                the receipt.
              </p>
              <p>The receipt can be exported as JSON and verified from the command line.</p>
              <code>npm --prefix apps/web run proof:verify -- receipt.json</code>
            </article>
          </div>
        </div>
      </section>

      <section className="protocol-section" id="deals">
        <div className="protocol-copy">
          <h2>Deal integrity protocol</h2>
          <p>
            Deck generation uses SHA 256 commitments and deterministic public replay. Noir is used
            for the challenge system.
          </p>

          <h3>1. Server commitment</h3>
          <p>
            For room <code>R</code> and hand number <code>h</code>, the server samples a 32 byte secret
            <code>S</code> and persists the commitment before player shares are accepted.
          </p>
          <code className="protocol-formula">
            SHA256(&quot;NPDEAL01&quot; || R[16] || u64_be(h) || S[32])
          </code>

          <h3>2. Player entropy</h3>
          <p>
            Every occupied seat samples a fresh 32 byte value with the browser cryptographic random
            generator. Shares are ordered by seat. The seat byte is included in the seed input.
          </p>
          <code className="protocol-formula">
            SHA256(&quot;NPSEED01&quot; || R || u64_be(h) || player_count || seat_0 || share_0 || ... || S)
          </code>

          <h3>3. Shuffle</h3>
          <p>
            Card ids 0 through 51 use suit major order. Suits are clubs, diamonds, hearts, spades.
            Each suit contains ranks 2 through ace. The byte stream is generated from consecutive
            SHA 256 blocks.
          </p>
          <code className="protocol-formula">
            SHA256(&quot;NPSTRM01&quot; || seed || u64_be(counter))
          </code>
          <p>
            Each block is read as 32 bit unsigned words. For a Fisher Yates step with range size
            <code> n</code>, values at or above <code>floor(2^32 / n) * n</code> are rejected. The
            accepted word modulo <code>n</code> selects the swap position. This removes modulo bias.
          </p>

          <h3>4. Deal map</h3>
          <p>
            Hole cards are dealt in two clockwise rounds beginning left of the dealer. The remaining
            positions are consumed as burn, flop, burn, turn, burn, river.
          </p>

          <h3>5. Public audit</h3>
          <p>
            The server secret, ordered player shares, final seed and complete deck become available
            only after settlement. The browser recomputes the commitment, seed and permutation from
            those values. A mismatch invalidates the audit.
          </p>

          <div className="protocol-note">
            <strong>Guarantee</strong>
            <p>
              If at least one player contribution is unpredictable and noncolluding, the server
              cannot choose the completed hand seed after seeing all player shares without breaking
              its earlier commitment. The server still sees the cards during play and can abort a
              ceremony before settlement.
            </p>
          </div>
        </div>
      </section>

      <section className="protocol-section" id="challenge-draw">
        <div className="protocol-copy">
          <h2>Challenge selection proof</h2>
          <p>
            After a hand, each player prepares a private challenge for the next hand. The browser
            samples a private 32 byte secret. The server receives only a commitment to that secret,
            persists it, then returns a fresh 32 byte nonce.
          </p>

          <code className="protocol-formula">
            hand_tag = BLAKE2s(&quot;NPHAND02&quot; || room[16] || u64_be(hand))
          </code>
          <code className="protocol-formula">
            commitment = BLAKE2s(&quot;NPCOMM02&quot; || hand_tag || seat || secret)
          </code>
          <code className="protocol-formula">
            selector = BLAKE2s(&quot;NPSELE02&quot; || hand_tag || seat || nonce || secret)
          </code>
          <code className="protocol-formula">objective_index = selector[0] &amp; 7</code>

          <p>
            The eight challenge definitions are leaves in a fixed depth three Merkle tree. A leaf
            contains the selected index plus six required true bits and six required false bits. The
            leaf and internal nodes use BLAKE2s domain separators <code>NPLEAF02</code> and
            <code>NPNODE02</code>.
          </p>
          <p>
            Draw mode proves that the committed secret produces the selected index and that the
            hidden challenge leaf belongs to the published catalog root. In draw mode
            <code>facts_hash</code> and <code>nullifier</code> are both zero.
          </p>
        </div>
      </section>

      <section className="protocol-section" id="challenge-completion">
        <div className="protocol-copy">
          <h2>Challenge completion proof</h2>
          <p>The server derives six Boolean hand facts after settlement:</p>
          <ul className="protocol-list">
            <li>saw the flop</li>
            <li>raised before the flop</li>
            <li>called before the flop</li>
            <li>checked on the flop</li>
            <li>reached showdown</li>
            <li>finished with a net profit</li>
          </ul>

          <p>A fresh private salt hides the six bit fact vector inside a public commitment.</p>
          <code className="protocol-formula">
            facts_hash = BLAKE2s(&quot;NPFACT02&quot; || hand_tag || seat || facts_salt || facts[6])
          </code>
          <code className="protocol-formula">
            nullifier = BLAKE2s(&quot;NPNULL02&quot; || hand_tag || seat || secret)
          </code>

          <p>
            Completion mode checks the same secret commitment, selector and Merkle path used during
            draw mode. It then checks the private fact vector against <code>facts_hash</code>, applies
            the hidden challenge literals to those facts, and checks the nullifier. A successful
            claim awards 20 proof points. PostgreSQL enforces a unique nullifier.
          </p>

          <div className="protocol-note">
            <strong>Current boundary</strong>
            <p>
              The public receipt verifies challenge satisfaction against the server committed hand
              facts. The receipt does not currently reconstruct those six facts from a public action
              transcript. The zero knowledge layer therefore removes disclosure of the challenge,
              while full server independent verification of fact derivation still needs an additional
              public action audit.
            </p>
          </div>
        </div>
      </section>

      <section className="protocol-section" id="noir">
        <div className="protocol-copy">
          <h2>Noir and UltraHonk</h2>
          <p>
            The challenge circuit is written in Noir at
            <code> circuits/challenge-v2/src/main.nr</code>. Nargo 1.0.0 beta 26 compiles the program
            to the circuit artifact used by the browser. NoirJS executes the circuit inputs and
            produces the witness. Barretenberg 5.2.0 receives the circuit bytecode and witness and
            generates an UltraHonk proof in a WebAssembly worker.
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

          <p>
            The browser uses <code>UltraHonkBackend</code> with verifier target
            <code> noir-recursive</code>. The proof exposes 194 public field elements. The server uses
            <code>barretenberg-rs</code> with the pinned Barretenberg binary and verification key to
            verify the same proof before accepting a claim.
          </p>

          <dl className="protocol-stack">
            <div><dt>Circuit</dt><dd>challenge_v2</dd></div>
            <div><dt>Proof system</dt><dd>UltraHonk</dd></div>
            <div><dt>Noir</dt><dd>1.0.0 beta 26</dd></div>
            <div><dt>Barretenberg</dt><dd>5.2.0</dd></div>
            <div><dt>Public fields</dt><dd>194</dd></div>
            <div><dt>Maximum proof bytes</dt><dd>65,536</dd></div>
            <div><dt>Circuit artifact SHA 256</dt><dd>1c89fb88ae0fb02558efa61de73260f871b323cba2a8a3d7c6423a302237bd5d</dd></div>
            <div><dt>Verification key SHA 256</dt><dd>b435db9d240683e181d8bad47203bf85d57ca27982bc676cf2686b5cf3de1d67</dd></div>
          </dl>
        </div>
      </section>

      <section className="protocol-section" id="receipt-checks">
        <div className="protocol-copy">
          <h2>Bounty receipt checks</h2>
          <p>The browser performs these checks before displaying a verified receipt:</p>
          <ol className="protocol-list">
            <li>protocol version, proof system, circuit id and Barretenberg version match</li>
            <li>circuit artifact and verification key hashes match the pinned values</li>
            <li>the hand tag recomputes from room id and hand number</li>
            <li>the catalog root recomputes from the eight fixed challenge leaves</li>
            <li>draw and completion public inputs bind the same hand, seat, commitment, nonce and catalog root</li>
            <li>draw mode has zero facts hash and zero nullifier</li>
            <li>completion mode contains the receipt facts hash and nullifier</li>
            <li>both UltraHonk proofs verify locally</li>
            <li>the receipt award is exactly 20 proof points</li>
          </ol>
        </div>
      </section>
    </main>
  );
}
