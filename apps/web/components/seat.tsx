import { Card } from "@/components/card";

type SeatProps = {
  position: 0 | 1 | 2 | 3 | 4 | 5;
  name?: string;
  stack?: number;
  bet?: number;
  proofPoints?: number;
  cards?: readonly [string, string];
  awards?: readonly number[];
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
  awards,
  acting = false,
  dealer = false,
  empty = false,
}: SeatProps) {
  const won = !!awards?.length;
  const className = `seat seat-${position}${acting ? " seat-acting" : ""}${won ? " seat-winner" : ""}${empty ? " seat-empty" : ""}`;

  return (
    <section className={className} aria-label={empty ? `Seat ${position + 1} open` : name}>
      {!empty && (
        <div className="seat-cards">
          <Card value={cards?.[0]} hidden={!cards} delay={position * 65} />
          <Card value={cards?.[1]} hidden={!cards} delay={position * 65 + 90} />
        </div>
      )}
      <div className="seat-panel">
        <div className="seat-line" aria-hidden="true" />
        {dealer && <span className="dealer-marker">D</span>}
        {empty ? (
          <>
            <strong>Open</strong>
            <span>seat {position + 1}</span>
          </>
        ) : (
          <>
            <strong>{name}</strong>
            <span>{stack?.toLocaleString("en-US")}</span>
            {!!bet && <small>bet {bet.toLocaleString("en-US")}</small>}
            {!!proofPoints && <small>{proofPoints} proof pts</small>}
            {awards?.map((amount, index) => (
              <small className="seat-award" key={index}>
                +{amount.toLocaleString("en-US")}
              </small>
            ))}
            {acting && <small>acting</small>}
          </>
        )}
      </div>
    </section>
  );
}
