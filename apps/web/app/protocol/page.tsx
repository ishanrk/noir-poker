import { ChallengeProofDemo } from "@/components/challenge-proof-demo";
import { ProofPuzzle } from "@/components/proof-puzzle";
import { SiteHeader } from "@/components/site-header";

const REPO = "https://github.com/ishanrk/noir-poker/blob/main";
const NOIR = "https://noir-lang.org/docs/";
const NOIR_PROVING = "https://noir-lang.org/docs/getting_started_manually";
const BARRETENBERG =
  "https://github.com/AztecProtocol/aztec-packages/tree/next/barretenberg";
const RANDOMNESS =
  "https://developer.mozilla.org/en-US/docs/Web/API/Crypto/getRandomValues";
const MENTAL_POKER =
  "https://research-information.bris.ac.uk/en/publications/mental-poker-revisited/";
const VERIFIABLE_SHUFFLE = "https://doi.org/10.1145/501983.502000";
const BLAKE2 = "https://www.rfc-editor.org/rfc/rfc7693";
const MERKLE = "https://doi.org/10.1007/3-540-48184-2_32";

const FACTS = [
  "saw the flop",
  "raised before the flop",
  "called before the flop",
  "checked on the flop",
  "reached showdown",
  "finished with a net profit",
] as const;

const IMPLEMENTATION = [
  ["Challenge protocol", "2"],
  ["Circuit", "challenge_v2"],
  ["Circuit language", "Noir 1.0.0 beta 26"],
  ["Proof system", "UltraHonk"],
  ["Prover and verifier", "Barretenberg 5.2.0"],
  ["Browser execution", "NoirJS and bb.js WASM worker"],
  ["Public fields", "194"],
  ["Challenge catalog", "8 fixed entries"],
  ["Challenge score", "verified completions"],
  ["Deck protocol", "mental poker 1"],
  ["Deck proof", "joint ElGamal shuffle with UltraHonk"],
  ["Shuffle public fields", "453"],
  [
    "Circuit artifact SHA 256",
    "1c89fb88ae0fb02558efa61de73260f871b323cba2a8a3d7c6423a302237bd5d",
  ],
  [
    "Verification key SHA 256",
    "b435db9d240683e181d8bad47203bf85d57ca27982bc676cf2686b5cf3de1d67",
  ],
] as const;

