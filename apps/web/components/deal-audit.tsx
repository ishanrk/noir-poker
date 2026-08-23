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
    title: "Every player starts with a cryptographic key",
    text: "The server and every player create a new secret key for the hand. Only the public keys leave their devices. Each key proof shows that its owner knows the secret without revealing it. The public keys combine into one deck key.",
    check: "One public key and one key proof for each deck participant",
    source: "Barnett and Smart on mental poker",
    href: "https://research-information.bris.ac.uk/en/publications/mental-poker-revisited/",
  },
  {
    title: "The deck starts encrypted",
    text: "The protocol starts with the standard 52 cards. Each card becomes a curve point encrypted with the shared deck key. The first encrypted deck stays public so every verifier starts from the same cards.",
    check: "52 encrypted card points in canonical order before shuffling",
    source: "Mental Poker Revisited",
    href: "https://research-information.bris.ac.uk/en/publications/mental-poker-revisited/",
  },
  {
    title: "Every player shuffles the deck",
    text: "The server shuffles first. Every player then changes the order and refreshes the encryption. Each UltraHonk proof connects one input deck to one output deck without exposing the secret order.",
    check: "One accepted shuffle proof for every participant",
    source: "Neff on verifiable secret shuffles",
    href: "https://dl.acm.org/doi/10.1145/501983.502000",
  },
  {
    title: "Only dealt cards get opened",
    text: "Players release key shares only for cards needed in the game. Each share proof shows that the share came from the same secret as the published key. Hole cards open for their owner and board cards open for everyone.",
    check: "Share records open dealt positions without opening the remaining deck",
    source: "Chaum and Pedersen equality proofs",
    href: "https://chaum.com/wp-content/uploads/2021/12/Wallet_Databases.pdf",
  },
  {
    title: "Every shuffle gets checked",
    text: "The proof bytes contain the private shuffle argument. The public inputs name the hand the transcript state the shared key and both encrypted decks. Barretenberg checks them against the pinned verification key.",
    check: "Proof bytes stay compact while public inputs bind the exact shuffle",
    source: "Noir proving and verification",
    href: "https://noir-lang.org/docs/getting_started_manually",
  },
  {
    title: "The final deck gets reconstructed",
    text: "After the hand every player opens their key. The verifier matches each opening to its public key then decrypts all 52 cards. The SHA 256 fingerprint identifies the exact ordered transcript. Changing any record changes that fingerprint.",
    check: "Key openings reconstruct the deck while SHA 256 identifies the transcript",
    source: "NIST SHA 256 standard",
    href: "https://csrc.nist.gov/pubs/fips/180-4/upd1/final",
  },
] as const;

const verifierSource = "https://github.com/ishanrk/noir-poker/blob/crypto-verification/apps/web/lib/deck-audit.ts";

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
  const values = [
    [
      ["Public keys", `${audit.keys.length} combined for this hand`],
      ["Key proofs", `${audit.key_proofs.length} proofs of secret key ownership`],
    ],
    [
      ["Encrypted cards", `${audit.shuffles[0]?.input.length ?? 0} canonical card points`],
      ["Shared key", `${audit.keys.length} public keys added together`],
    ],
    [
      ["Shuffle proofs", `${audit.shuffles.length} accepted UltraHonk proofs`],
      ["Deck transitions", `${audit.shuffles.length} proven input to output changes`],
    ],
    [
      ["Share records", `${records("share")} groups of proven key shares`],
      ["Reveal records", `${records("reveal")} groups of opened card positions`],
    ],
    [
      ["Proof bytes", `${audit.shuffles.length} accepted proof payloads`],
      ["Public inputs", `${audit.shuffles.length} hand and deck bindings`],
    ],
    [
      ["Key openings", `${audit.openings.length} secrets matched to public keys`],
      ["SHA 256", audit.transcript_hash],
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
        const result = await verifyDeck(value, (next) => live && setStep(next));
        if (!live) return;
        setAudit(value);
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
            <div><dt>SHA 256 fingerprint</dt><dd>{audit.transcript_hash}</dd></div>
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
