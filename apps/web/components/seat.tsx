import { Card } from "@/components/card";

type SeatProps = {
  position: 0 | 1 | 2 | 3 | 4 | 5;
  name?: string;
  stack?: string;
  cards?: readonly [string, string];
  acting?: boolean;
  dealer?: boolean;
  blind?: "SB" | "BB";
  empty?: boolean;
};

export function Seat({
  position,
  name,
  stack,
  cards,
  acting = false,
  dealer = false,
  blind,
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
        {(dealer || blind) && (
          <div className="seat-markers">
            {dealer && <span className="dealer-marker">D</span>}
            {blind && <span className="blind-marker">{blind}</span>}
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
            <span>{stack}</span>
            {acting && <small>Acting</small>}
          </>
        )}
      </div>
    </section>
  );
}
