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
    title: "Each participant creates a key",
    text: "The server and every human browser create a secret key for this hand. The transcript publishes each Grumpkin public key with a proof that its owner knows the matching secret. The secrets stay private during play. The public keys combine into one shared deck key.",
    check: "The keys field stores public curve points and key_proofs stores ownership proofs",
    source: "Barnett and Smart on mental poker",
    href: "https://research-information.bris.ac.uk/en/publications/mental-poker-revisited/",
  },
  {
    title: "Each participant proves one shuffle",
    text: "Every shuffle entry contains the 52 input ciphertexts and the 52 output ciphertexts. Its UltraHonk proof shows that the output contains the same cards under a hidden permutation with fresh encryption. If one human browser samples its permutation honestly then the server cannot choose the final order. The secret permutation and encryption masks never enter the transcript.",
    check: "The shuffles field connects each public input deck to its public output deck",
    source: "Neff on verifiable secret shuffles",
    href: "https://dl.acm.org/doi/10.1145/501983.502000",
  },
  {
    title: "Public inputs pin every shuffle",
    text: "Each proof publishes exactly 453 field values. They bind the protocol version the hand number the participant the prior transcript context all coordinates from both 52 card decks and the aggregate deck key. The proof bytes are the compact UltraHonk argument checked against the pinned verification key.",
    check: "The public_inputs field binds the proof to this hand and these exact ciphertexts",
    source: "Noir proving and verification",
    href: "https://noir-lang.org/docs/getting_started_manually",
  },
  {
    title: "Ordered records preserve the deal",
    text: "The records array stores each key shuffle decryption share card reveal opening and completion in sequence. Share proofs connect every decryption share to its published key. Reveal records open only the card positions needed during play.",
    check: "The records field preserves the exact event order and each encoded payload",
    source: "Chaum and Pedersen equality proofs",
    href: "https://chaum.com/wp-content/uploads/2021/12/Wallet_Databases.pdf",
  },
  {
    title: "Final openings reconstruct the deck",
    text: "After settlement each participant publishes their secret key opening. The verifier derives its public key again and requires an exact match. Those openings decrypt the final ciphertext deck. The deck field records the resulting 52 card identifiers in order.",
    check: "The openings field matches every public key and deck contains one full permutation",
    source: "Mental Poker Revisited",
    href: "https://research-information.bris.ac.uk/en/publications/mental-poker-revisited/",
  },
  {
    title: "The hash chain identifies the transcript",
    text: "The verifier starts with a domain separated hash of the room and hand. Every ordered record hashes the previous head its sequence type seat and payload hash. transcript_hash is the final SHA 256 chain head. It identifies this record chain and is not a direct hash of the downloaded JSON file.",
    check: "Changing one ordered record changes the final hash chain head",
    source: "NIST SHA 256 standard",
    href: "https://csrc.nist.gov/pubs/fips/180-4/upd1/final",
  },
] as const;

const verifierSource = "https://github.com/ishanrk/noir-poker/blob/main/apps/web/scripts/verify-deal.mjs";
const browserVerifier = "https://github.com/ishanrk/noir-poker/blob/main/apps/web/lib/deck-audit.ts";
const circuitSource = "https://github.com/ishanrk/noir-poker/blob/main/circuits/deck-v1/shuffle/src/main.nr";
const noirDocs = "https://noir-lang.org/docs/getting_started_manually";

function downloadProofs(audit: DealAudit) {
  const file = new Blob([JSON.stringify(audit, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = `noir-poker-${audit.room}-hand-${audit.hand_no + 1}-deck-proof.json`;
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
      ["Deck transitions", `${audit.shuffles.length} proven input and output deck pairs`],
      ["Proof bytes", `${proofBytes.toLocaleString("en-US")} decoded bytes in total`],
    ],
    [
      ["Public fields", `453 fields for each of ${audit.shuffles.length} shuffles`],
      ["Public input bytes", `${publicBytes.toLocaleString("en-US")} decoded bytes in total`],
    ],
    [
      ["Ordered records", `${audit.records.length} chained transcript entries`],
      ["Shares and reveals", `${records("share")} share groups and ${records("reveal")} reveal groups`],
    ],
    [
      ["Key openings", `${audit.openings.length} secrets matched to public keys`],
      ["Final deck", `${audit.deck.length} unique ordered card identifiers`],
    ],
    [
      ["Final chain head", audit.transcript_hash],
      ["Complete records", `${records("complete")} final deck record`],
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
          <p>Six steps from new keys to the verified deck</p>
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
