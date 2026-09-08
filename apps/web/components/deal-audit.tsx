"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { Card } from "@/components/card";
import { SiteHeader } from "@/components/site-header";
import { verifyDeck, type DeckCheck } from "@/lib/deck-audit";
import { cardValue } from "@/lib/deal";
import { loadDealAudit, type DealAudit } from "@/lib/server";

type AuditState = "loading" | "verified" | "unavailable" | "failed";

const protocol = [
  {
    title: "Participants create deck keys",
    text: [
      "The server creates one private random number and every player browser creates another",
      "A public key is made from each private number and can be shared without revealing that number",
      "Each participant publishes its public key with a Schnorr proof",
      "A Schnorr proof is a short cryptographic check showing that the sender knows the private number without exposing it",
      "The public keys combine into one key that locks the deck",
      "No participant has every private number needed to open the locked deck alone",
    ],
    source: "Barnett and Smart on mental poker",
    href: "https://research-information.bris.ac.uk/en/publications/mental-poker-revisited/",
  },
  {
    title: "The verifier checks the 52 starting cards",
    text: [
      "The public starting deck contains card numbers 0 through 51 in a fixed order",
      "Each number represents one rank and suit",
      "The verifier confirms that every number appears once before the deck is locked",
      "A missing duplicate or replacement card makes this check fail",
    ],
    source: "Barnett and Smart on encrypted card decks",
    href: "https://research-information.bris.ac.uk/en/publications/mental-poker-revisited/",
  },
  {
    title: "Participants shuffle the locked cards",
    text: [
      "Encryption locks each card so its value cannot be read",
      "The server shuffles first and player browsers follow in seat order",
      "Each participant secretly reorders all 52 locked cards",
      "Each participant also refreshes every lock without changing the card inside",
      "The new deck becomes the starting deck for the next participant",
      "One honest secret shuffle keeps the final order unknown to every other participant",
    ],
    source: "Neff on verifiable secret shuffles",
    href: "https://dl.acm.org/doi/10.1145/501983.502000",
  },
  {
    title: "Noir proves each shuffle kept the same cards",
    text: [
      "A Noir circuit is a program that checks rules without publishing the secret inputs",
      "The circuit receives the secret card order and the fresh values used to refresh every lock",
      "It confirms that every old position appears once in the new order",
      "It rebuilds all 52 locked output cards and matches them with the published deck",
      "Barretenberg is the software that creates and verifies UltraHonk proofs",
      "An UltraHonk proof lets anyone confirm that every circuit check passed without learning the secret card order",
    ],
    source: "Noir proving and verification",
    href: "https://noir-lang.org/docs/getting_started_manually",
  },
  {
    title: "Each shuffle proof names one hand",
    text: [
      "Public inputs are the visible values covered by a proof",
      "These inputs contain the hand number participant transcript fingerprint combined public key old deck and new deck",
      "The verifier rebuilds the same inputs from the downloaded transcript",
      "It then checks the proof against those exact values",
      "Using the proof for another hand or another deck makes verification fail",
    ],
    source: "Noir proving and verification",
    href: "https://noir-lang.org/docs/getting_started_manually",
  },
  {
    title: "Participants open only the cards in play",
    text: [
      "The shuffled deck stays locked when betting starts",
      "Every participant supplies one part needed to unlock a chosen card position",
      "For a private card the owner receives the other parts and finishes opening the card inside its browser",
      "For a community card every part becomes public so every browser can open it",
      "Each part includes a Chaum Pedersen proof",
      "A Chaum Pedersen proof confirms that the part came from the private number behind the public key without exposing that number",
    ],
    source: "Chaum and Pedersen equality proofs",
    href: "https://chaum.com/wp-content/uploads/2021/12/Wallet_Databases.pdf",
  },
  {
    title: "The server records every public message",
    text: [
      "A transcript is the ordered record of every public message accepted for the hand",
      "Each entry stores its position message type sender contents and running fingerprint",
      "The verifier reads every entry in order",
      "It matches each entry with the recorded key proof shuffle proof unlocking part card reveal or final key",
    ],
    source: "NIST SHA 256 standard",
    href: "https://csrc.nist.gov/pubs/fips/180-4/upd1/final",
  },
  {
    title: "Participants open the full deck after the hand",
    text: [
      "After the hand ends every participant publishes its private key for that hand",
      "The verifier recreates each public key from that private key",
      "The recreated key must match the public key published before shuffling",
      "The verifier uses all private keys to remove every lock from all 52 cards",
      "Each opened value must be a valid card number",
      "The final list must contain card numbers 0 through 51 once and match every card revealed during play",
    ],
    source: "Mental Poker Revisited",
    href: "https://research-information.bris.ac.uk/en/publications/mental-poker-revisited/",
  },
  {
    title: "SHA 256 links every transcript message",
    text: [
      "SHA 256 is a hash function that turns data into a fixed fingerprint",
      "The first fingerprint includes the room and hand number",
      "Each next fingerprint includes the prior fingerprint and the next message",
      "The chain head shown above is the final fingerprint after every message",
      "Changing moving or removing one message changes the chain head",
    ],
    source: "NIST SHA 256 standard",
    href: "https://csrc.nist.gov/pubs/fips/180-4/upd1/final",
  },
  {
    title: "The browser checks the completed transcript",
    text: [
      "This page downloads the accepted transcript and checks it inside the browser",
      "Download Proof Transcript saves the same public data as a JSON file",
      "The local script reads that file without contacting the poker server",
      "Both checks inspect the starting deck keys shuffle proofs unlocking parts revealed cards final keys and SHA 256 chain",
      "Any changed or invalid value makes verification fail",
    ],
    source: "Portable verifier source",
    href: "https://github.com/ishanrk/noir-poker/blob/5c3c9c49687b10ed0cf61bc32c95aed5736b90d4/apps/web/scripts/verify-deal.mjs",
  },
] as const;

