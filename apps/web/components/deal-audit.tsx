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
    title: "Each participant creates a private key",
    text: "The server creates one random private number. Every player browser creates another. Each participant keeps its private number and publishes the matching public key. A Schnorr proof accompanies every public key. This proof confirms that its sender knows the matching private number without revealing that number. The public keys combine into one deck encryption key. Opening a card later requires help from every participant because nobody owns the complete private key.",
    check: "Every public key belongs to a participant that knows its private key",
    source: "Barnett and Smart on mental poker",
    href: "https://research-information.bris.ac.uk/en/publications/mental-poker-revisited/",
  },
  {
    title: "The deck begins with all 52 cards",
    text: "The starting deck contains card numbers 0 through 51 in fixed public order. Each number represents one rank and suit. The verifier checks that every number appears once before encryption begins. This prevents a missing card a duplicate card or a replacement card from entering the shuffle.",
    check: "The starting deck contains every valid card exactly once",
    source: "Barnett and Smart on encrypted card decks",
    href: "https://research-information.bris.ac.uk/en/publications/mental-poker-revisited/",
  },
  {
    title: "Each participant shuffles the encrypted deck",
    text: "The server shuffles first. Player browsers follow in seat order. Each participant chooses a secret order for all 52 encrypted cards. It also adds fresh encryption to every card without changing the card inside. The resulting deck becomes the next participant input. One honest secret shuffle makes the final order unknown to the server and every other participant.",
    check: "Every shuffled deck becomes the exact input to the next shuffle",
    source: "Neff on verifiable secret shuffles",
    href: "https://dl.acm.org/doi/10.1145/501983.502000",
  },
  {
    title: "Noir checks every shuffle",
    text: "The participant gives its secret card order and 52 fresh encryption values to the Noir circuit. The circuit checks that every old position appears once. It rebuilds all 52 encrypted output cards and compares them with the published output deck. Barretenberg creates an UltraHonk proof after every comparison passes. The proof keeps the secret order and encryption values hidden.",
    check: "A valid proof allows only a reordered and freshly encrypted copy of the prior deck",
    source: "Noir proving and verification",
    href: "https://noir-lang.org/docs/getting_started_manually",
  },
  {
    title: "Each proof is tied to one hand",
    text: "The proof includes public input bytes. These bytes contain the hand number the participant the transcript fingerprint the joint public key and both encrypted decks. The verifier rebuilds that exact list from the downloaded transcript before checking the proof. Moving the proof to another hand or changing either deck produces different public input bytes and verification fails.",
    check: "The proof belongs to one participant and one exact deck change",
    source: "Noir proving and verification",
    href: "https://noir-lang.org/docs/getting_started_manually",
  },
  {
    title: "Only dealt cards are opened during play",
    text: "The shuffled deck stays encrypted when betting starts. Every participant supplies part of the decryption for a card position. A private hole card receives all parts except the owner part. The owner completes that opening inside its browser. Community cards receive every part and become public. Each part carries a Chaum Pedersen proof confirming that it came from the same private key published at the start.",
    check: "Private cards open for one player while community cards open for everyone",
    source: "Chaum and Pedersen equality proofs",
    href: "https://chaum.com/wp-content/uploads/2021/12/Wallet_Databases.pdf",
  },
  {
    title: "Every protocol message is recorded",
    text: "The transcript stores each public message in the order accepted by the server. Every entry records its position message type sender encoded contents and running hash. The verifier decodes each entry and compares it with the matching key shuffle proof decryption part card reveal or final opening stored elsewhere in the transcript.",
    check: "Moving removing or changing a message breaks transcript verification",
    source: "NIST SHA 256 standard",
    href: "https://csrc.nist.gov/pubs/fips/180-4/upd1/final",
  },
  {
    title: "The final keys open all 52 cards",
    text: "After the hand ends every participant publishes its private key for that hand. The verifier recreates each public key and requires an exact match with the key published before shuffling. It then removes every encryption layer from all 52 cards. Each result must be one valid card number. The complete list must contain every card number from 0 through 51 exactly once and must match every card revealed during play.",
    check: "The final deck contains 52 unique cards and matches the played hand",
    source: "Mental Poker Revisited",
    href: "https://research-information.bris.ac.uk/en/publications/mental-poker-revisited/",
  },
  {
    title: "SHA 256 detects transcript changes",
    text: "The first SHA 256 fingerprint binds the room and hand number. Every later fingerprint combines the prior fingerprint with the next message position type sender and contents. The final fingerprint shown on this page identifies the complete accepted transcript in exact order. Editing one message or moving it creates a different final fingerprint.",
    check: "The final fingerprint changes when any recorded message changes",
    source: "NIST SHA 256 standard",
    href: "https://csrc.nist.gov/pubs/fips/180-4/upd1/final",
  },
  {
    title: "The browser and local script repeat every check",
    text: "This page verifies the accepted transcript inside the browser. Download Proof Transcript saves the same data as JSON. The local script reads that file without contacting the poker server. It checks the starting deck every public key every shuffle proof every decryption part every revealed card every final key and the final SHA 256 fingerprint.",
    check: "Both verifiers accept the same transcript or report an error",
    source: "Portable verifier source",
    href: "https://github.com/ishanrk/noir-poker/blob/main/apps/web/scripts/verify-deal.mjs",
  },
] as const;

const verifierSource = "https://github.com/ishanrk/noir-poker/blob/main/apps/web/scripts/verify-deal.mjs";

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
      ["Run location", "Web application folder"],
      ["Local command", `npm run deal:verify -- ${proofFileName(audit)}`],
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

  const shown: Array<number | undefined> = check
    ? check.deck.slice(0, 20)
    : Array.from({ length: 20 });
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
            <div><dt>room</dt><dd>{audit.room}</dd></div>
            <div><dt>hand</dt><dd>{audit.hand_no + 1}</dd></div>
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
              Verifier Source
            </a>
          </div>
        </section>
      )}

      {state !== "unavailable" && (
        <section className="deck-opening">
          <header>
            <p className="protocol-label">Deterministic reconstruction</p>
            <h2>First 20 cards</h2>
            <p>The verifier checks all 52 cards then fills these 20 fixed positions</p>
          </header>
          <div className="deck-opening-stream" data-ready={check ? "true" : "false"}>
            {shown.map((card, index) => (
              <div key={index}>
                <span className="deck-card-marker">{audit ? cardMarker(index, audit) : ""}</span>
                <span className="deck-card-position">{String(index + 1).padStart(2, "0")}</span>
                <Card value={card === undefined ? undefined : cardValue(card)} />
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="deck-protocol">
        <header>
          <p className="protocol-label">Protocol walkthrough</p>
          <h2>Explanation of the Protocol</h2>
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
          <output>Step {protocolStep + 1} of {protocol.length}</output>
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
