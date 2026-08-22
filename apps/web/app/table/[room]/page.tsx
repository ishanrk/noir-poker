import { MultiplayerGame } from "@/components/multiplayer-game";
import { SiteHeader } from "@/components/site-header";

type TablePageProps = {
  params: Promise<{ room: string }>;
  searchParams: Promise<{ mode?: string }>;
};

export default async function TablePage({ params, searchParams }: TablePageProps) {
  const [{ room }, query] = await Promise.all([params, searchParams]);
  const aztec = query.mode === "aztec";

  return (
    <main className="site-shell table-page">
      <SiteHeader compact />
      <header className="table-page-header">
        <div>
          <p className="eyebrow">
            {aztec ? "Aztec table" : "Live table"} / {room.slice(0, 8)}
          </p>
          <h1>Noir Poker</h1>
        </div>
        {aztec && <p>private PLAY buy-in recorded on Aztec testnet</p>}
      </header>
      <MultiplayerGame key={room} room={room} />
    </main>
  );
}
