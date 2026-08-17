const SERVER_URL = (process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3001").replace(
  /\/+$/,
  "",
);

export type RoomConfig = {
  players: number;
  stack: number;
  small_blind: number;
  big_blind: number;
};

export type RoomSeat = {
  seat: number;
  token: string;
};

type SeatResponse = RoomSeat & {
  room: string;
};

async function responseError(response: Response) {
  return (await response.text()).trim() || "request failed";
}

export async function createRoom(config: RoomConfig): Promise<SeatResponse> {
  const response = await fetch(`${SERVER_URL}/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(config),
  });

  if (!response.ok) {
    throw new Error(await responseError(response));
  }

  return response.json();
}

export async function joinRoom(room: string): Promise<SeatResponse> {
  const response = await fetch(`${SERVER_URL}/rooms/${encodeURIComponent(room)}/join`, {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(await responseError(response));
  }

  return response.json();
}

function seatKey(room: string) {
  return `noir-poker-room-${room}`;
}

export function saveSeat(room: string, seat: RoomSeat) {
  sessionStorage.setItem(seatKey(room), JSON.stringify({ seat: seat.seat, token: seat.token }));
}

export function loadSeat(room: string): RoomSeat | undefined {
  const stored = sessionStorage.getItem(seatKey(room));

  if (!stored) {
    return undefined;
  }

  try {
    const seat = JSON.parse(stored) as Partial<RoomSeat>;

    if (
      typeof seat.seat === "number" &&
      Number.isInteger(seat.seat) &&
      typeof seat.token === "string" &&
      seat.token
    ) {
      return { seat: seat.seat, token: seat.token };
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export function roomSocket(room: string) {
  const url = new URL(SERVER_URL);

  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `/rooms/${encodeURIComponent(room)}/ws`;
  url.search = "";
  url.hash = "";

  return url.toString();
}
