import { Lobby } from "@/components/lobby";

export default function Home() {
  return (
    <main className="page">
      <header className="page-header">
        <p className="eyebrow">Private tables</p>
        <h1>Noir Poker</h1>
        <p>Private poker with secret contracts proved in zero knowledge</p>
      </header>

      <Lobby />
    </main>
  );
}
