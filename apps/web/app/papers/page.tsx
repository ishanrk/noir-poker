import { SiteHeader } from "@/components/site-header";

const NOTES = "https://www.ishankumthekar.com/notes/cryptography/cryptography-notes.pdf";

const PAPERS = [
  [
    "Non-Interactive and Information-Theoretic Secure Verifiable Secret Sharing",
    "https://link.springer.com/chapter/10.1007/3-540-46766-1_9",
    "Torben Pryds Pedersen",
  ],
  [
    "The Knowledge Complexity of Interactive Proof Systems",
    "https://doi.org/10.1137/0218012",
    "Shafi Goldwasser · Silvio Micali · Charles Rackoff",
  ],
  [
    "How to Prove Yourself",
    "https://link.springer.com/chapter/10.1007/3-540-47721-7_12",
    "Amos Fiat · Adi Shamir",
  ],
  [
    "Mental Poker Revisited",
    "https://research-information.bris.ac.uk/en/publications/mental-poker-revisited/",
    "Adam Barnett · Nigel Smart",
  ],
  [
    "A Verifiable Secret Shuffle and its Application to E-Voting",
    "https://doi.org/10.1145/501983.502000",
    "C Andrew Neff",
  ],
  [
    "PLONK: Permutations over Lagrange-bases for Oecumenical Noninteractive arguments of Knowledge",
    "https://eprint.iacr.org/2019/953",
    "Ariel Gabizon · Zachary Williamson · Oana Ciobotaru",
  ],
  [
    "Plookup: A simplified polynomial protocol for lookup tables",
    "https://eprint.iacr.org/2020/315",
    "Ariel Gabizon · Zachary Williamson",
  ],
  [
    "The AZTEC Protocol",
    "https://raw.githubusercontent.com/AztecProtocol/AZTEC/master/AZTEC.pdf",
    "Zachary Williamson",
  ],
] as const;

export default function PapersPage() {
  return (
    <main className="site-shell story-page brief-page story-papers">
      <SiteHeader compact />

      <header className="brief-hero">
        <p className="brief-kicker">Reading list</p>
        <h1>Crypto Papers</h1>
        <p className="brief-description">The ideas behind checkable shuffles and private challenges.</p>
      </header>

      <section className="crypto-papers" aria-labelledby="crypto-papers-title">
        <header>
          <h2 id="crypto-papers-title">Reading order</h2>
          <p>
            Start with commitments and zero knowledge, then explore mental poker,
            shuffle proofs, and Aztec. This is the order that helped me learn.
          </p>
        </header>
        <aside className="reading-context" aria-label="How these papers relate to Noir Poker">
          <h3>What this game uses</h3>
          <div>
            <p>Noir Poker uses a Noir shuffle circuit with UltraHonk. These papers explain related ideas, not a claim that the game implements every construction below.</p>
            <details>
              <summary>What a deck proof does and does not show</summary>
              <p>Cards stay private during play. The completed deck opening reveals all cards afterward, including folded cards. Deck proofs do not establish custody, solvency, or availability.</p>
            </details>
          </div>
        </aside>
        <ol>
          {PAPERS.map(([title, href, authors]) => (
            <li key={title}>
              <a href={href} target="_blank" rel="noreferrer">
                <strong>{title}</strong>
                <span>{authors}</span>
              </a>
            </li>
          ))}
        </ol>
        <p className="crypto-notes">
          My <a href={NOTES} target="_blank" rel="noreferrer">cryptography notes</a> include
          short summaries of zero knowledge protocols and commitment schemes.
        </p>
      </section>
    </main>
  );
}
