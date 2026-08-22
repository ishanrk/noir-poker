const CONFIGURED_SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL?.trim().replace(/\/+$/, "");
const LOCAL_SERVER_URL = "http://localhost:3001";

function serverUrl() {
  if (CONFIGURED_SERVER_URL) return CONFIGURED_SERVER_URL;

  if (
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
  ) {
    return LOCAL_SERVER_URL;
  }

  throw new Error("server url missing for this deployment");
}

export type RoomConfig = {
  players: number;
  stack: number;
  small_blind: number;
  big_blind: number;
  hands: number;
  mode?: RoomMode;
};

export type RoomMode = "single" | "multiplayer" | "aztec";

export type RoomSeat = {
  seat: number;
  token: string;
};

type SeatResponse = RoomSeat & { room: string; room_id: string };

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
  draw_proof?: string;
  draw_public_inputs?: string;
  completion_proof: string;
  completion_public_inputs: string;
};

export type ProofKind = "draw" | "completion";

export type PublishedProof = {
  protocol_version: number;
  room: string;
  hand_no: number;
  seat: number;
  kind: ProofKind;
  proof_system: string;
  circuit_id: string;
  bb_version: string;
  artifact_sha256: string;
  vk_sha256: string;
  hand_tag: string;
  commitment: string;
  nonce: string;
  catalog_root: string;
  proof: string;
  public_inputs: string;
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
  const body = config.mode === "single" ? config : { ...config, entropy: entropy() };
  const response = await fetch(`${serverUrl()}/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) throw new Error(await responseError(response));
  return response.json();
}

export async function joinRoom(room: string): Promise<SeatResponse> {
  const response = await fetch(`${serverUrl()}/rooms/${encodeURIComponent(room)}/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ entropy: entropy() }),
  });

  if (!response.ok) throw new Error(await responseError(response));
  return response.json();
}

export async function loadProofReceipt(nullifier: string): Promise<ProofReceipt> {
  const response = await fetch(`${serverUrl()}/proofs/${encodeURIComponent(nullifier)}`);

  if (!response.ok) throw new Error(await responseError(response));
  return response.json();
}

export async function loadPublishedProof(
  room: string,
  hand: number,
  seat: number,
  kind: ProofKind,
): Promise<PublishedProof> {
  const response = await fetch(
    `${serverUrl()}/proofs/${encodeURIComponent(room)}/${encodeURIComponent(hand)}/${encodeURIComponent(seat)}/${kind}`,
  );

  if (!response.ok) throw new Error(await responseError(response));
  return response.json();
}

export async function loadDealAudit(room: string, hand: number): Promise<DealAudit> {
  const response = await fetch(
    `${serverUrl()}/audits/${encodeURIComponent(room)}/${encodeURIComponent(hand)}`,
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
  const url = new URL(serverUrl());

  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `/rooms/${encodeURIComponent(room)}/ws`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function freshEntropy() {
  return entropy();
}
