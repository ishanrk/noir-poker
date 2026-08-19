import { sha256 } from "@noble/hashes/sha2.js";

import type { DealAudit } from "@/lib/server";

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
  seats: boolean;
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
  if (deck.length !== 52 || players < 2 || players > 6 || dealer < 0 || dealer >= players) {
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

export function verifyDealAudit(audit: DealAudit): DealVerification {
  if (
    audit.protocol_version !== 1 ||
    audit.algorithm !== "sha256-counter-rejection-fisher-yates-v1" ||
    !Number.isInteger(audit.hand_no) ||
    !Number.isInteger(audit.players) ||
    !Number.isInteger(audit.dealer) ||
    audit.contributions.length !== audit.players ||
    audit.contributions.some((entry, seat) => entry.seat !== seat)
  ) {
    throw new Error("invalid deal audit");
  }

  const secret = decodeHex(audit.server_secret);
  const shares = audit.contributions.map((entry) => decodeHex(entry.share));
  const commitment = dealCommitment(audit.room, BigInt(audit.hand_no), secret);
  const seed = dealSeed(audit.room, BigInt(audit.hand_no), secret, shares);
  const deck = shuffleDeck(seed);
  const serverDeck = audit.deck.map(({ value }) => value);
  const expectedDeck = deck.map(cardValue);
  const layout = dealLayout(deck, audit.players, audit.dealer);
  const checks = {
    commitment: encodeHex(commitment) === audit.commitment,
    seed: encodeHex(seed) === audit.seed,
    shuffle: expectedDeck.every((card, index) => card === serverDeck[index]),
    seats: layout.hole.length === audit.players,
  };

  if (!Object.values(checks).every(Boolean)) throw new Error("deal audit mismatch");
  return { ...checks, layout, deck };
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
  const hex = value.replaceAll("-", "");

  if (!/^[0-9a-f]{32}$/.test(hex)) throw new Error("invalid room id");
  return Uint8Array.from({ length: 16 }, (_, index) =>
    Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16),
  );
}

function* words(seed: Uint8Array) {
  let counter = 0n;

  while (true) {
    const block = sha256(join(STREAM_DOMAIN, seed, u64(counter)));
    counter += 1n;

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
