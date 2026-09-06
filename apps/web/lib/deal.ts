import { sha256 } from "@noble/hashes/sha2.js";

import type { DealAudit, RoomConfig } from "./server.ts";

const COMMIT_DOMAIN = new TextEncoder().encode("NPDEAL01");
const SEED_DOMAIN = new TextEncoder().encode("NPSEED01");
const STREAM_DOMAIN = new TextEncoder().encode("NPSTRM01");
const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const SUITS = ["♣", "♦", "♥", "♠"];

export type DealLayout = {
  hole: Array<[number, number]>;
  burns: [number, number, number];
  board: [number, number, number, number, number];
};

export type DealVerification = {
  commitment: boolean;
  seed: boolean;
  shuffle: boolean;
  transcript: "transcript consistent";
  participant: "matches participant record" | "participant evidence unavailable";
  layout: DealLayout;
  deck: number[];
};

export function dealCommitment(room: string, handNo: bigint, secret: Uint8Array) {
  return sha256(join(COMMIT_DOMAIN, uuidBytes(room), u64(handNo), secret));
}

export function dealSeed(
  room: string,
  handNo: bigint,
  secret: Uint8Array,
  shares: readonly Uint8Array[],
) {
  const bound = shares.flatMap((share, seat) => [Uint8Array.of(seat), share]);

  return sha256(
    join(SEED_DOMAIN, uuidBytes(room), u64(handNo), Uint8Array.of(shares.length), ...bound, secret),
  );
}

export function shuffleDeck(seed: Uint8Array) {
  const cards = Array.from({ length: 52 }, (_, index) => index);
  const stream = words(seed);

  for (let index = cards.length - 1; index > 0; index -= 1) {
    const upper = index + 1;
    const limit = Math.floor(2 ** 32 / upper) * upper;
    let value = stream.next().value as number;

    while (value >= limit) value = stream.next().value as number;
    const swap = value % upper;
    [cards[index], cards[swap]] = [cards[swap], cards[index]];
  }

  return cards;
}

export function dealLayout(deck: readonly number[], players: number, dealer: number): DealLayout {
  if (deck.length !== 52 || !integer(players, 2, 6) || !integer(dealer, 0, players - 1)) {
    throw new Error("invalid deal layout");
  }

  const hole = Array.from({ length: players }, () => [0, 0] as [number, number]);
  const first = (dealer + 1) % players;

  for (let round = 0; round < 2; round += 1) {
    for (let offset = 0; offset < players; offset += 1) {
      hole[(first + offset) % players][round] = deck[round * players + offset];
    }
  }

  const next = players * 2;
  return {
    hole,
    burns: [deck[next], deck[next + 4], deck[next + 6]],
    board: [deck[next + 1], deck[next + 2], deck[next + 3], deck[next + 5], deck[next + 7]],
  };
}

export function cardValue(card: number) {
  if (!Number.isInteger(card) || card < 0 || card >= 52) throw new Error("invalid card");
  return `${RANKS[card % 13]}${SUITS[Math.floor(card / 13)]}`;
}

export type ParticipantRecord = {
  version: 1;
  protocol_version: number;
  room: string;
  hand_no: number;
  config: Omit<RoomConfig, "mode">;
  dealer: number;
  commitment: string;
  seat: number;
  contribution?: string;
  observed: { hole: string[]; board: string[] };
};

export function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}

export function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validConfig(value: unknown): value is ParticipantRecord["config"] {
  return object(value) && integer(value.players, 2, 6) &&
    integer(value.stack, 1, 0xffffffff) && integer(value.small_blind, 1, value.stack) &&
    integer(value.big_blind, value.small_blind, value.stack) && value.stack * value.players <= 0xffffffff;
}

export function sameConfig(left: ParticipantRecord["config"], right: ParticipantRecord["config"]) {
  return left.players === right.players && left.stack === right.stack &&
    left.small_blind === right.small_blind && left.big_blind === right.big_blind;
}

