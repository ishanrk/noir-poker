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
    <main className={`site-shell table-page${aztec ? " table-page-aztec" : ""}`}>
      <SiteHeader compact />
      <header className="table-page-header">
        {aztec ? (
          <>
            <div>
              <p className="eyebrow">Aztec table</p>
              <h1>Room {room.slice(0, 8)}</h1>
            </div>
            <p className="aztec-table-credit">
              <span>Tajaderos locked</span>
              <strong>1,000</strong>
            </p>
          </>
        ) : (
          <div>
            <p className="eyebrow">Live table · {room.slice(0, 8)}</p>
            <h1>Noir Poker</h1>
          </div>
        )}
      </header>
      <MultiplayerGame key={room} room={room} initialMode={aztec ? "aztec" : undefined} />
    </main>
  );
}
