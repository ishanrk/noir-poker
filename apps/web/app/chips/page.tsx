import { AztecPlayChips } from "@/components/aztec-play-chips";
import { SiteHeader } from "@/components/site-header";
import { AZTEC_ENABLED } from "@/lib/aztec/config";

export default function ChipsPage() {
  return (
    <>
      <SiteHeader />
      <main className="page chips-page">
        {AZTEC_ENABLED ? <AztecPlayChips /> : <p>Experimental Aztec is disabled. Ordinary poker uses wallet-free play chips.</p>}
      </main>
    </>
  );
}
