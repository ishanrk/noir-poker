"use client";

import { useEffect, useState, type CSSProperties } from "react";

import { Card } from "@/components/card";
import { SiteHeader } from "@/components/site-header";
import { verifyDeck, type DeckCheck } from "@/lib/deck-audit";
import { cardValue } from "@/lib/deal";
import { loadDealAudit, type DealAudit } from "@/lib/server";

type AuditState = "loading" | "verified" | "unavailable" | "failed";

const protocol = [
  {
    title: "Build a key nobody owns",
    text: "The server and every human browser create a fresh secret key for this hand. Only the public points leave their devices. Those points combine into one deck key. No participant knows the full secret.",
    check: "The transcript checks every public key proof in participant order",
    source: "Barnett and Smart on mental poker",
    href: "https://research-information.bris.ac.uk/en/publications/mental-poker-revisited/",
  },
  {
    title: "Encrypt the known deck",
    text: "The protocol begins with the same public list of 52 card points. Every card gets encrypted under the joint key. The verifier first confirms that exact canonical starting deck.",
    check: "The card identities become hidden while the starting set stays fixed",
    source: "Mental Poker Revisited",
    href: "https://research-information.bris.ac.uk/en/publications/mental-poker-revisited/",
  },
  {
    title: "Shuffle without showing the order",
    text: "The server shuffles first. Every human browser follows with a secret permutation and fresh encryption masks. The Noir circuit proves each output contains the prior 52 ciphertexts in a new hidden order.",
    check: "One honest shuffle prevents every earlier participant from knowing the final order",
    source: "Neff on verifiable secret shuffles",
    href: "https://dl.acm.org/doi/10.1145/501983.502000",
  },
  {
    title: "Open only cards in play",
    text: "Participants release proven decryption shares only for the positions needed now. A player finishes their hole cards locally. Community cards open when their street begins.",
    check: "Equality proofs bind each share to the same participant key",
    source: "Chaum and Pedersen equality proofs",
    href: "https://chaum.com/wp-content/uploads/2021/12/Wallet_Databases.pdf",
  },
  {
    title: "Check every shuffle proof",
    text: "Each browser loads the accepted proof bytes and the pinned verification key. Barretenberg verifies the UltraHonk proof. The public inputs bind the hand number transcript state joint key input deck and output deck.",
    check: "A valid proof permits a permutation and fresh masks but no swapped or invented card",
    source: "Noir proving and verification",
    href: "https://noir-lang.org/docs/getting_started_manually",
  },
  {
    title: "Reconstruct the final deck",
    text: "After settlement every participant opens their hand key. The verifier matches each opening to its public key then decrypts all 52 positions. It also checks that every card from 0 through 51 appears once.",
    check: "SHA 256 identifies the exact ordered transcript but the proof checks establish fairness",
    source: "NIST SHA 256 standard",
    href: "https://csrc.nist.gov/pubs/fips/180-4/upd1/final",
  },
] as const;

export function DealAuditView({ room, hand }: { room: string; hand: number }) {
  const [audit, setAudit] = useState<DealAudit>();
  const [check, setCheck] = useState<DeckCheck>();
  const [state, setState] = useState<AuditState>("loading");
  const [step, setStep] = useState("loading transcript");
  const [error, setError] = useState<string>();
  const [all, setAll] = useState(false);
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

  const shown = check?.deck.slice(0, all ? 52 : 20) ?? [];
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
        </section>
      )}

      {check && (
        <section className="deck-opening">
          <header>
            <p className="protocol-label">Deterministic reconstruction</p>
            <h2>{all ? "All 52 cards" : "First 20 cards"}</h2>
            <p>Cards open in their final encrypted deck positions after every proof and final key opening passes</p>
          </header>
          <div className="deck-opening-stream">
            {shown.map((card, index) => (
              <div key={`${index}-${card}`} style={{ "--open-index": index } as CSSProperties}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <Card value={cardValue(card)} delay={index * 125} />
              </div>
            ))}
          </div>
          <button type="button" className="proof-link" onClick={() => setAll((value) => !value)}>
            {all ? "Show First 20" : "Open All 52"}
          </button>
        </section>
      )}

      <section className="deck-protocol">
        <header>
          <p className="protocol-label">Protocol walkthrough</p>
          <h2>Follow the deck</h2>
          <p>Six checks from public keys to the final 52 cards</p>
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