const verifierSource = "https://github.com/ishanrk/noir-poker/blob/5c3c9c49687b10ed0cf61bc32c95aed5736b90d4/apps/web/scripts/verify-deal.mjs";

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

export function DealAuditView({ room, hand }: { room: string; hand: number }) {
  const [audit, setAudit] = useState<DealAudit>();
  const [check, setCheck] = useState<DeckCheck>();
  const [state, setState] = useState<AuditState>("loading");
  const [step, setStep] = useState("loading transcript");
  const [error, setError] = useState<string>();
  const [protocolStep, setProtocolStep] = useState(0);

  useEffect(() => {
    let live = true;
    const lifetime = new AbortController();
    queueMicrotask(() => {
      if (!live) return;
      setState("loading"); setAudit(undefined); setCheck(undefined); setError(undefined);
      setStep("loading transcript");
    });
    void loadDealAudit(room, hand)
      .then(async (value) => {
        if (!live) return;
        const matchesRoom = room.length === 8 ? value.room.replaceAll("-", "").slice(0, 8).toLowerCase() === room.toLowerCase() : value.room.toLowerCase() === room.toLowerCase();
        if (value.hand_no !== hand || !matchesRoom) throw new Error("deck proof mismatch");
        setAudit(value);
        const result = await verifyDeck(value, (next) => live && setStep(next), lifetime.signal);
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
    return () => { live = false; lifetime.abort(); };
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
          <p>Check this completed shuffle and deck opening in your browser</p>
        </div>
        <div className="deck-proof-seal" data-state={state}>
          <span>{state === "verified" ? "VALID" : state === "unavailable" ? "UNAVAILABLE" : state === "failed" ? "FAILED" : "CHECKING"}</span>
          <small>{state === "loading" ? step : state === "unavailable" ? "no encrypted transcript" : `${audit?.shuffles.length ?? 0} shuffle proofs`}</small>
        </div>
      </header>

      {state === "unavailable" ? (
        <section className="deck-unavailable">
          <strong>No completed encrypted transcript is available</strong>
          <p>The hand may still be opening, may have been interrupted, or may use an older deal format. Return to hand history to check its status.</p>
        </section>
      ) : error ? <p className="proof-error">{error}</p> : null}

      {audit && (
        <section className="audit-transcript">
          <header className="audit-transcript-head">
            <span>Transcript</span>
            <h2>Hand {audit.hand_no + 1} record</h2>
            <p>The exact public record checked in this browser</p>
          </header>
          <div className="audit-record">
            <dl className="audit-record-meta">
              <div><dt>Room</dt><dd>{audit.room}</dd></div>
              <div><dt>Hand</dt><dd>{audit.hand_no + 1}</dd></div>
            </dl>
            <div className="audit-record-hash">
              <span>SHA 256 chain head</span>
              <strong>{audit.transcript_hash}</strong>
            </div>
          </div>
          <div className="audit-proof-actions">
            <Link className="text-action" href={`/table/${room}`}>Return to table</Link>
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
          <ol className="deck-protocol-explanation">
            {current.text.map((line) => <li key={line}>{line}</li>)}
          </ol>
          <a href={current.href} target="_blank" rel="noreferrer">Source&nbsp; {current.source} ↗</a>
        </article>
        <div className="deck-protocol-controls">
          <button type="button" disabled={protocolStep === 0} onClick={() => setProtocolStep((value) => value - 1)}>Previous</button>
          <output>Step {protocolStep + 1} of {protocol.length}</output>
          <button type="button" disabled={protocolStep === protocol.length - 1} onClick={() => setProtocolStep((value) => value + 1)}>Next Step</button>
        </div>
      </section>

      <section className="deck-limit">
        <strong>What this check cannot guarantee</strong>
        <p>A player or server can stop responding. A valid shuffle proof does not guarantee availability, custody of funds, payout rules, or one history shared by every player. The hash chain binds this record, but does not prevent different records being shown to different people.</p>
        <p>Cards are private during play. After completion the deck opening lets anyone reconstruct every card, including folded cards. Private challenge objectives use a separate proof.</p>
      </section>
    </main>
  );
}
