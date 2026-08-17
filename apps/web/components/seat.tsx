import { Card } from "@/components/card";

type SeatProps = {
  position: 0 | 1 | 2 | 3 | 4 | 5;
  name?: string;
  stack?: number;
  bet?: number;
  proofPoints?: number;
  cards?: readonly [string, string];
  acting?: boolean;
  dealer?: boolean;
  empty?: boolean;
};

export function Seat({
  position,
  name,
  stack,
  bet,
  proofPoints,
  cards,
  acting = false,
  dealer = false,
  empty = false,
}: SeatProps) {
  const className = `seat seat-${position}${acting ? " seat-acting" : ""}${empty ? " seat-empty" : ""}`;

  return (
    <section className={className} aria-label={empty ? `Seat ${position} open` : name}>
      {!empty && (
        <div className="seat-cards">
          <Card value={cards?.[0]} hidden={!cards} />
          <Card value={cards?.[1]} hidden={!cards} />
        </div>
      )}

      <div className="seat-panel">
        {dealer && (
          <div className="seat-markers">
            <span className="dealer-marker">D</span>
          </div>
        )}

        {empty ? (
          <>
            <strong>Open seat</strong>
            <span>Seat {position}</span>
          </>
        ) : (
          <>
            <strong>{name}</strong>
            <span>{stack?.toLocaleString("en-US")}</span>
            {!!bet && <small>Bet {bet.toLocaleString("en-US")}</small>}
            {!!proofPoints && <small>{proofPoints} proof points</small>}
            {acting && <small>Acting</small>}
          </>
        )}
      </div>
    </section>
  );
}
