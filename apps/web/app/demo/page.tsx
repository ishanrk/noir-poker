import { Game } from "@/components/game";

export default function Demo() {
  return (
    <main className="page">
      <header className="page-header">
        <p className="eyebrow">Local demo</p>
        <h1>Noir Poker</h1>
        <p>Six-max No-Limit Hold&apos;em</p>
      </header>

      <Game />
    </main>
  );
}
