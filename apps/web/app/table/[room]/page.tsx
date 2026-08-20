import { MultiplayerGame } from "@/components/multiplayer-game";
import { SiteHeader } from "@/components/site-header";

type TablePageProps = { params: Promise<{ room: string }> };

export default async function TablePage({ params }: TablePageProps) {
  const { room } = await params;

  return (
    <main className="site-shell table-page">
      <SiteHeader compact />
      <header className="table-page-header">
        <div>
          <p className="eyebrow">Live table / {room.slice(0, 8)}</p>
          <h1>Noir Poker</h1>
        </div>
        <p>server-authoritative hold&apos;em with auditable deals and local zero-knowledge proving</p>
      </header>
      <MultiplayerGame key={room} room={room} />
    </main>
  );
}