export default function ProtocolPage() {
  return (
    <main className="site-shell story-page story-protocol">
      <SiteHeader compact />

      <header className="story-hero story-protocol-hero">
        <div>
          <p className="story-kicker">Protocol</p>
          <h1>Verify it yourself.</h1>
          <p>
            The browser verifies a completed encrypted deck transcript and any published challenge
            proof Both paths expose portable JSON
          </p>
        </div>
        <div className="protocol-signal" aria-hidden="true">
          <span>commit</span>
          <i />
          <span>prove</span>
          <i />
          <span>verify</span>
        </div>
      </header>

      <section className="story-section" aria-labelledby="runbooks-title">
        <header className="story-section-head">
          <p className="story-index">01</p>
          <div>
            <h2 id="runbooks-title">Verification runbooks</h2>
            <p>Start with the artifact you have.</p>
          </div>
        </header>

        <div className="artifact-runbooks">
          <article id="deal">
            <header>
              <span>Completed hand</span>
              <h3>Deal audit</h3>
            </header>
            <div className="artifact-runbook-steps">
              <p><span>01</span>Finish the hand and open <code>/audit/&lt;room&gt;/&lt;hand&gt;</code></p>
              <p><span>02</span>The page checks every key proof encrypted shuffle reveal and opening</p>
              <p><span>03</span>Select <strong>Download Proof Transcript</strong> and save the accepted audit</p>
              <p><span>04</span>Run <code>npm --prefix apps/web run deal:verify -- path/to/downloaded.json</code></p>
            </div>
          </article>

          <article>
            <header>
              <span>Automatic</span>
              <h3>Fair draw proof</h3>
            </header>
            <div className="artifact-runbook-steps">
              <p><span>01</span>The browser generates Mode 0 after assignment</p>
              <p><span>02</span>The server verifies the proof before publication</p>
              <p><span>03</span>Any player can open the accepted proof and verify it locally</p>
              <p><span>04</span>Open <code>/room/&lt;room&gt;/proofs/&lt;hand&gt;/&lt;seat&gt;/draw</code></p>
            </div>
          </article>

          <article>
            <header>
              <span>Completion claim</span>
              <h3>Completion receipt</h3>
            </header>
            <div className="artifact-runbook-steps">
              <p><span>01</span>The browser generates Mode 1 after a completed objective</p>
              <p><span>02</span>The server verifies it and records one completion</p>
              <p><span>03</span>Open <code>/proof/&lt;nullifier&gt;</code> to run browser verification</p>
              <p><span>04</span>Download JSON then run <code>npm --prefix apps/web run proof:verify -- path/to/downloaded.json</code></p>
            </div>
          </article>
        </div>

        <p className="story-note">
          A completion proof repeats the secret commitment selector and catalog checks. It stands
          on its own.
        </p>
      </section>

      <section className="story-section" aria-labelledby="stack-title">
        <header className="story-section-head">
          <p className="story-index">02</p>
          <div>
            <h2 id="stack-title">The proof stack</h2>
            <p>Each piece has one job. The private values stay in the player browser.</p>
          </div>
        </header>
        <ProofPuzzle />
      </section>

      <section className="story-section" aria-labelledby="demos-title">
        <header className="story-section-head">
          <p className="story-index">03</p>
          <div>
            <h2 id="demos-title">Walk through both checks</h2>
            <p>Use the controls to move one step at a time.</p>
          </div>
        </header>

        <div className="protocol-demo-grid">
          <article>
            <header>
              <h3>Private challenge</h3>
              <p>Secret commitment hidden assignment automatic proof and public verification</p>
            </header>
            <ChallengeProofDemo />
          </article>
        </div>
      </section>

      <section className="story-section" id="challenge-proofs" aria-labelledby="proof-statements-title">
        <header className="story-section-head">
          <p className="story-index">04</p>
          <div>
            <h2 id="proof-statements-title">Proof statements</h2>
            <p>The circuit has two modes with the same assignment checks.</p>
          </div>
        </header>

        <div className="statement-grid-story">
          <article>
            <span>Mode 0</span>
            <h3>Fair draw</h3>
            <p>
              The prover knows a secret bound to the public commitment. That secret and the public
              nonce select one leaf in the fixed eight entry Merkle catalog.
            </p>
            <div>
              <strong>Public</strong>
              <p>mode hand tag seat commitment nonce and catalog root</p>
            </div>
            <div>
              <strong>Private</strong>
              <p>secret selected rule and three sibling hashes</p>
            </div>
          </article>

          <article>
            <span>Mode 1</span>
            <h3>Completion</h3>
            <p>
              The circuit repeats every assignment check and binds six private facts to a public
              hash. It applies the hidden rule and derives a one time nullifier.
            </p>
            <div>
              <strong>Public</strong>
              <p>all draw fields plus facts hash and nullifier</p>
            </div>
            <div>
              <strong>Private</strong>
              <p>secret rule Merkle path fact salt and six facts</p>
            </div>
          </article>
        </div>
      </section>

      <section className="story-section" aria-labelledby="details-title">
        <header className="story-section-head">
          <p className="story-index">05</p>
          <div>
            <h2 id="details-title">Protocol details</h2>
            <p>Open the sections you need.</p>
          </div>
        </header>

        <div className="protocol-details-story">
          <details open id="deck-shuffle">
            <summary>
              <span>Encrypted deck shuffle</span>
              <small>Deck construction</small>
            </summary>
            <div>
              <p>
                The server and every human browser create one secret key for the hand Only their
                public keys enter the transcript The keys combine into one deck key that no single
                participant owns
              </p>
              <code>P = P_server + P_1 + ... + P_n</code>
              <p>
                The canonical 52 cards start encrypted under that joint key Every deck participant
                applies a private permutation and fresh encryption masks
              </p>
              <code>D_out = rerandomize(permutation(D_in))</code>
              <p>
                Each UltraHonk proof binds one input deck to one output deck without revealing the
                permutation If one human browser samples honestly then the server cannot choose the
                final order
              </p>
              <p>
                Proven decryption shares open only required hole and board positions Final key
                openings reconstruct all 52 cards after settlement The SHA 256 record chain fixes
                the exact public transcript
              </p>
              <p>
                This follows{" "}
                <a href={MENTAL_POKER} target="_blank" rel="noreferrer">mental poker</a>
                {" "}and{" "}
                <a href={VERIFIABLE_SHUFFLE} target="_blank" rel="noreferrer">verifiable shuffle</a>
                {" "}research
              </p>
            </div>
          </details>

          <details id="challenge-assignment">
            <summary>
              <span>Challenge assignment</span>
              <small>Hidden rule selection</small>
            </summary>
            <div>
              <p>
                The browser commits to a private 32 byte secret. The server stores that commitment.
                It then returns a fresh public nonce.
              </p>
              <code>
                commitment = BLAKE2s(&quot;NPCOMM02&quot; || hand_tag || seat || secret)
              </code>
              <code>
                selector = BLAKE2s(&quot;NPSELE02&quot; || hand_tag || seat || nonce || secret)
              </code>
              <code>challenge_index = selector[0] &amp; 7</code>
              <p>
                The circuit hashes the selected rule and its three private Merkle siblings. It then
                requires the computed root to equal the public catalog root.
              </p>
              <p>
                The catalog has eight entries. The low three selector bits choose an entry without
                modulo imbalance. The player commits before seeing the nonce. The server cannot
                evaluate candidate nonces without the hidden 256 bit browser secret.
              </p>
              <p>
                The hashes use the{" "}
                <a href={BLAKE2} target="_blank" rel="noreferrer">BLAKE2 standard</a>
                {" "}and the hidden catalog path follows{" "}
                <a href={MERKLE} target="_blank" rel="noreferrer">Merkle tree authentication</a>
              </p>
            </div>
          </details>

          <details id="challenge-completion">
            <summary>
              <span>Challenge completion</span>
              <small>Hidden rule completion</small>
            </summary>
            <div>
              <p>The six private facts are:</p>
              <div className="fact-list">
                {FACTS.map((fact, index) => (
                  <div key={fact}>
                    <code>fact[{index}]</code>
                    <span>{fact}</span>
                  </div>
                ))}
              </div>
              <code>
                facts_hash = BLAKE2s(&quot;NPFACT02&quot; || hand_tag || seat || salt ||
                facts)
              </code>
              <p>
                The circuit checks each required true or false condition. It then derives the public
                one time claim id.
              </p>
              <code>
                nullifier = BLAKE2s(&quot;NPNULL02&quot; || hand_tag || seat || secret)
              </code>
              <p>
                The facts hash hides the six values with a private salt The nullifier permits one
                accepted completion for that hidden secret
              </p>
            </div>
          </details>

          <details id="proof-verification">
            <summary>
              <span>Generation and verification</span>
              <small>The browser and server path</small>
            </summary>
            <div>
              <p>
                NoirJS executes the compiled circuit with public and private inputs. Barretenberg
                5.2.0 generates the UltraHonk proof in a browser WASM worker.
              </p>
              <p>
                The server verifies uploaded bytes against the pinned verification key before
                publishing them. A public browser fetches those accepted bytes and runs the same
                UltraHonk verification locally.
              </p>
              <p>
                See the{" "}
                <a href={NOIR_PROVING} target="_blank" rel="noreferrer">Noir proving guide</a>
                {" "}and{" "}
                <a href={BARRETENBERG} target="_blank" rel="noreferrer">Barretenberg source</a>
              </p>
            </div>
          </details>

          <details>
            <summary>
              <span>Limits</span>
              <small>Current boundary</small>
            </summary>
            <div>
              <p>
                A valid shuffle proof proves a permutation and fresh encryption It does not prove
                uniform sampling Fair randomness needs one honest human browser to sample a uniform
                secret permutation The server or another player can still abort the room
              </p>
              <p>
                The completion circuit proves the private rule against six facts committed by the
                server. The recorded action transcript does not independently replay poker rules.
                The deal transcript independently verifies deck generation.
              </p>
            </div>
          </details>
        </div>
      </section>

      <section className="story-section" aria-labelledby="implementation-title">
        <header className="story-section-head">
          <p className="story-index">06</p>
          <div>
            <h2 id="implementation-title">Exact implementation</h2>
            <p>Values below match the current source and pinned artifacts.</p>
          </div>
        </header>
        <dl className="implementation-grid">
          {IMPLEMENTATION.map(([term, value]) => (
            <div key={term}>
              <dt>{term}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="story-section story-sources" aria-labelledby="sources-title">
        <header className="story-section-head">
          <p className="story-index">07</p>
          <div>
            <h2 id="sources-title">Source and references</h2>
            <p>Read the circuit and verifier source with the upstream tool documentation.</p>
          </div>
        </header>
        <div className="story-link-grid">
          <a href={`${REPO}/circuits/challenge-v2/src/main.nr`} target="_blank" rel="noreferrer">
            Challenge circuit
          </a>
          <a href={`${REPO}/apps/web/lib/challenge-proof.ts`} target="_blank" rel="noreferrer">
            Browser prover
          </a>
          <a href={`${REPO}/apps/web/lib/receipt.ts`} target="_blank" rel="noreferrer">
            Browser verifier
          </a>
          <a href={`${REPO}/apps/server/src/proof.rs`} target="_blank" rel="noreferrer">
            Rust verifier
          </a>
          <a href={`${REPO}/apps/web/lib/deck-crypto.ts`} target="_blank" rel="noreferrer">
            Deck protocol
          </a>
          <a href={`${REPO}/apps/server/src/mental.rs`} target="_blank" rel="noreferrer">
            Encrypted deck server
          </a>
          <a href={`${REPO}/apps/web/lib/deck-audit.ts`} target="_blank" rel="noreferrer">
            Browser deck verifier
          </a>
          <a href={`${REPO}/circuits/deck-v1/shuffle/src/main.nr`} target="_blank" rel="noreferrer">
            Shuffle circuit
          </a>
          <a href={`${REPO}/apps/web/scripts/verify-receipt.mjs`} target="_blank" rel="noreferrer">
            Standalone proof verifier
          </a>
          <a href={NOIR} target="_blank" rel="noreferrer">
            Noir documentation
          </a>
          <a href={NOIR_PROVING} target="_blank" rel="noreferrer">
            Noir proving guide
          </a>
          <a href={BARRETENBERG} target="_blank" rel="noreferrer">
            Barretenberg source
          </a>
          <a href={RANDOMNESS} target="_blank" rel="noreferrer">
            Web Crypto randomness
          </a>
          <a href={MENTAL_POKER} target="_blank" rel="noreferrer">
            Mental Poker Revisited
          </a>
          <a href={VERIFIABLE_SHUFFLE} target="_blank" rel="noreferrer">
            Verifiable secret shuffle
          </a>
          <a href={BLAKE2} target="_blank" rel="noreferrer">
            BLAKE2 standard
          </a>
          <a href={MERKLE} target="_blank" rel="noreferrer">
            Merkle tree authentication
          </a>
        </div>
      </section>
    </main>
  );
}
