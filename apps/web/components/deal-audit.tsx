"use client";

import { useEffect, useState } from "react";

import { Card } from "@/components/card";
import { SiteHeader } from "@/components/site-header";
import { verifyDeck, type DeckCheck } from "@/lib/deck-audit";
import { cardValue } from "@/lib/deal";
import { loadDealAudit, type DealAudit } from "@/lib/server";

type AuditState = "loading" | "verified" | "unavailable" | "failed";

const protocol = [
  {
    title: "Every participant creates a key",
    text: "Participant 0 is the server. Every later participant is a human seat in seat order. Each participant creates a random secret scalar inside its own process. It publishes only the matching Grumpkin public point. The keys array stores the x and y coordinates of those points. Each key_proofs entry stores the Schnorr values a b and z. Value a is the random proof commitment. Value b is zero in this key proof version. Value z is the response binding that commitment to the private scalar. Verification proves the sender knows the secret scalar linked to its public point. The secret scalar stays private. The public points combine into one joint encryption key. No participant owns the full joint secret.",
    check: "Every accepted public key has a valid proof of secret key ownership",
    source: "Barnett and Smart on mental poker",
    href: "https://research-information.bris.ac.uk/en/publications/mental-poker-revisited/",
  },
  {
    title: "The deck starts in public order",
    text: "The hand begins with card identifiers 0 through 51 in canonical order. Every identifier becomes a Grumpkin point. Its starting ciphertext has a zero left point and the card point on the right. The values are public at this stage. The first participant consumes this exact array then applies its secret permutation and encryption masks under the joint key. The first shuffle output hides the new ordering. Requiring the canonical input prevents a participant from inserting a second ace or removing another card before shuffling begins.",
    check: "The first shuffle input contains one copy of every canonical card",
    source: "Barnett and Smart on encrypted card decks",
    href: "https://research-information.bris.ac.uk/en/publications/mental-poker-revisited/",
  },
  {
    title: "Every participant shuffles once",
    text: "The server shuffles first. Human seats follow in seat order. A participant chooses a secret permutation of all 52 positions and a fresh nonzero encryption mask for every output. It permutes the input ciphertexts and rerandomizes each selected ciphertext under the same joint key. Rerandomization changes the visible points while preserving the hidden card. The output becomes the next participant input. One honest secret permutation makes the final ordering unknown to the server and every other participant.",
    check: "Every output deck feeds the next participant without a gap or replacement",
    source: "Neff on verifiable secret shuffles",
    href: "https://dl.acm.org/doi/10.1145/501983.502000",
  },
  {
    title: "Noir proves each shuffle",
    text: "The participant gives its secret permutation and 52 masks to the Noir circuit. The circuit requires every position from 0 through 51 exactly once. It recomputes every rerandomized ciphertext and requires all 52 results to equal the published output deck. Barretenberg turns this circuit execution into an UltraHonk proof. The proof hides the permutation and masks. The shuffles entry stores the proof bytes plus the exact input and output ciphertexts checked by the circuit.",
    check: "A valid proof permits only a full permutation and rerandomization of the prior deck",
    source: "Noir proving and verification",
    href: "https://noir-lang.org/docs/getting_started_manually",
  },
  {
    title: "Public fields bind the proof",
    text: "Each shuffle publishes exactly 453 field values. The first field gives the protocol version. The next fields give the hand number and participant. Thirty two fields hold the transcript context bytes. Two hundred eight fields hold the input point coordinates. Another two hundred eight hold the output point coordinates. The final two hold the joint public key coordinates. Each field uses one canonical 32 byte encoding. The browser rebuilds this sequence from the transcript and requires an exact byte match before UltraHonk verification.",
    check: "The public_inputs bytes bind the proof to this hand participant key and deck transition",
    source: "Noir proving and verification",
    href: "https://noir-lang.org/docs/getting_started_manually",
  },
  {
    title: "Shares reveal only dealt positions",
    text: "The final deck remains encrypted when betting starts. A private hole card position is opened only for its owner. Every other participant supplies a decryption share for that ciphertext. The owner removes its own share and learns the card locally. Public flop turn and river positions use shares from every participant and become visible to everyone. Each share includes a Chaum Pedersen proof linking it to the same secret used by the published key. A false share fails before a card can be accepted.",
    check: "Private positions reach one seat while board positions reach every seat",
    source: "Chaum and Pedersen equality proofs",
    href: "https://chaum.com/wp-content/uploads/2021/12/Wallet_Databases.pdf",
  },
  {
    title: "Ordered records preserve the hand",
    text: "The records array stores every public protocol message in accepted order. Seq must equal the zero based array position. Kind identifies a key shuffle share reveal opening or completion record. Seat identifies its sender. A missing seat marks the server. Payload contains the base64 encoded protocol bytes. Hash contains the chain head after accepting that record. The verifier decodes every payload and requires it to equal the matching key proof shuffle share reveal opening or final deck value elsewhere in the transcript.",
    check: "No record can move disappear or change without breaking replay",
    source: "NIST SHA 256 standard",
    href: "https://csrc.nist.gov/pubs/fips/180-4/upd1/final",
  },
  {
    title: "Final openings reconstruct all cards",
    text: "After settlement every participant publishes its hand key opening. The verifier derives each public key again and requires an exact match with the key published before the shuffle. It removes every encryption layer from all 52 final ciphertexts. Each result must decode to one canonical card identifier. Identifiers 0 through 12 are clubs. Values 13 through 25 are diamonds. Values 26 through 38 are hearts. Values 39 through 51 are spades. Each suit runs from 2 through ace. The final list must contain every identifier exactly once.",
    check: "The reconstructed deck matches every reveal and the complete 52 card permutation",
    source: "Mental Poker Revisited",
    href: "https://research-information.bris.ac.uk/en/publications/mental-poker-revisited/",
  },
  {
    title: "The hash chain identifies the transcript",
    text: "The first chain head is SHA 256 over the protocol domain plus room bytes plus the zero based hand number. Every next head hashes the same domain plus the previous head plus seq plus kind plus seat plus a SHA 256 digest of payload. A missing seat uses 255. The transcript_hash value is the final chain head. It identifies the exact accepted message order. Editing one payload or position produces another final value.",
    check: "Changing one ordered record changes the final hash chain head",
    source: "NIST SHA 256 standard",
    href: "https://csrc.nist.gov/pubs/fips/180-4/upd1/final",
  },
  {
    title: "Run the full verification again",
    text: "The page runs the browser verifier against the accepted transcript. Download Proof Transcript saves the same JSON on the local device. The local command reads that file without contacting the poker server. It checks the canonical encrypted deck. It verifies every key proof and every UltraHonk shuffle proof. It verifies each decryption share and revealed card. It checks every final key opening and all 52 reconstructed cards. It rebuilds the ordered record chain and requires the final SHA 256 value to equal transcript_hash.",
    check: "Success prints verified plus the room id zero based hand number and card count 52",
    source: "Portable verifier source",
    href: "https://github.com/ishanrk/noir-poker/blob/main/apps/web/scripts/verify-deal.mjs",
  },
] as const;

