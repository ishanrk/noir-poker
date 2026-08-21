import Link from "next/link";

export function SiteHeader({ compact = false }: { compact?: boolean }) {
  return (
    <header className={`site-header${compact ? " site-header-compact" : ""}`}>
      <Link className="wordmark" href="/" aria-label="Noir Poker home">
        <span className="wordmark-suit" aria-hidden="true">
          ♠
        </span>
        <span>Noir Poker</span>
      </Link>
      <nav aria-label="Primary navigation">
        <Link href="/">Play</Link>
      </nav>
    </header>
  );
}
