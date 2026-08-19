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
  const label =
    deal.state === "collecting"
      ? `${deal.contributors}/${deal.required} randomness shares`
      : deal.state === "sealed"
        ? "deck fixed before play"
        : "transcript open for replay";

  return (
    <section className={`deal-integrity${compact ? " deal-integrity-compact" : ""}`}>
      <div className="deal-stack" data-state={deal.state} aria-hidden="true">
        <i />
        <i />
        <i />
        <span>{deal.state === "revealed" ? "✓" : "◆"}</span>
      </div>
      <div className="deal-copy">
        <p className="protocol-label">Deal / Hand {deal.hand_no}</p>
        <strong>{label}</strong>
        <code title={deal.commitment}>{deal.commitment.slice(0, 16)}…</code>
      </div>
      <div className="deal-actions">
        <span className="deal-state">{deal.state}</span>
        {deal.audit ? (
          <Link href={`/audit/${room}/${deal.hand_no}`}>Replay deal →</Link>
        ) : (
          <Link href="/protocol">Protocol →</Link>
        )}
      </div>
    </section>
  );
}
