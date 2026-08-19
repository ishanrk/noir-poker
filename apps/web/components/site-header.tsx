import Link from "next/link";

export function SiteHeader({ compact = false }: { compact?: boolean }) {
  return (
    <header className={`site-header${compact ? " site-header-compact" : ""}`}>
      <Link className="wordmark" href="/" aria-label="Noir Poker home">
        Noir Poker
      </Link>
      <nav aria-label="Primary navigation">
        <Link href="/">Play</Link>
        <Link href="/motivation">Motivation</Link>
        <Link href="/protocol">Protocol</Link>
      </nav>
    </header>
  );
}
