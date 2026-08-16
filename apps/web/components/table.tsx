import { Card } from "@/components/card";
import { Seat } from "@/components/seat";

export function Table() {
  return (
    <section className="table-shell" aria-label="Six-max poker table">
      <div className="table-stage">
        <div className="table-surface">
          <div className="table-label">
            <span>Table 01</span>
            <strong>5 / 10 NLH</strong>
          </div>

          <div className="board-area">
            <div className="pot">
              <span>Pot</span>
              <strong>120</strong>
            </div>

            <div className="board" aria-label="Community cards">
              <Card value="10♣" />
              <Card value="J♦" />
              <Card value="Q♠" />
              <Card />
              <Card />
            </div>
          </div>
        </div>

        <Seat position={0} name="You" stack="1,000" cards={["A♠", "K♥"]} acting />
        <Seat position={1} name="Mara" stack="950" blind="SB" />
        <Seat position={2} name="Leon" stack="1,340" />
        <Seat position={3} empty />
        <Seat position={4} name="Iris" stack="780" dealer />
        <Seat position={5} name="Niko" stack="1,120" blind="BB" />
      </div>

      <div className="action-bar" aria-label="Player actions">
        <div className="action-copy">
          <span>Your action</span>
          <strong>20 to call</strong>
        </div>

        <div className="actions">
          <button type="button">Fold</button>
          <button type="button">Check</button>
          <button type="button">Call 20</button>
          <button className="raise-button" type="button">
            Raise
          </button>
        </div>
      </div>
    </section>
  );
}
