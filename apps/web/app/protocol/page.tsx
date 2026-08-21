import Link from "next/link";

import { ChallengeProofDemo } from "@/components/challenge-proof-demo";
import { ProofPuzzle } from "@/components/proof-puzzle";
import { ProtocolDemo } from "@/components/protocol-demo";
import { SiteHeader } from "@/components/site-header";

const REPO = "https://github.com/ishanrk/noir-poker/blob/main";
const NOIR = "https://noir-lang.org/docs/";
const NOIR_PROVING = "https://noir-lang.org/docs/getting_started_manually";
const BARRETENBERG =
  "https://github.com/AztecProtocol/aztec-packages/tree/next/barretenberg";
const RANDOMNESS =
  "https://developer.mozilla.org/en-US/docs/Web/API/Crypto/getRandomValues";

const FACTS = [
  "saw the flop",
  "raised before the flop",
  "called before the flop",
  "checked on the flop",
  "reached showdown",
  "finished with a net profit",
] as const;

const IMPLEMENTATION = [
  ["Circuit", "challenge_v2"],
  ["Circuit language", "Noir 1.0.0 beta 26"],
  ["Proof system", "UltraHonk"],
  ["Prover and verifier", "Barretenberg 5.2.0"],
  ["Browser execution", "NoirJS and bb.js WASM worker"],
  ["Public fields", "194"],
  [
    "Circuit artifact SHA-256",
    "1c89fb88ae0fb02558efa61de73260f871b323cba2a8a3d7c6423a302237bd5d",
  ],
  [
    "Verification key SHA-256",
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
            The browser can replay a completed deal and verify an accepted challenge proof. Both paths
            expose portable JSON.
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
            <ol>
              <li>Finish the hand and open <code>/audit/&lt;room&gt;/&lt;hand&gt;</code>.</li>
              <li>The page rebuilds the commitment, seed, 52-card shuffle and deal map.</li>
              <li>Choose <strong>Export JSON</strong> and save the downloaded audit.</li>
              <li>
                Run <code>npm --prefix apps/web run deal:verify -- audit.json</code>.
              </li>
            </ol>
          </article>

          <article>
            <header>
              <span>Optional</span>
              <h3>Fair-draw proof</h3>
            </header>
            <ol>
              <li>After assignment, choose <strong>Generate fair draw proof</strong>.</li>
              <li>The Rust server verifies the proof before marking it published.</li>
              <li>Another player chooses <strong>Verify</strong> in the Challenge proofs section.</li>
              <li>
                The accepted JSON is available from the server at{" "}
                <code>/proofs/&lt;room&gt;/&lt;hand&gt;/&lt;seat&gt;/draw</code>.
              </li>
            </ol>
          </article>

          <article>
            <header>
              <span>Points claim</span>
              <h3>Completion receipt</h3>
            </header>
            <ol>
              <li>Meet the objective and choose <strong>Generate completion proof</strong>.</li>
              <li>The server verifies it, publishes the claim and awards 20 proof points.</li>
              <li>Open <code>/proof/&lt;nullifier&gt;</code>; verification starts in that browser.</li>
              <li>
                Export JSON, then run{" "}
                <code>npm --prefix apps/web run proof:verify -- receipt.json</code>.
              </li>
            </ol>
          </article>
        </div>

        <p className="story-note">
          A completion proof independently rechecks the secret commitment, selector and catalog path.
          A fair-draw proof is not a prerequisite for the points claim.
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
              <h3>Deal fairness</h3>
              <p>Commitment, player entropy, deterministic shuffle and deal positions.</p>
            </header>
            <ProtocolDemo />
          </article>
          <article>
            <header>
              <h3>Private challenge</h3>
              <p>Secret commitment, hidden assignment, optional proof and public verification.</p>
            </header>
            <ChallengeProofDemo />
          </article>
        </div>
      </section>

      <section className="story-section" aria-labelledby="proof-statements-title">
        <header className="story-section-head">
          <p className="story-index">04</p>
          <div>
            <h2 id="proof-statements-title">What each proof says</h2>
            <p>The circuit has two modes with the same assignment checks.</p>
          </div>
        </header>

        <div className="statement-grid-story">
          <article>
            <span>Mode 0</span>
            <h3>Fair draw</h3>
            <p>
              The prover knows a secret bound to the public commitment. That secret and the public
              nonce select one leaf in the fixed eight-item Merkle catalog.
            </p>
            <div>
              <strong>Public</strong>
              <p>mode, hand tag, seat, commitment, nonce and catalog root</p>
            </div>
            <div>
              <strong>Private</strong>
              <p>secret, selected rule and three sibling hashes</p>
            </div>
          </article>

          <article>
            <span>Mode 1</span>
            <h3>Completion</h3>
            <p>
              The circuit repeats every assignment check, binds six private facts to a public hash,
              applies the hidden rule and derives a one-time nullifier.
            </p>
            <div>
              <strong>Public</strong>
              <p>all draw fields plus facts hash and nullifier</p>
            </div>
            <div>
              <strong>Private</strong>
              <p>secret, rule, Merkle path, fact salt and six facts</p>
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
          <details open>
            <summary>
              <span>Deal commitment and seed</span>
              <small>How the final deck is fixed</small>
            </summary>
            <div>
              <p>
                The server generates a fresh 32-byte secret and publishes a SHA-256 commitment bound
                to the room and hand number before player entropy arrives.
              </p>
              <code>C = SHA256(&quot;NPDEAL01&quot; || room || hand || server_secret)</code>
              <p>
                Each browser contributes 32 bytes from <code>crypto.getRandomValues</code>. Ordered
                seat contributions and the committed server secret produce one seed.
              </p>
              <code>
                seed = SHA256(&quot;NPSEED01&quot; || room || hand || seats || shares ||
                server_secret)
              </code>
              <p>
                SHA-256 counter output drives rejection sampling and Fisher-Yates over the canonical
                52-card deck. Hole cards, burns and community cards use fixed positions.
              </p>
            </div>
          </details>

          <details>
            <summary>
              <span>Challenge assignment</span>
              <small>How one hidden rule is selected</small>
            </summary>
            <div>
              <p>
                The browser commits to a private 32-byte secret. The server stores that commitment,
                then returns a fresh public nonce.
              </p>
              <code>
                commitment = BLAKE2s(&quot;NPCOMM02&quot; || hand_tag || seat || secret)
              </code>
              <code>
                selector = BLAKE2s(&quot;NPSELE02&quot; || hand_tag || seat || nonce || secret)
              </code>
              <code>challenge_index = selector[0] &amp; 7</code>
              <p>
                The circuit hashes the selected rule and its three private Merkle siblings, then
                requires the computed root to equal the public catalog root.
              </p>
            </div>
          </details>

          <details>
            <summary>
              <span>Challenge completion</span>
              <small>How the hidden rule is checked</small>
            </summary>
            <div>
              <p>The six private facts are:</p>
              <ol className="fact-list">
                {FACTS.map((fact, index) => (
                  <li key={fact}>
                    <code>fact[{index}]</code>
                    <span>{fact}</span>
                  </li>
                ))}
              </ol>
              <code>
                facts_hash = BLAKE2s(&quot;NPFACT02&quot; || hand_tag || seat || salt ||
                facts)
              </code>
              <p>
                The circuit checks each required true or false condition, then derives the public
                one-time claim id.
              </p>
              <code>
                nullifier = BLAKE2s(&quot;NPNULL02&quot; || hand_tag || seat || secret)
              </code>
            </div>
          </details>

          <details>
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
            </div>
          </details>

          <details>
            <summary>
              <span>Limits</span>
              <small>What the current proof does not cover</small>
            </summary>
            <div>
              <p>
                The server sees live cards and can stop serving a room. The completed deal is
                auditable after settlement.
              </p>
              <p>
                The completion circuit proves the private rule against six facts committed by the
                server. A future public action transcript could derive those facts independently.
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
            <p>Read the circuit, verifier and upstream tool documentation.</p>
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
        </div>
        <Link className="story-link" href="/rules">
          Read the game rules
        </Link>
      </section>
    </main>
  );
}