function validHex(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function validRoom(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}

export function validCard(value: unknown): value is string {
  return typeof value === "string" && /^(?:[2-9]|10|J|Q|K|A)[♣♦♥♠]$/.test(value);
}

export function participantRecord(value: unknown): ParticipantRecord {
  if (!object(value) || value.version !== 1 || ![1, 2].includes(Number(value.protocol_version)) ||
    !integer(value.protocol_version, 1, 2) || !validRoom(value.room) || !integer(value.hand_no) ||
    !validConfig(value.config) || !integer(value.dealer, 0, value.config.players - 1) ||
    !integer(value.seat, 0, value.config.players - 1) || !validHex(value.commitment) ||
    (value.contribution !== undefined && !validHex(value.contribution)) ||
    !object(value.observed) || !Array.isArray(value.observed.hole) || !Array.isArray(value.observed.board) ||
    ![0, 2].includes(value.observed.hole.length) || ![0, 3, 4, 5].includes(value.observed.board.length) ||
    ![...value.observed.hole, ...value.observed.board].every(validCard) ||
    new Set([...value.observed.hole, ...value.observed.board]).size !==
      value.observed.hole.length + value.observed.board.length ||
    Object.keys(value).some((key) => ![
      "version", "protocol_version", "room", "hand_no", "config", "dealer",
      "commitment", "seat", "contribution", "observed",
    ].includes(key)) ||
    Object.keys(value.config).some((key) => !["players", "stack", "small_blind", "big_blind"].includes(key)) ||
    Object.keys(value.observed).some((key) => !["hole", "board"].includes(key))) {
    throw new Error("invalid participant record");
  }
  return value as ParticipantRecord;
}

export function verifyDealAudit(
  value: unknown,
  evidence?: unknown,
  expected?: { room: string; hand_no: number },
): DealVerification {
  if (!object(value) || !integer(value.protocol_version, 1, 2) ||
    value.algorithm !== "sha256-counter-rejection-fisher-yates-v1" ||
    !validRoom(value.room) || !integer(value.hand_no) ||
    !integer(value.players, 2, 6) || !integer(value.dealer, 0, value.players - 1) ||
    !validHex(value.commitment) || !validHex(value.server_secret) || !validHex(value.seed) ||
    !Array.isArray(value.contributions) || value.contributions.length !== value.players ||
    value.contributions.some((entry, seat) => !object(entry) || entry.seat !== seat || !validHex(entry.share)) ||
    !Array.isArray(value.deck) || value.deck.length !== 52 ||
    value.deck.some((entry) => !object(entry) || !validCard(entry.value)) ||
    new Set(value.deck.map((entry) => entry.value)).size !== 52 ||
    (value.protocol_version === 2 && (!validConfig(value.config) || value.config.players !== value.players)) ||
    (value.config !== undefined && (!validConfig(value.config) || value.config.players !== value.players))) {
    throw new Error("invalid deal audit");
  }
  const audit = value as DealAudit;
  if (expected && (audit.room !== expected.room || audit.hand_no !== expected.hand_no)) {
    throw new Error("deal identity mismatch");
  }

  const secret = decodeHex(audit.server_secret);
  const shares = audit.contributions.map((entry) => decodeHex(entry.share));
  const commitment = dealCommitment(audit.room, BigInt(audit.hand_no), secret);
  const seed = dealSeed(audit.room, BigInt(audit.hand_no), secret, shares);
  const deck = shuffleDeck(seed);
  const layout = dealLayout(deck, audit.players, audit.dealer);
  const checks = {
    commitment: encodeHex(commitment) === audit.commitment,
    seed: encodeHex(seed) === audit.seed,
    shuffle: deck.every((card, index) => cardValue(card) === audit.deck[index].value),
  };

  if (!Object.values(checks).every(Boolean)) throw new Error("deal audit mismatch");
  if (evidence !== undefined) {
    const record = participantRecord(evidence);
    if (record.room !== audit.room || record.hand_no !== audit.hand_no ||
      record.protocol_version !== audit.protocol_version || record.commitment !== audit.commitment ||
      record.dealer !== audit.dealer || !audit.config || !sameConfig(record.config, audit.config) ||
      !record.contribution || record.contribution !== audit.contributions[record.seat]?.share) {
      throw new Error("participant commitment or contribution mismatch");
    }
    if (!record.observed.hole.every((card, index) => card === cardValue(layout.hole[record.seat][index])) ||
      !record.observed.board.every((card, index) => card === cardValue(layout.board[index]))) {
      throw new Error("participant observed cards mismatch");
    }
  }
  return {
    ...checks, layout, deck,
    transcript: "transcript consistent",
    participant: evidence === undefined ? "participant evidence unavailable" : "matches participant record",
  };
}

export function encodeHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function decodeHex(value: string) {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error("invalid deal bytes");
  return Uint8Array.from({ length: 32 }, (_, index) =>
    Number.parseInt(value.slice(index * 2, index * 2 + 2), 16),
  );
}

export function uuidBytes(value: string) {
  if (!validRoom(value)) throw new Error("invalid room id");
  const hex = value.replaceAll("-", "");

  if (!/^[0-9a-f]{32}$/.test(hex)) throw new Error("invalid room id");
  return Uint8Array.from({ length: 16 }, (_, index) =>
    Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16),
  );
}

function* words(seed: Uint8Array) {
  let counter = BigInt(0);

  while (true) {
    const block = sha256(join(STREAM_DOMAIN, seed, u64(counter)));
    counter += BigInt(1);

    for (let offset = 0; offset < block.length; offset += 4) {
      yield new DataView(block.buffer, block.byteOffset + offset, 4).getUint32(0);
    }
  }
}

function u64(value: bigint) {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value);
  return bytes;
}

function join(...parts: Uint8Array[]) {
  const bytes = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;

  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }

  return bytes;
}
