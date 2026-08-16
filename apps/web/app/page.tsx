import { Game } from "@/components/game";

export default function Home() {
  return (
    <main className="page">
      <header className="page-header">
        <p className="eyebrow">Private table</p>
        <h1>Noir Poker</h1>
        <p>Six-max No-Limit Hold&apos;em</p>
      </header>

      <Game />
    </main>
  );
}
