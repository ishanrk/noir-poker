import { Lobby } from "@/components/lobby";

export default function Home() {
  return (
    <main className="page">
      <header className="page-header">
        <p className="eyebrow">Noir / UltraHonk</p>
        <h1>Noir Poker</h1>
        <p>private poker · fair hidden objectives · zero-knowledge receipts</p>
      </header>

      <Lobby />
    </main>
  );
}
