import Link from "next/link";

const LINKS = [
  ["/", "Play"],
  ["/rules", "Rules"],
  ["/motivation", "Motivation"],
  ["/protocol", "Protocol"],
  ["/chips", "Chips"],
] as const;

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
        {LINKS.map(([href, label]) => (
          <Link href={href} key={href}>
            {label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
