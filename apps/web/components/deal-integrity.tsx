import Link from "next/link";

export type DealView = {
  hand_no: number;
  commitment: string;
  contributors: number;
  required: number;
  mine: boolean;
  state: "collecting" | "sealed" | "revealed";
  audit: boolean;
};

export function DealIntegrity({
  deal,
  room,
  compact = false,
}: {
  deal: DealView;
  room: string;
  compact?: boolean;
}) {
  return (
    <section className={`deal-integrity${compact ? " deal-integrity-compact" : ""}`}>
      <div className="deal-stack" data-state={deal.state} aria-hidden="true">
        <i />
        <i />
        <i />
        <span>{deal.state === "revealed" ? "✓" : "◆"}</span>
      </div>
      <div className="deal-copy">
        <p className="protocol-label">Deck Randomness Proof</p>
        <strong>Short proof showing server didn&apos;t cheat the deck</strong>
        <code title={deal.commitment}>SHA-256 {deal.commitment}</code>
      </div>
      <div className="deal-actions">
        {deal.audit ? (
          <>
            <span className="deal-state">Deck Randomness Verification</span>
            <Link href={`/audit/${room}/${deal.hand_no}`}>Verify Deck →</Link>
          </>
        ) : (
          <span>Available after hand</span>
        )}
      </div>
    </section>
  );
}
