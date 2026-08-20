import { ChallengeProofDemo } from "@/components/challenge-proof-demo";
import { ProtocolDemo } from "@/components/protocol-demo";
import { SiteHeader } from "@/components/site-header";

const NOIR_JS = "https://noir-lang.org/docs/reference/NoirJS/noir_js/classes/Noir";
const NOIR_PROVING = "https://noir-lang.org/docs/getting_started_manually";
const BARRETENBERG = "https://github.com/AztecProtocol/aztec-packages/tree/next/barretenberg";
const HYPERPLONK = "https://doi.org/10.1007/978-3-031-30617-4_17";
const REPO = "https://github.com/ishanrk/noir-poker/blob/main";

const FACTS = [
  "saw the flop",
  "raised before the flop",
  "called before the flop",
  "checked on the flop",
  "reached showdown",
  "finished with a net profit",
] as const;

export default function ProtocolPage() {
  return (
    <main className="site-shell protocol-page protocol-page-clear">
      <SiteHeader compact />

      <header className="protocol-clear-hero">
        <span>Protocol</span>
        <h1>How verification works</h1>
        <p>
          There are two checks: the deck was fixed fairly, and a private challenge was assigned and
          completed correctly.
        </p>
      </header>

      <section className="protocol-verify-first" aria-labelledby="verify-first-title">
        <header>
          <h2 id="verify-first-title">What you can verify yourself</h2>
          <p>Both verifiers run in the browser and both artifacts can be exported as JSON.</p>
        </header>
        <div>
          <article>
            <strong>Deal audit</strong>
            <em>Available after the hand settles</em>
            <code>/audit/&lt;room&gt;/&lt;hand&gt;</code>
            <p>
              Recomputes the server commitment, player randomness, final seed, 52 card shuffle and
              every dealt position. A mismatch makes the audit fail.
            </p>
            <p><b>Download:</b> choose Export JSON on that page.</p>
            <code>npm --prefix apps/web run deal:verify -- audit.json</code>
          </article>
          <article>
            <strong>Challenge receipt</strong>
            <em>Available after the server accepts a completion proof</em>
            <code>/proof/&lt;nullifier&gt;</code>
            <p>
              Verifies two UltraHonk proofs: the private challenge was assigned from the fixed
              catalog, and the same hidden challenge was completed.
            </p>
            <p><b>Download:</b> choose Export JSON on that page.</p>
            <code>npm --prefix apps/web run proof:verify -- receipt.json</code>
          </article>
        </div>
      </section>

      <section className="protocol-terms" aria-labelledby="protocol-terms-title">
        <header>
          <h2 id="protocol-terms-title">The ZK pieces used here</h2>
          <p>These names refer to different jobs in the proof pipeline.</p>
        </header>
        <div>
          <article>
            <h3>Commitment</h3>
            <p>
              A way to lock in a value before revealing it. Later you reveal the value and anyone can
              check it matches the earlier commitment; changing the value changes the commitment.
            </p>
          </article>
          <article>
            <h3>Noir</h3>
            <p>
              The language used to write the challenge constraints. The circuit says which public and
              private values must be related for a challenge proof to be valid.
            </p>
          </article>
          <article>
            <h3>Witness</h3>
            <p>
              The private values and intermediate values that satisfy the Noir circuit. In this game
              that includes the browser secret, hidden challenge definition and private hand facts.
            </p>
          </article>
          <article>
            <h3>UltraHonk</h3>
            <p>
              The zero knowledge proof system used by this project. It converts a satisfying witness
              into a compact proof that can be checked without giving the witness to the verifier.
            </p>
          </article>
          <article>
            <h3>Barretenberg and NoirJS</h3>
            <p>
              NoirJS executes the compiled Noir circuit to build the witness. Barretenberg, through
              bb.js, generates and verifies the UltraHonk proof in a browser WASM worker.
            </p>
          </article>
        </div>
      </section>

      <section className="program-proof-pipeline" aria-labelledby="pipeline-title">
        <header>
          <h2 id="pipeline-title">Where the poker program fits</h2>
          <p>The Rust game and the player browser provide different inputs to the same challenge proof.</p>
        </header>
        <div className="program-pipeline-row">
          <article>
            <span>Rust poker engine</span>
            <strong>Settles the hand</strong>
            <p>Produces the six hand facts and the public fact commitment.</p>
          </article>
          <i>+</i>
          <article>
            <span>Player browser</span>
            <strong>Holds the private challenge</strong>
            <p>Keeps the challenge secret, its selection secret and the private proof inputs.</p>
          </article>
          <i>→</i>
          <article>
            <span>NoirJS</span>
            <strong>Executes challenge_v2</strong>
            <p>Checks the Noir constraints locally and produces the witness.</p>
          </article>
          <i>→</i>
          <article>
            <span>Barretenberg</span>
            <strong>Generates UltraHonk</strong>
            <p>Turns that witness into the proof sent to the Rust server.</p>
          </article>
          <i>→</i>
          <article>
            <span>Rust server + public browser</span>
            <strong>Verify the same proof</strong>
            <p>The server verifies before awarding points; anyone can verify again from the receipt.</p>
          </article>
        </div>
      </section>

      <section className="protocol-demo-wrap protocol-two-demos" aria-label="Interactive protocol examples">
        <div className="protocol-demo-panel">
          <div className="protocol-demo-intro">
            <h2>Deal fairness</h2>
            <p>Click through the sequence that fixes the deck and later lets anyone rebuild it.</p>
          </div>
          <ProtocolDemo />
        </div>
        <div className="protocol-demo-panel">
          <div className="protocol-demo-intro">
            <h2>Challenge proof</h2>
            <p>Follow one hidden challenge from assignment to a public verification result.</p>
          </div>
          <ChallengeProofDemo />
        </div>
      </section>

      <section className="protocol-details-list protocol-details-clear">
        <details className="protocol-detail" open>
          <summary><span>Deal protocol</span><strong>How the server is prevented from choosing the final deck after player randomness arrives</strong></summary>
          <div className="protocol-detail-body">
            <h3>Server commitment</h3>
            <p>
              Before accepting player randomness, the server generates a fresh 32 byte secret
              <code> S</code> and publishes a SHA 256 commitment bound to the room and hand number.
            </p>
            <code className="protocol-formula">C = SHA256(&quot;NPDEAL01&quot; || room || hand || S)</code>
            <p>
              The commitment locks in the server&apos;s value. After player values arrive, replacing
              <code> S</code> would change <code>C</code> and fail the later audit.
            </p>

            <h3>Player randomness</h3>
            <p>
              Each joining browser calls <code>crypto.getRandomValues</code> to generate 32 random
              bytes. The player values, seat numbers and committed server secret are hashed together.
            </p>
            <code className="protocol-formula">seed = SHA256(&quot;NPSEED01&quot; || room || hand || seats || player_randomness || S)</code>

            <h3>Shuffle and deal</h3>
            <p>
              SHA 256 counter output drives rejection sampling and Fisher Yates over one canonical
              52 card ordering. The same seed therefore gives the same permutation in Rust, TypeScript
              and the standalone verifier. Hole cards, burns and board cards consume fixed positions
              from that permutation.
            </p>

            <h3>Public audit</h3>
            <p>
              After settlement the server secret and player values are revealed. The audit page reruns
              every step from the commitment through the final dealt positions.
            </p>
          </div>
        </details>

        <details className="protocol-detail" id="challenge">
          <summary><span>Challenge assignment proof</span><strong>How one hidden challenge is selected from the fixed catalog</strong></summary>
          <div className="protocol-detail-body">
            <h3>Browser secret first</h3>
            <p>
              Between hands, the player browser chooses a private 32 byte secret and sends only a
              BLAKE2s commitment to it. The server stores that commitment and then returns its own
              fresh public 32 byte random nonce.
            </p>
            <code className="protocol-formula">commitment = BLAKE2s(&quot;NPCOMM02&quot; || hand_tag || seat || secret)</code>

            <h3>Select one of eight challenges</h3>
            <p>
              The private secret and public server nonce are hashed together. The low three bits give
              an index from 0 to 7. The browser committed before seeing the nonce, while the server does
              not know the browser secret, so neither side can simply choose the result after seeing the
              other side&apos;s value.
            </p>
            <code className="protocol-formula">selector = BLAKE2s(&quot;NPSELE02&quot; || hand_tag || seat || nonce || secret)</code>
            <code className="protocol-formula">challenge_index = selector[0] &amp; 7</code>

            <h3>Prove the hidden challenge belongs to the catalog</h3>
            <p>
              Each challenge is encoded as an index plus six conditions that may need to be true and
              six conditions that may need to be false. The eight encoded challenge hashes are arranged
              in a small Merkle tree. The circuit receives the chosen definition and its three sibling
              hashes privately, recomputes the root, and requires it to equal the public catalog root.
            </p>

            <div className="protocol-public-private">
              <article><h4>Public</h4><p>hand tag, seat, browser commitment, server nonce, catalog root</p></article>
              <article><h4>Private</h4><p>browser secret, selected challenge definition, three Merkle sibling hashes</p></article>
            </div>
          </div>
        </details>

        <details className="protocol-detail">
          <summary><span>Challenge completion proof</span><strong>How the same hidden challenge is checked against the settled hand</strong></summary>
          <div className="protocol-detail-body">
            <h3>Six current hand facts</h3>
            <ul className="protocol-list protocol-fact-list">
              {FACTS.map((fact, index) => <li key={fact}><code>fact[{index}]</code> {fact}</li>)}
            </ul>

            <h3>Hide the facts behind a public hash</h3>
            <p>
              A private random salt and the six bits are hashed into <code>facts_hash</code>. The
              completion proof shows knowledge of private values that reproduce that public hash.
            </p>
            <code className="protocol-formula">facts_hash = BLAKE2s(&quot;NPFACT02&quot; || hand_tag || seat || facts_salt || facts[6])</code>

            <h3>Check the private challenge</h3>
            <p>
              The circuit rechecks the same secret commitment, challenge index and catalog membership
              used during assignment. It then applies the hidden challenge&apos;s required true and false
              conditions to the six private hand facts.
            </p>

            <h3>Prevent a second claim</h3>
            <code className="protocol-formula">nullifier = BLAKE2s(&quot;NPNULL02&quot; || hand_tag || seat || secret)</code>
            <p>The nullifier is public and unique in PostgreSQL, so the same challenge cannot award points twice.</p>
          </div>
        </details>

        <details className="protocol-detail">
          <summary><span>Proof generation and receipt verification</span><strong>The exact browser and server path for the two UltraHonk proofs</strong></summary>
          <div className="protocol-detail-body">
            <h3>Generate</h3>
            <p>
              Nargo 1.0.0 beta 26 compiles <code>circuits/challenge-v2/src/main.nr</code>. NoirJS runs
              the compiled circuit with its inputs and returns a witness. The frontend passes the
              circuit bytecode and witness to Barretenberg 5.2.0
              <code> UltraHonkBackend.generateProof</code> in a WASM worker.
            </p>

            <h3>Server verification</h3>
            <p>
              The browser sends the proof and public inputs to the Rust server. The server verifies the
              assignment proof before the next challenge is accepted and verifies the completion proof
              before awarding 20 proof points.
            </p>

            <h3>Public receipt</h3>
            <p>
              Once completion is accepted, <code>/proof/&lt;nullifier&gt;</code> contains both proofs and
              their public inputs. The visitor&apos;s browser first checks the protocol version, circuit id,
              pinned artifact hashes and common hand bindings, then calls
              <code> UltraHonkBackend.verifyProof</code> on both proofs.
            </p>
          </div>
        </details>

        <details className="protocol-detail">
          <summary><span>Limitations</span><strong>Properties the current implementation does not prove</strong></summary>
          <div className="protocol-detail-body">
            <p>
              The server sees the cards while the hand is live and may abort before settlement. The
              deal protocol makes the completed deck auditable; it is not mental poker.
            </p>
            <p>
              The completion circuit currently uses six server-committed hand facts. The receipt proves
              the private challenge against those committed facts, but it does not yet reconstruct the
              facts independently from a public action transcript. Card-rank challenges such as
              seven-deuce also need additional private hand facts before they can be claimable.
            </p>
          </div>
        </details>
      </section>

      <section className="protocol-specs-readable" aria-labelledby="protocol-specs-title">
        <h2 id="protocol-specs-title">Exact implementation</h2>
        <dl>
          <div><dt>Circuit</dt><dd>challenge_v2</dd></div>
          <div><dt>Circuit language</dt><dd>Noir 1.0.0 beta 26</dd></div>
          <div><dt>Proof system</dt><dd>UltraHonk</dd></div>
          <div><dt>Prover and verifier</dt><dd>Barretenberg 5.2.0</dd></div>
          <div><dt>Browser execution</dt><dd>NoirJS and bb.js WASM worker</dd></div>
          <div><dt>Public fields</dt><dd>194</dd></div>
          <div><dt>Circuit artifact SHA 256</dt><dd>1c89fb88ae0fb02558efa61de73260f871b323cba2a8a3d7c6423a302237bd5d</dd></div>
          <div><dt>Verification key SHA 256</dt><dd>b435db9d240683e181d8bad47203bf85d57ca27982bc676cf2686b5cf3de1d67</dd></div>
        </dl>
      </section>

      <section className="protocol-references" aria-labelledby="protocol-references-title">
        <h2 id="protocol-references-title">Source and references</h2>
        <div>
          <a href={`${REPO}/circuits/challenge-v2/src/main.nr`} target="_blank" rel="noreferrer">Noir Poker challenge circuit ↗</a>
          <a href={`${REPO}/apps/web/lib/challenge-proof.ts`} target="_blank" rel="noreferrer">Browser prover and verifier ↗</a>
          <a href={`${REPO}/apps/web/lib/receipt.ts`} target="_blank" rel="noreferrer">Receipt validation code ↗</a>
          <a href={NOIR_JS} target="_blank" rel="noreferrer">NoirJS execute API ↗</a>
          <a href={NOIR_PROVING} target="_blank" rel="noreferrer">Noir proving and verification guide ↗</a>
          <a href={BARRETENBERG} target="_blank" rel="noreferrer">Aztec Barretenberg source ↗</a>
          <a href={HYPERPLONK} target="_blank" rel="noreferrer">HyperPlonk paper, related proving-system background ↗</a>
        </div>
      </section>
    </main>
  );
}
