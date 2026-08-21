import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div>
        <span>Noir Poker</span>
        <p>Rust game state, auditable dealing and private Noir challenges.</p>
      </div>
      <nav aria-label="Project links">
        <Link href="/rules">Rules</Link>
        <Link href="/motivation">Motivation</Link>
        <Link href="/protocol">Protocol</Link>
        <Link href="/chips">Chips</Link>
        <a href="https://github.com/ishanrk/noir-poker" target="_blank" rel="noreferrer">
          Source
        </a>
      </nav>
      <div className="site-footer-developer">
        <span>Developer</span>
        <a href="https://ishankumthekar.com" target="_blank" rel="noreferrer">
          Ishan Kumthekar
        </a>
      </div>
    </footer>
  );
}
