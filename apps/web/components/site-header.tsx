import Link from "next/link";

export function SiteHeader({ compact = false }: { compact?: boolean }) {
  return (
    <header className={`site-header${compact ? " site-header-compact" : ""}`}>
      <Link className="wordmark" href="/" aria-label="Noir Poker home">
        Noir Poker
      </Link>
      <nav aria-label="Primary navigation">
        <Link href="/">Play</Link>
        <Link href="/protocol">Protocol</Link>
        <a href="https://github.com/ishanrk/noir-poker" target="_blank" rel="noreferrer">
          Source ↗
        </a>
      </nav>
      <span className="header-mark" aria-hidden="true">
        NP / 01
      </span>
    </header>
  );
}
