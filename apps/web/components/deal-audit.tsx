"use client";
import { useEffect, useMemo, useState, type CSSProperties } from "react";

import { Card } from "@/components/card";
import styles from "@/components/crypto.module.css";
import { SiteHeader } from "@/components/site-header";
import { cardValue, verifyDealAudit, type DealVerification } from "@/lib/deal";
import { loadDealAudit, type DealAudit } from "@/lib/server";

type AuditState = "loading" | "verified" | "failed";

export function DealAuditView({ room, hand }: { room: string; hand: number }) {
  const [audit, setAudit] = useState<DealAudit>();
  const [verification, setVerification] = useState<DealVerification>();
  const [state, setState] = useState<AuditState>("loading");
  const [error, setError] = useState<string>();
  const [replay, setReplay] = useState(0);

  useEffect(() => {
    let live = true;
    void loadDealAudit(room, hand)
      .then((value) => {
        const result = verifyDealAudit(value);
        if (!live) return;
        setAudit(value);
        setVerification(result);
        setState("verified");
      })
      .catch((cause) => {
        if (!live) return;
        setState("failed");
        setError(cause instanceof Error ? cause.message : "deal verification failed");
      });
    return () => { live = false; };
  }, [hand, room]);

  const layout = verification?.layout;
  const dealt = useMemo(() => {
    if (!layout) return [];
    return layout.hole.flat().concat(layout.burns, layout.board).map(cardValue);
  }, [layout]);

  function exportAudit() {
    if (!audit) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(audit, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `noir-poker-deal-${audit.room.slice(0, 8)}-${audit.hand_no}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="site-shell audit-page">
      <SiteHeader compact />
      <header className="audit-hero">
        <div>
          <p className="eyebrow">Independent deal audit</p>
          <h1>{state === "verified"
            ? "52 / 52 positions reproduced."
            : state === "failed"
              ? "Verification failed."
              : "Verifying locally."}</h1>
          <p>The browser recomputes the commitment, seed, shuffle and deal locally.</p>
        </div>
        <div className="audit-deck" data-state={state} data-replay={replay}>
          {Array.from({ length: 9 }, (_, index) => <i key={index} style={{ "--card-index": index } as CSSProperties} />)}
          <strong>{state === "verified" ? "52 / 52" : "…"}</strong>
        </div>
      </header>

      <section className="audit-steps" aria-live="polite">
        {[
          ["01", "Open commitment", verification?.commitment],
          ["02", "Combine player entropy", verification?.seed],
          ["03", "Replay unbiased shuffle", verification?.shuffle],
          ["04", "Map seats and board", verification?.seats],
        ].map(([number, label, passed]) => (
          <div key={String(number)} data-state={passed ? "verified" : state}>
            <span>{number}</span><strong>{label}</strong><i>{passed ? "pass" : state}</i>
          </div>
        ))}
      </section>

      {error && <p className="proof-error">{error}</p>}

      <div className={styles.verifyState} data-state={state} aria-live="polite">
        {state === "loading" ? "VERIFYING LOCALLY" : state === "verified" ? "52 / 52 POSITIONS REPRODUCED" : "VERIFICATION FAILED"}
      </div>

      {audit && layout && (
        <>
          <section className="audit-transcript">
            <div className="section-index"><span>Transcript</span><p>Public after settlement</p></div>
            <dl>
              <div><dt>room / hand</dt><dd>{audit.room} / {audit.hand_no}</dd></div>
              <div><dt>server commitment</dt><dd>{audit.commitment}</dd></div>
              <div><dt>revealed server secret</dt><dd>{audit.server_secret}</dd></div>
              <div><dt>combined seed</dt><dd>{audit.seed}</dd></div>
              <div><dt>player shares</dt><dd>{audit.contributions.length} ordered contributions</dd></div>
              <div><dt>algorithm</dt><dd>{audit.algorithm}</dd></div>
              <div><dt>starting stacks</dt><dd>{audit.starting_stacks.join(" / ")}</dd></div>
            </dl>
          </section>

          <section className="deal-replay" key={replay}>
            <header>
              <div><p className="protocol-label">Deterministic deal map</p><h2>Verified deal</h2></div>
              <button type="button" onClick={() => setReplay((value) => value + 1)}>Replay motion ↻</button>
            </header>
            <div className="audit-table">
              <div className="audit-board">
                {layout.board.map((card, index) => <Card key={card} value={cardValue(card)} delay={1200 + index * 210} />)}
              </div>
              {layout.hole.map((cards, seat) => (
                <div className={`audit-seat audit-seat-${seat}`} key={seat}>
                  <span>Seat {seat + 1}{audit.dealer === seat ? " (dealer)" : ""}</span>
                  <div><Card value={cardValue(cards[0])} delay={seat * 170} /><Card value={cardValue(cards[1])} delay={seat * 170 + 420} /></div>
                </div>
              ))}
              <div className="burn-cards"><span>burns</span>{layout.burns.map(cardValue).join(", ")}</div>
            </div>
            <p className="audit-footnote">The first {dealt.length} consumed positions match the engine&apos;s clockwise deal and three burn rules.</p>
          </section>

          <section className={styles.public}>
            <h2>RECORDED ACTIONS</h2>
            <div className={styles.list}>
              {audit.actions.map((action) => (
                <div className={styles.entry} key={action.seq}>
                  <strong>{String(action.seq + 1).padStart(2, "0")}</strong>
                  <span>PLAYER {action.player + 1}&nbsp;&nbsp;&nbsp;{action.action === "raise_to" ? `RAISE TO ${action.raise_to}` : action.action.toUpperCase()}</span>
                </div>
              ))}
              {!audit.actions.length && <p>NO PLAYER ACTIONS</p>}
            </div>
            <p>These commands come from the durable server log. Their legality is not part of the deck verification above.</p>
          </section>

          <section className={styles.public}>
            <h2>WHY THIS CHECK WORKS</h2>
            <p>The server commits to its secret before final player randomness determines the deck. This browser then rebuilds every shuffle choice after settlement.</p>
            <details>
              <summary>SERVER COMMITMENT AND FINAL SEED</summary>
              <p><code>C = SHA256(&quot;NPDEAL01&quot; || room || hand || server_secret)</code></p>
              <p><code>seed = SHA256(&quot;NPSEED01&quot; || room || hand || share_count || seat_0 || share_0 || ... || server_secret)</code></p>
              <p>Each human share contains 32 bytes from crypto.getRandomValues and remains bound to its seat.</p>
            </details>
            <details>
              <summary>CARD SAMPLING AND REPLAY</summary>
              <p><code>block = SHA256(&quot;NPSTRM01&quot; || seed || counter)</code></p>
              <p>SHA-256 counter blocks provide 32-bit words. Values outside the largest exact multiple of each shrinking range are rejected. Fisher-Yates then reproduces all 52 card positions without modulo bias.</p>
            </details>
            <details>
              <summary>ASSUMPTIONS</summary>
              <p>The check relies on SHA-256 commitment security and pseudorandom hash output. At least one contribution must remain unpredictable before the server commitment. A server can still abort or stop serving a room. Verification becomes available after settlement.</p>
            </details>
            <details>
              <summary>FULL TECHNICAL VALUES</summary>
              <p><strong>ORDERED SHARES</strong></p>
              {audit.contributions.map((entry) => <p key={entry.seat}><code>seat {entry.seat} {entry.share}</code></p>)}
              <p><strong>FULL DECK</strong></p>
              <p><code>{audit.deck.map((card) => card.value).join("  ")}</code></p>
            </details>
          </section>
        </>
      )}

      <section className="receipt-actions">
        <button type="button" onClick={exportAudit} disabled={!audit}>DOWNLOAD JSON</button>
        <details><summary>CLI verifier</summary><code>npm --prefix apps/web run deal:verify -- audit.json</code></details>
      </section>
    </main>
  );
}