const verifierSource = "https://github.com/ishanrk/noir-poker/blob/main/apps/web/scripts/verify-deal.mjs";
const browserVerifier = "https://github.com/ishanrk/noir-poker/blob/main/apps/web/lib/deck-audit.ts";
const circuitSource = "https://github.com/ishanrk/noir-poker/blob/main/circuits/deck-v1/shuffle/src/main.nr";
const noirDocs = "https://noir-lang.org/docs/getting_started_manually";

function proofFileName(audit: DealAudit) {
  return `noir-poker-${audit.room}-hand-${audit.hand_no + 1}-deck-proof.json`;
}

function downloadProofs(audit: DealAudit) {
  const file = new Blob([JSON.stringify(audit, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = proofFileName(audit);
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function cardMarker(index: number, audit: DealAudit) {
  const human = audit.human;
  const dealer = audit.dealer;
  if (!human?.length || dealer === undefined || dealer >= human.length) return "";

  const players = human.length;
  if (index < players * 2) {
    const owner = ((dealer + 1) % players + index % players) % players;
    const single = human.filter(Boolean).length === 1 && human[0];
    return single ? owner === 0 ? "You" : `B${owner}` : `P${owner + 1}`;
  }

  const board = index - players * 2;
  if (board === 0 || board === 4 || board === 6) return "Burn";
  if (board >= 1 && board <= 3) return "F";
  if (board === 5) return "T";
  if (board === 7) return "R";
  return "";
}

function proofDetails(step: number, audit: DealAudit) {
  const records = (kind: string) => audit.records.filter((record) => record.kind === kind).length;
  const proofBytes = audit.shuffles.reduce((size, shuffle) => size + atob(shuffle.proof).length, 0);
  const publicBytes = audit.shuffles.reduce(
    (size, shuffle) => size + atob(shuffle.public_inputs).length,
    0,
  );
  const values = [
    [
      ["Public keys", `${audit.keys.length} combined for this hand`],
      ["Key proofs", `${audit.key_proofs.length} proofs of secret key ownership`],
    ],
    [
      ["Canonical identifiers", "0 through 51 in fixed public order"],
      ["Starting pairs", "52 zero left points and 52 card points"],
    ],
    [
      ["Deck transitions", `${audit.shuffles.length} proven input and output deck pairs`],
      ["Participants", `${audit.keys.length} secret permutations applied in order`],
    ],
    [
      ["Shuffle proofs", `${audit.shuffles.length} accepted UltraHonk proofs`],
      ["Proof bytes", `${proofBytes} decoded bytes in total`],
    ],
    [
      ["Public fields", `453 fields for each of ${audit.shuffles.length} shuffles`],
      ["Public input bytes", `${publicBytes} decoded bytes in total`],
    ],
    [
      ["Share groups", `${records("share")} partial decryption messages`],
      ["Reveal groups", `${records("reveal")} accepted card reveals`],
    ],
    [
      ["Ordered records", `${audit.records.length} chained transcript entries`],
      ["Sequence", `0 through ${Math.max(audit.records.length - 1, 0)} with no gap`],
    ],
    [
      ["Key openings", `${audit.openings.length} secrets matched to public keys`],
      ["Final deck", `${audit.deck.length} unique ordered card identifiers`],
    ],
    [
      ["Final chain head", audit.transcript_hash],
      ["Complete records", `${records("complete")} final deck record`],
    ],
    [
      ["Local command", `npm --prefix apps/web run deal:verify -- ${proofFileName(audit)}`],
      ["Expected card count", "52 reconstructed cards"],
    ],
  ];

  return values[step];
}

export function DealAuditView({ room, hand }: { room: string; hand: number }) {
  const [audit, setAudit] = useState<DealAudit>();
  const [check, setCheck] = useState<DeckCheck>();
  const [state, setState] = useState<AuditState>("loading");
  const [step, setStep] = useState("loading transcript");
  const [error, setError] = useState<string>();
  const [protocolStep, setProtocolStep] = useState(0);

  useEffect(() => {
    let live = true;
    void loadDealAudit(room, hand)
      .then(async (value) => {
        if (!live) return;
        if (value.hand_no !== hand) throw new Error("deck proof mismatch");
        setAudit(value);
        const result = await verifyDeck(value, (next) => live && setStep(next));
        if (!live) return;
        setCheck(result);
        setState("verified");
      })
      .catch((cause) => {
        if (!live) return;
        const message = cause instanceof Error ? cause.message : "deck verification failed";
        setState(message === "deck proof unavailable for this hand" ? "unavailable" : "failed");
        setError(message);
      });
    return () => { live = false; };
  }, [hand, room]);

  const shown = check?.deck.slice(0, 20) ?? [];
  const current = protocol[protocolStep];

  return (
    <main className="site-shell audit-page deck-proof-page">
      <SiteHeader compact />
      <header className="audit-hero">
        <div>
          <p className="eyebrow">Deck Randomness Verification</p>
          <h1>{state === "verified" ? "Deck verified" : state === "unavailable" ? "Proof unavailable" : state === "failed" ? "Verification failed" : "Checking deck"}</h1>
          <p>Short proof showing server didn&apos;t cheat the deck</p>
        </div>
        <div className="deck-proof-seal" data-state={state}>
          <span>{state === "verified" ? "VALID" : state === "unavailable" ? "OLD HAND" : state === "failed" ? "FAILED" : "CHECKING"}</span>
          <small>{state === "loading" ? step : state === "unavailable" ? "no encrypted transcript" : `${audit?.shuffles.length ?? 0} shuffle proofs`}</small>
        </div>
      </header>

      {state === "unavailable" ? (
        <section className="deck-unavailable">
          <strong>This hand used the previous deal system</strong>
          <p>Start a new hand with the current server to create an encrypted shuffle proof</p>
        </section>
      ) : error ? <p className="proof-error">{error}</p> : null}

      {audit && (
        <section className="audit-transcript">
          <div className="section-index"><span>Transcript</span><p>One completed hand</p></div>
          <dl>
            <div><dt>room and hand</dt><dd>{audit.room} / {audit.hand_no + 1}</dd></div>
            <div><dt>SHA 256 chain head</dt><dd>{audit.transcript_hash}</dd></div>
            <div><dt>participants</dt><dd>{audit.keys.length} independent deck keys</dd></div>
            <div><dt>shuffle proofs</dt><dd>{audit.shuffles.length} UltraHonk proofs</dd></div>
            <div><dt>final openings</dt><dd>{audit.openings.length} keys matched</dd></div>
          </dl>
          <div className="audit-proof-actions">
            <button type="button" className="primary-action" onClick={() => downloadProofs(audit)}>
              Download Proof Transcript
            </button>
            <a className="text-action" href={verifierSource} target="_blank" rel="noreferrer">
              Inspect Verification Script
            </a>
            <a className="text-action" href={browserVerifier} target="_blank" rel="noreferrer">
              Inspect Browser Verifier
            </a>
            <a className="text-action" href={circuitSource} target="_blank" rel="noreferrer">
              Inspect Shuffle Circuit
            </a>
            <a className="text-action" href={noirDocs} target="_blank" rel="noreferrer">
              Noir Documentation
            </a>
          </div>
        </section>
      )}

      {check && audit && (
        <section className="deck-opening">
          <header>
            <p className="protocol-label">Deterministic reconstruction</p>
            <h2>First 20 cards</h2>
            <p>The verifier checks all 52 cards and shows the first 20 here</p>
          </header>
          <div className="deck-opening-stream">
            {shown.map((card, index) => (
              <div key={`${index}-${card}`}>
                <span className="deck-card-marker">{cardMarker(index, audit)}</span>
                <span className="deck-card-position">{String(index + 1).padStart(2, "0")}</span>
                <Card value={cardValue(card)} />
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="deck-protocol">
        <header>
          <p className="protocol-label">Protocol walkthrough</p>
          <h2>Follow the deck</h2>
          <p>Ten steps from public keys to a local verification</p>
        </header>
        <nav className="deck-protocol-path" aria-label="Deck protocol steps">
          {protocol.map((item, index) => (
            <button
              key={item.title}
              type="button"
              data-current={index === protocolStep}
              aria-label={`Step ${index + 1} ${item.title}`}
              onClick={() => setProtocolStep(index)}
            >
              {String(index + 1).padStart(2, "0")}
            </button>
          ))}
        </nav>
        <article key={current.title} className="deck-protocol-step">
          <span>STEP {String(protocolStep + 1).padStart(2, "0")}</span>
          <h2>{current.title}</h2>
          <p>{current.text}</p>
          {audit && (
            <dl className="deck-protocol-data">
              {proofDetails(protocolStep, audit).map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          )}
          <strong>{current.check}</strong>
          <a href={current.href} target="_blank" rel="noreferrer">Source&nbsp; {current.source} ↗</a>
        </article>
        <div className="deck-protocol-controls">
          <button type="button" disabled={protocolStep === 0} onClick={() => setProtocolStep((value) => value - 1)}>Previous</button>
          <output>{protocolStep + 1} / {protocol.length}</output>
          <button type="button" disabled={protocolStep === protocol.length - 1} onClick={() => setProtocolStep((value) => value + 1)}>Next Step</button>
        </div>
      </section>

      <section className="deck-limit">
        <strong>Abort boundary</strong>
        <p>A server or player can still disconnect. No protocol can force another machine to send a packet. An abort cannot secretly replace the proven deck and remains visible as an incomplete transcript.</p>
      </section>
    </main>
  );
}
