import { ChallengeProofDemo } from "@/components/challenge-proof-demo";
import { ProtocolDemo } from "@/components/protocol-demo";
import { SiteHeader } from "@/components/site-header";

const FACTS = [
  "saw the flop",
  "raised before the flop",
  "called before the flop",
  "checked on the flop",
  "reached showdown",
  "finished with a net profit",
] as const;

const CHALLENGE_EXAMPLES = [
  "See the flop",
  "Raise before the flop",
  "Reach showdown",
  "Finish the hand ahead",
  "Raise before the flop and finish ahead",
] as const;

export default function ProtocolPage() {
  return (
    <main className="site-shell protocol-page protocol-page-explicit">
      <SiteHeader compact />

      <header className="protocol-hero protocol-hero-explicit">
        <p className="protocol-kicker">Protocol</p>
        <h1>Two verification systems, one game.</h1>
        <p>
          Deal fairness uses commitments and deterministic replay. Private challenges use a Noir
          circuit proved with UltraHonk. They solve different trust problems and can be checked
          independently.
        </p>
      </header>

      <section className="protocol-zk-stack" aria-labelledby="zk-stack-title">
        <div className="protocol-zk-intro">
          <p className="protocol-kicker">Zero knowledge stack</p>
          <h2 id="zk-stack-title">Noir defines the statement. UltraHonk proves it.</h2>
          <p>
            Noir is the circuit language, not the proof system. The browser executes the compiled
            Noir circuit to obtain a witness. Barretenberg then uses the UltraHonk proving system to
            turn that witness into a zero knowledge proof. A verifier checks the proof without
            receiving the private witness.
          </p>
        </div>
        <div className="zk-pipeline" aria-label="Zero knowledge proof pipeline">
          <article>
            <span>Noir</span>
            <strong>Constraint program</strong>
            <p><code>circuits/challenge-v2/src/main.nr</code></p>
          </article>
          <i aria-hidden="true">→</i>
          <article>
            <span>NoirJS</span>
            <strong>Witness generation</strong>
            <p>Executes public and private circuit inputs in the player&apos;s browser.</p>
          </article>
          <i aria-hidden="true">→</i>
          <article>
            <span>Barretenberg</span>
            <strong>UltraHonk proof</strong>
            <p>Generates the proof from the compiled circuit and witness.</p>
          </article>
          <i aria-hidden="true">→</i>
          <article>
            <span>Verifier</span>
            <strong>Browser or server</strong>
            <p>Checks the proof against the same circuit without learning the private values.</p>
          </article>
        </div>
        <div className="zk-version-line">
          <span>Noir 1.0.0 beta 26</span>
          <span>Barretenberg 5.2.0</span>
          <span>UltraHonk</span>
          <span>194 public field elements</span>
        </div>
      </section>

      <section className="verify-board" aria-label="Available verification">
        <article>
          <span>Deal audit</span>
          <h2>Rebuild the complete hand.</h2>
          <p>
            Open <code>/audit/&lt;room&gt;/&lt;hand&gt;</code>. The browser recomputes the server
            commitment, combines the player randomness, regenerates the shuffle and checks every
            dealt position.
          </p>
          <p><strong>Download:</strong> Export JSON on the audit page.</p>
          <code>npm --prefix apps/web run deal:verify -- audit.json</code>
        </article>
        <article>
          <span>Challenge receipt</span>
          <h2>Verify assignment and completion.</h2>
          <p>
            Open <code>/proof/&lt;nullifier&gt;</code>. The browser checks two UltraHonk proofs: one
            for private challenge assignment and one for completion of that same hidden challenge.
          </p>
          <p><strong>Download:</strong> Export JSON on the receipt page.</p>
          <code>npm --prefix apps/web run proof:verify -- receipt.json</code>
        </article>
      </section>

      <section className="protocol-demo-wrap protocol-two-demos" aria-label="Interactive protocol demos">
        <div className="protocol-demo-panel">
          <div className="protocol-demo-intro">
            <h2>Deal fairness</h2>
            <p>Click through the exact sequence that fixes and later reconstructs the deck.</p>
          </div>
          <ProtocolDemo />
        </div>
        <div className="protocol-demo-panel">
          <div className="protocol-demo-intro">
            <h2>Challenge proof</h2>
            <p>Follow one hidden challenge from commitment to a public verification result.</p>
          </div>
          <ChallengeProofDemo />
        </div>
      </section>

      <section className="protocol-details-list protocol-details-explicit">
        <details className="protocol-detail" open>
          <summary>
            <span>Deal generation</span>
            <strong>Fix the server contribution first, then mix in player randomness.</strong>
          </summary>
          <div className="protocol-detail-body">
            <p className="protocol-callout">
              This part is not zero knowledge. Its purpose is to make the completed deck independently
              reproducible after the hand.
            </p>

            <h3>First: the server commits before seeing player randomness</h3>
            <p>
              The server samples a fresh 32 byte secret <code>S</code>. Before it accepts any player
              random values, it stores and publishes a SHA 256 commitment to <code>S</code>, the room
              id and the hand number.
            </p>
            <code className="protocol-formula">
              C = SHA256(&quot;NPDEAL01&quot; || room[16] || u64_be(hand) || S[32])
            </code>
            <p>
              Once <code>C</code> is fixed, the server cannot later replace <code>S</code> with a
              different secret without changing the commitment.
            </p>

            <h3>Then: every occupied seat adds 32 random bytes</h3>
            <p>
              Each browser generates its own 32 byte value after the server commitment already
              exists. The final seed includes the room, hand number, player count, every seat number,
              every player value in seat order and the committed server secret.
            </p>
            <code className="protocol-formula">
              seed = SHA256(&quot;NPSEED01&quot; || room || hand || player_count || seat_0 || share_0 || ... || S)
            </code>

            <h3>Next: the seed deterministically creates one 52 card permutation</h3>
            <p>
              The protocol starts from one fixed 52 card ordering. SHA 256 counter blocks generate
              32 bit words. Rejection sampling discards words that would introduce modulo bias. The
              accepted values drive Fisher Yates swaps, so the same seed always produces the same
              permutation in Rust, TypeScript and the standalone verifier.
            </p>
            <code className="protocol-formula">
              block_i = SHA256(&quot;NPSTRM01&quot; || seed || u64_be(counter_i))
            </code>

            <h3>Finally: dealing consumes fixed positions from that permutation</h3>
            <p>
              Hole cards are dealt in two clockwise rounds beginning left of the dealer. The next
              positions are consumed as burn, flop, burn, turn, burn, river. After settlement the
              server secret and player random values are revealed, so anyone can recompute the entire
              hand from the beginning.
            </p>
          </div>
        </details>

        <details className="protocol-detail" id="challenge">
          <summary>
            <span>Challenge assignment proof</span>
            <strong>Prove one of eight fixed challenges was selected without revealing which one.</strong>
          </summary>
          <div className="protocol-detail-body">
            <p className="protocol-callout">
              This is the first UltraHonk proof. The player proves that a private challenge came from
              the fixed catalog and was selected from randomness that neither side controlled alone.
            </p>

            <h3>The challenge catalog is eight explicit definitions</h3>
            <p>
              The current catalog contains challenges such as {CHALLENGE_EXAMPLES.join(", ")}. Each
              definition is encoded by its catalog index plus two six bit masks: conditions that must
              be true and conditions that must be false.
            </p>
            <div className="challenge-mask-example">
              <span>Reach showdown</span>
              <code>must_true = [0,0,0,0,1,0]</code>
              <code>must_false = [0,0,0,0,0,0]</code>
            </div>

            <h3>The browser commits to a secret before server randomness arrives</h3>
            <p>
              The browser chooses a private 32 byte secret. It sends only a BLAKE2s commitment. The
              server stores that commitment and then returns a fresh public 32 byte nonce.
            </p>
            <code className="protocol-formula">
              commitment = BLAKE2s(&quot;NPCOMM02&quot; || hand_tag || seat || secret)
            </code>

            <h3>The secret and server nonce select the challenge index</h3>
            <p>
              The browser hashes the hand id, seat, server nonce and private secret. The low three
              bits select an integer from 0 to 7. Because the browser committed before seeing the
              nonce and the server does not know the browser secret, neither side gets to simply pick
              the resulting challenge after seeing the other side&apos;s value.
            </p>
            <code className="protocol-formula">
              selector = BLAKE2s(&quot;NPSELE02&quot; || hand_tag || seat || nonce || secret)
            </code>
            <code className="protocol-formula">challenge_index = selector[0] &amp; 7</code>

            <h3>The Merkle tree binds that hidden definition to the fixed catalog</h3>
            <p>
              Each of the eight challenge definitions is serialized and hashed once. That hash is a
              Merkle leaf. The eight leaf hashes form a depth three Merkle tree with one public root.
              The chosen definition and its three sibling hashes stay private inside the proof. The
              circuit recomputes the path and requires the result to equal the public catalog root.
            </p>
            <code className="protocol-formula">
              challenge_hash = BLAKE2s(&quot;NPLEAF02&quot; || index || must_true[6] || must_false[6])
            </code>

            <div className="protocol-public-private">
              <article>
                <h4>Public to the verifier</h4>
                <p>hand tag, seat, commitment, server nonce, catalog root, proof mode</p>
              </article>
              <article>
                <h4>Private witness</h4>
                <p>browser secret, selected challenge masks, three Merkle sibling hashes</p>
              </article>
            </div>

            <h3>The Noir circuit checks all four statements together</h3>
            <ol className="protocol-checklist">
              <li>the private secret opens the published commitment</li>
              <li>that secret and the public nonce produce the claimed hidden index</li>
              <li>the private challenge definition hashes to that same index</li>
              <li>the private Merkle path reaches the published catalog root</li>
            </ol>
          </div>
        </details>

        <details className="protocol-detail">
          <summary>
            <span>Challenge completion proof</span>
            <strong>Prove that the same hidden challenge was satisfied after the hand.</strong>
          </summary>
          <div className="protocol-detail-body">
            <p className="protocol-callout">
              This is the second UltraHonk proof. It reuses the same secret, server nonce and hidden
              challenge definition from assignment, then additionally proves that the challenge&apos;s
              required hand conditions are satisfied.
            </p>

            <h3>The current circuit reduces a settled hand to six Boolean facts</h3>
            <ul className="protocol-list protocol-fact-list">
              {FACTS.map((fact, index) => (
                <li key={fact}>
                  <code>fact[{index}]</code> {fact}
                </li>
              ))}
            </ul>

            <h3>The fact vector is hidden behind a public commitment</h3>
            <p>
              The browser proves knowledge of the six private bits and a private random salt that
              reproduce the public <code>facts_hash</code>.
            </p>
            <code className="protocol-formula">
              facts_hash = BLAKE2s(&quot;NPFACT02&quot; || hand_tag || seat || facts_salt || facts[6])
            </code>

            <h3>The circuit checks the hidden challenge against those hidden facts</h3>
            <p>
              For every position, a <code>must_true</code> bit requires the corresponding fact to be
              1 and a <code>must_false</code> bit requires it to be 0. The challenge masks are the same
              private definition whose Merkle membership was checked above.
            </p>

            <h3>A nullifier makes the claim one time</h3>
            <code className="protocol-formula">
              nullifier = BLAKE2s(&quot;NPNULL02&quot; || hand_tag || seat || secret)
            </code>
            <p>
              The nullifier is public. PostgreSQL enforces uniqueness, so the same hidden challenge
              cannot be claimed twice.
            </p>

            <div className="protocol-public-private">
              <article>
                <h4>Public to the verifier</h4>
                <p>assignment bindings, facts hash, nullifier, catalog root and completion proof</p>
              </article>
              <article>
                <h4>Private witness</h4>
                <p>secret, challenge definition, Merkle path, six hand facts and fact salt</p>
              </article>
            </div>
          </div>
        </details>

        <details className="protocol-detail">
          <summary>
            <span>Proof generation and verification</span>
            <strong>Compiled Noir circuit → witness → UltraHonk proof → independent verification.</strong>
          </summary>
          <div className="protocol-detail-body">
            <h3>Compilation</h3>
            <p>
              <code>circuits/challenge-v2/src/main.nr</code> is compiled with Nargo 1.0.0 beta 26.
              The frontend loads the compiled <code>challenge_v2.json</code> circuit artifact.
            </p>

            <h3>Witness generation in the player&apos;s browser</h3>
            <p>
              NoirJS executes the circuit with the public inputs and private values. Execution
              produces the witness used by the prover. The private values are not added to the public
              receipt.
            </p>

            <h3>UltraHonk proof generation</h3>
            <p>
              The frontend creates a Barretenberg WASM worker and passes the compiled circuit bytecode
              plus witness to <code>UltraHonkBackend.generateProof</code> with verifier target
              <code>noir-recursive</code>. The resulting proof is stored together with 194 public field
              elements.
            </p>

            <h3>Independent browser verification</h3>
            <p>
              The public receipt page loads the pinned circuit artifact, decodes the two proof blobs
              and their public inputs, and calls <code>UltraHonkBackend.verifyProof</code> for the
              assignment proof and then the completion proof. No challenge definition or private fact
              vector is required by the verifier.
            </p>

            <h3>Receipt binding checks before cryptographic verification</h3>
            <ol className="protocol-checklist">
              <li>protocol version, circuit id, proof system and Barretenberg version match</li>
              <li>the circuit artifact SHA 256 and verification key SHA 256 match the pinned values</li>
              <li>the hand tag recomputes from room id and hand number</li>
              <li>the catalog root recomputes from the eight fixed challenge definitions</li>
              <li>assignment and completion public inputs bind the same hand, seat, commitment, nonce and root</li>
              <li>both UltraHonk proofs verify</li>
            </ol>

            <dl className="protocol-stack protocol-stack-explicit">
              <div><dt>Circuit</dt><dd>challenge_v2</dd></div>
              <div><dt>Circuit language</dt><dd>Noir 1.0.0 beta 26</dd></div>
              <div><dt>Proof system</dt><dd>UltraHonk</dd></div>
              <div><dt>Prover and verifier</dt><dd>Barretenberg 5.2.0</dd></div>
              <div><dt>Browser execution</dt><dd>NoirJS + bb.js WASM worker</dd></div>
              <div><dt>Public fields</dt><dd>194</dd></div>
              <div><dt>Circuit artifact SHA 256</dt><dd>1c89fb88ae0fb02558efa61de73260f871b323cba2a8a3d7c6423a302237bd5d</dd></div>
              <div><dt>Verification key SHA 256</dt><dd>b435db9d240683e181d8bad47203bf85d57ca27982bc676cf2686b5cf3de1d67</dd></div>
            </dl>
          </div>
        </details>

        <details className="protocol-detail protocol-limit-detail">
          <summary>
            <span>Current security boundary</span>
            <strong>Exact guarantees and the remaining server trust.</strong>
          </summary>
          <div className="protocol-detail-body">
            <p>
              The deal transcript lets anyone verify the completed shuffle after settlement, assuming
              at least one player contributed unpredictable randomness. The server still sees cards
              during play and can abort before settlement.
            </p>
            <p>
              The challenge proofs keep the challenge and private fact vector hidden and prove the
              circuit statement above. The current six hand facts are still derived and committed by
              the server. Full server independent verification of those fact values requires a public
              action transcript that reconstructs them.
            </p>
          </div>
        </details>
      </section>
    </main>
  );
}
