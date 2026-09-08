import { postSeatWithCompatibility } from "@/lib/server-compat";

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

export async function roomInterrupted(room: string) {
  const response = await fetch(`${serverUrl()}/rooms/${encodeURIComponent(room)}/status`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) return undefined;
  const value = await response.json();
  return value.state === "interrupted" ? value.code as string : undefined;
}

export type RoomConfig = {
  players: number;
  stack: number;
  small_blind: number;
  big_blind: number;
  hands: number;
  mode?: RoomMode;
  name?: string;
};

export type RoomMode = "single" | "multiplayer" | "aztec";

export type RoomSeat = {
  seat: number;
  token: string;
};

type SeatResponse = RoomSeat & { room: string; room_id: string };

export type AztecReservation = SeatResponse & {
  admission: string;
  table_id: string;
  entry_id: string;
  amount: number;
  authorized: boolean;
};

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
  facts_hash?: string;
  nullifier?: string;
  proof: string;
  public_inputs: string;
};

export type DeckPoint = { x: string; y: string };
export type DeckCipher = { left: DeckPoint; right: DeckPoint };
export type DeckProof = { a: DeckPoint; b: DeckPoint; z: string };

export type DealAudit = {
  protocol_version: number;
  room: string;
  hand_no: number;
  dealer?: number;
  human?: boolean[];
  transcript_hash: string;
  keys: DeckPoint[];
  key_proofs: DeckProof[];
  shuffles: Array<{
    participant: number;
    input: DeckCipher[];
    output: DeckCipher[];
    proof: string;
    public_inputs: string;
  }>;
  openings: string[];
  deck: number[];
  records: Array<{
    seq: number;
    kind: string;
    seat?: number;
    payload: string;
    hash: string;
  }>;
};

export type HandMeta = { hand_no: number; dealer: number };

export type ProofMeta = {
  hand_no: number;
  seat: number;
  finished: boolean;
  draw_published: boolean;
  completion_published: boolean;
  nullifier?: string;
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
  return requestSeat("create", "/rooms", config, () => config.mode === "single" ? config : { ...config, entropy: entropy() });
}

export async function joinRoom(room: string, name?: string): Promise<SeatResponse> {
  return requestSeat("join", `/rooms/${encodeURIComponent(room)}/join`, { room, name }, () => ({ entropy: entropy(), name }));
}

async function requestSeat(kind: string, path: string, intent: unknown, makeBody: () => object): Promise<SeatResponse> {
  const key = `noir-pending-${kind}`;
  const identity = JSON.stringify({ path, intent });
  const saved = sessionStorage.getItem(key);
  const pending = saved ? JSON.parse(saved) as { identity: string; body: object } : {
    identity, body: { ...makeBody(), request_key: crypto.randomUUID() },
  };
  if (pending.identity !== identity) throw new Error("Your previous room request has not been confirmed. Restore those settings and retry to recover it.");
  // Keep the exact entropy and private request credential after ambiguous failure.
  sessionStorage.setItem(key, JSON.stringify(pending));
  const post = (body: object) => fetch(`${serverUrl()}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });

  const attempted = await postSeatWithCompatibility(post, pending.body);
  const response = attempted.response;
  if (!response.ok) {
    if (response.status >= 400 && response.status < 500) sessionStorage.removeItem(key);
    throw new Error(attempted.message ?? await responseError(response));
  }

  const seat = await response.json() as SeatResponse;
  saveSeat(seat.room, seat);
  sessionStorage.removeItem(key);
  return seat;
}

export async function reserveAztecRoom(input: {
  players: number;
  hands: number;
  name?: string;
  account: string;
}): Promise<AztecReservation> {
  const response = await fetch(`${serverUrl()}/aztec/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...input, entropy: entropy() }),
  });

  if (!response.ok) throw new Error(await responseError(response));
  return response.json();
}

export async function reserveAztecJoin(
  room: string,
  input: { name?: string; account: string },
): Promise<AztecReservation> {
  const response = await fetch(`${serverUrl()}/aztec/rooms/${encodeURIComponent(room)}/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...input, entropy: entropy() }),
  });

  if (!response.ok) throw new Error(await responseError(response));
  return response.json();
}

export async function authorizeAztec(
  reservation: AztecReservation,
): Promise<AztecReservation> {
  const response = await fetch(
    `${serverUrl()}/aztec/admissions/${encodeURIComponent(reservation.admission)}/authorize`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: reservation.token }),
    },
  );

  if (!response.ok) throw new Error(await responseError(response));
  return response.json();
}

export async function confirmAztec(
  reservation: AztecReservation,
): Promise<SeatResponse> {
  const response = await fetch(
    `${serverUrl()}/aztec/admissions/${encodeURIComponent(reservation.admission)}/confirm`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: reservation.token }),
    },
  );

  if (!response.ok) throw new Error(await responseError(response));
  return response.json();
}

export async function loadProofReceipt(nullifier: string): Promise<ProofReceipt> {
  const response = await fetch(`${serverUrl()}/proofs/${encodeURIComponent(nullifier)}`);

  if (!response.ok) throw new Error(await responseError(response));
  const receipt = await response.json() as ProofReceipt & { points?: unknown };
  delete receipt.points;
  return receipt;
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
  const value = await response.json() as Partial<DealAudit>;
  if (
    !Array.isArray(value.keys) ||
    !Array.isArray(value.key_proofs) ||
    !Array.isArray(value.shuffles) ||
    !Array.isArray(value.openings) ||
    !Array.isArray(value.deck) ||
    !Array.isArray(value.records)
  ) {
    throw new Error("deck proof unavailable for this hand");
  }
  return value as DealAudit;
}

export async function loadHandHistory(room: string): Promise<HandMeta[]> {
  const response = await fetch(`${serverUrl()}/rooms/${encodeURIComponent(room)}/hands`);

  if (!response.ok) throw new Error(await responseError(response));
  const value = await response.json() as { hands: HandMeta[] };
  return value.hands;
}

export async function loadProofHistory(room: string): Promise<ProofMeta[]> {
  const response = await fetch(`${serverUrl()}/rooms/${encodeURIComponent(room)}/proofs`);

  if (!response.ok) throw new Error(await responseError(response));
  const value = await response.json() as { proofs: ProofMeta[] };
  return value.proofs;
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
