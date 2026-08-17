import { MultiplayerGame } from "@/components/multiplayer-game";

type TablePageProps = {
  params: Promise<{ room: string }>;
};

export default async function TablePage({ params }: TablePageProps) {
  const { room } = await params;

  return (
    <main className="page">
      <header className="page-header">
        <p className="eyebrow">Private table</p>
        <h1>Noir Poker</h1>
        <p>Server authoritative hand</p>
      </header>

      <MultiplayerGame key={room} room={room} />
    </main>
  );
}
