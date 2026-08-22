"use client";

import { useEffect, useState, type CSSProperties } from "react";

import { Card } from "@/components/card";
import { SiteHeader } from "@/components/site-header";
import { verifyDeck, type DeckCheck } from "@/lib/deck-audit";
import { cardValue } from "@/lib/deal";
import { loadDealAudit, type DealAudit } from "@/lib/server";

type AuditState = "loading" | "verified" | "failed";

export function DealAuditView({ room, hand }: { room: string; hand: number }) {
  const [audit, setAudit] = useState<DealAudit>();
  const [check, setCheck] = useState<DeckCheck>();
  const [state, setState] = useState<AuditState>("loading");
  const [step, setStep] = useState("loading transcript");
  const [error, setError] = useState<string>();
  const [all, setAll] = useState(false);

  useEffect(() => {
    let live = true;
    void loadDealAudit(room, hand)
      .then(async (value) => {
        if (!live) return;
        setAudit(value);
        const result = await verifyDeck(value, (next) => live && setStep(next));
        if (!live) return;
        setCheck(result);
        setState("verified");
      })
      .catch((cause) => {
        if (!live) return;
        setState("failed");
        setError(cause instanceof Error ? cause.message : "deck verification failed");
      });
    return () => { live = false; };
  }, [hand, room]);

  const shown = check?.deck.slice(0, all ? 52 : 20) ?? [];

  return (
    <main className="site-shell audit-page deck-proof-page">
      <SiteHeader compact />
      <header className="audit-hero">
        <div>
          <p className="eyebrow">Deck Randomness Verification</p>
          <h1>{state === "verified" ? "Every shuffle checks out" : state === "failed" ? "Verification failed" : "Checking the encrypted deck"}</h1>
          <p>Proves that the deck was randomly sampled and that the server did not cheat or deal unfair cards to a chosen player</p>
        </div>
        <div className="deck-proof-seal" data-state={state}>
          <span>{state === "verified" ? "VALID" : state === "failed" ? "FAILED" : "CHECKING"}</span>
          <small>{state === "loading" ? step : `${audit?.shuffles.length ?? 0} shuffle proofs`}</small>
        </div>
      </header>

      {error && <p className="proof-error">{error}</p>}

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

      <section className="deck-protocol-blocks">
        <article>
          <span>01</span>
          <h2>Joint deck key</h2>
          <p>Every human browser creates a private Grumpkin key for this hand. The server creates one more. Their public points combine into one deck key. No participant holds the full private key.</p>
        </article>
        <article>
          <span>02</span>
          <h2>Encrypted cards</h2>
          <p>The canonical 52 cards begin as curve points under the joint key. Ciphertexts hide card identities while preserving a form that supports fresh encryption during each shuffle.</p>
        </article>
        <article>
          <span>03</span>
          <h2>Private shuffles</h2>
          <p>The server shuffles first. Every human browser shuffles after it. Each participant chooses a secret permutation and fresh masks. A Noir UltraHonk proof binds the new encrypted deck to a valid permutation of the prior deck without revealing that permutation.</p>
        </article>
        <article>
          <span>04</span>
          <h2>Selective dealing</h2>
          <p>Decryption shares open only the positions needed at that moment. A player finishes their own hole card decryption locally. Community positions open when each street begins. DLEQ proofs bind every share to the participant key.</p>
        </article>
        <article>
          <span>05</span>
          <h2>Final reconstruction</h2>
          <p>After settlement each participant opens the hand key. This page checks every key proof and shuffle proof then decrypts all 52 positions. One honest private shuffle makes the final order unpredictable to every earlier participant including the server.</p>
        </article>
        <article>
          <span>06</span>
          <h2>Transcript fingerprint</h2>
          <p>SHA 256 covers the ordered transcript records and their payloads. It identifies this exact encrypted shuffle and proof chain. The fingerprint alone does not prove fairness. The cryptographic checks performed on this page provide that evidence.</p>
        </article>
      </section>

      <section className="deck-limit">
        <strong>Abort boundary</strong>
        <p>A server or player can still disconnect. No protocol can force another machine to send a packet. An abort cannot secretly replace the proven deck and remains visible as an incomplete transcript.</p>
      </section>
    </main>
  );
}
