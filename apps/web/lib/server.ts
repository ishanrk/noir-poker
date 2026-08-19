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

type SeatResponse = RoomSeat & { room: string };

export type ProofReceipt = {
  protocol_version: number;
  room: string;
  hand_no: number;
  proof_system: string;
  circuit_id: string;
  bb_version: string;
  artifact_sha256: string;
  vk_sha256: string;
  hand_tag: string;
  seat: number;
  commitment: string;
  nonce: string;
  facts_hash: string;
  nullifier: string;
  catalog_root: string;
  points: number;
  draw_proof: string;
  draw_public_inputs: string;
  completion_proof: string;
  completion_public_inputs: string;
};

export type DealAudit = {
  protocol_version: number;
  algorithm: string;
  room: string;
  hand_no: number;
  players: number;
  dealer: number;
  commitment: string;
  server_secret: string;
  contributions: Array<{ seat: number; share: string }>;
  seed: string;
  deck: Array<{ value: string }>;
};

async function responseError(response: Response) {
  return (await response.text()).trim() || "request failed";
}

function entropy() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function createRoom(config: RoomConfig): Promise<SeatResponse> {
  const response = await fetch(`${SERVER_URL}/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...config, entropy: entropy() }),
  });

  if (!response.ok) throw new Error(await responseError(response));
  return response.json();
}

export async function joinRoom(room: string): Promise<SeatResponse> {
  const response = await fetch(`${SERVER_URL}/rooms/${encodeURIComponent(room)}/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ entropy: entropy() }),
  });

  if (!response.ok) throw new Error(await responseError(response));
  return response.json();
}

export async function loadProofReceipt(nullifier: string): Promise<ProofReceipt> {
  const response = await fetch(`${SERVER_URL}/proofs/${encodeURIComponent(nullifier)}`);

  if (!response.ok) throw new Error(await responseError(response));
  return response.json();
}

export async function loadDealAudit(room: string, hand: number): Promise<DealAudit> {
  const response = await fetch(
    `${SERVER_URL}/audits/${encodeURIComponent(room)}/${encodeURIComponent(hand)}`,
  );

  if (!response.ok) throw new Error(await responseError(response));
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

  if (!stored) return undefined;

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

export function freshEntropy() {
  return entropy();
}
