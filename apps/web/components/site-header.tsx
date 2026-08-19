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
        <Link href="/chips">Play chips</Link>
        <Link href="/rules">Rules</Link>
        <Link href="/motivation">Motivation</Link>
        <Link href="/protocol">Protocol</Link>
      </nav>
    </header>
  );
}
