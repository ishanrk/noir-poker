import { MultiplayerGame } from "@/components/multiplayer-game";

type TablePageProps = {
  params: Promise<{ room: string }>;
};

export default async function TablePage({ params }: TablePageProps) {
  const { room } = await params;

  return (
    <main className="page">
      <header className="page-header">
        <p className="eyebrow">Live / Fair draw</p>
        <h1>Noir Poker</h1>
        <p>server-authoritative poker · private objectives · local proving</p>
      </header>

      <MultiplayerGame key={room} room={room} />
    </main>
  );
}
