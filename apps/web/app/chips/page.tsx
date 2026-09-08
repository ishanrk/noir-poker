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
          <h1>Tajaderos</h1>
          <p>
            Private test credits on Aztec. Claim a balance, then join a table.
          </p>
        </div>
      </section>

      <section className="chips-story-note">
        <span>Why Tajadero</span>
        <p>
          Copper tajaderos circulated as hoe or axe money in central Mexico and parts of Central
          America. Noir Poker uses the name for its private test credit.
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
