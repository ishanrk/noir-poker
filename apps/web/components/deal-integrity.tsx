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

export function PreviousDealIntegrity({ room, hand }: {
  room: string;
  hand: number;
}) {
  return (
    <section className="deal-integrity deal-integrity-compact" data-proof-tour="deck">
      <div className="deal-stack" data-state="revealed" aria-hidden="true">
        <i />
        <i />
        <i />
        <span>✓</span>
      </div>
      <div className="deal-copy">
        <strong>Deck Randomness Proof — Hand {hand + 1}</strong>
      </div>
      <div className="deal-actions">
        <Link href={`/audit/${room}/${hand}`} target="_blank">
          Verify Deck →
        </Link>
      </div>
    </section>
  );
}
