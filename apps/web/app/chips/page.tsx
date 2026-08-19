import { AztecPlayChips } from "@/components/aztec-play-chips";
import { SiteHeader } from "@/components/site-header";

export default function ChipsPage() {
  return (
    <>
      <SiteHeader />
      <main className="page chips-page">
        <AztecPlayChips />
      </main>
    </>
  );
}
