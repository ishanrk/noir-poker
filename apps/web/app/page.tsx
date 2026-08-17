import { Lobby } from "@/components/lobby";

export default function Home() {
  return (
    <main className="page">
      <header className="page-header">
        <p className="eyebrow">Private tables</p>
        <h1>Noir Poker</h1>
        <p>Server authoritative No-Limit Hold&apos;em</p>
      </header>

      <Lobby />
    </main>
  );
}
