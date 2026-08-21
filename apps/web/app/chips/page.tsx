import Image from "next/image";

import { AztecPlayChips } from "@/components/aztec-play-chips";
import { SiteHeader } from "@/components/site-header";

const TAJADERO =
  "https://americanhistory.si.edu/collections/object/nmah_835166";

export default function ChipsPage() {
  return (
    <main className="site-shell chips-story">
      <SiteHeader />

      <section className="chips-story-hero">
        <div>
          <p className="story-kicker">Aztec testnet</p>
          <h1>Tajadero</h1>
          <p>
            The table name for the PLAY testnet chip. Claim a balance, then lock a private buy-in to
            one room and seat.
          </p>
        </div>
        <div className="chip-orbit" aria-hidden="true">
          <Image src="/assets/poker-chip.svg" alt="" width={112} height={112} />
          <Image src="/assets/poker-chip.svg" alt="" width={112} height={112} />
          <Image src="/assets/poker-chip.svg" alt="" width={112} height={112} />
        </div>
      </section>

      <section className="chips-story-note">
        <span>Why Tajadero</span>
        <p>
          Copper tajaderos circulated as hoe or axe money in central Mexico and parts of Central
          America. The contract still exposes the test unit as PLAY.
        </p>
        <a href={TAJADERO} target="_blank" rel="noreferrer">
          Smithsonian record
        </a>
      </section>

      <section className="chips-story-console">
        <AztecPlayChips />
      </section>
    </main>
  );
}
