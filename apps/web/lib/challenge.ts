import { blake2s } from "@noble/hashes/blake2.js";

export const CHALLENGE_VERSION = 1;
export const EASY_TIER = 0;
export const HARD_TIER = 1;

export type ChallengeSecret = {
  version: number;
  tier: number;
  secret: string;
  commitment: string;
};

const COMMITMENT_DOMAIN = Uint8Array.from([78, 80, 67, 79, 77, 77, 48, 49]);
const SELECTOR_DOMAIN = Uint8Array.from([78, 80, 83, 69, 76, 69, 48, 49]);
const NULLIFIER_DOMAIN = Uint8Array.from([78, 80, 78, 85, 76, 76, 48, 49]);

const OBJECTIVES = [
  ["See the flop", "Raise before the flop", "Call before the flop", "Check on the flop"],
  [
    "Reach showdown",
    "Finish the hand ahead",
    "Raise before the flop and finish ahead",
    "Reach showdown finish ahead and never raise before the flop",
  ],
] as const;

export function commitment(
  handTag: Uint8Array,
  seat: number,
  tier: number,
  secret: Uint8Array,
) {
  return blake2s(join(COMMITMENT_DOMAIN, handTag, Uint8Array.of(seat, tier), secret));
}

export function selector(
  handTag: Uint8Array,
  seat: number,
  tier: number,
  nonce: Uint8Array,
  secret: Uint8Array,
) {
  return blake2s(
    join(SELECTOR_DOMAIN, handTag, Uint8Array.of(seat, tier), nonce, secret),
  );
}

export function objectiveIndex(
  handTag: Uint8Array,
  seat: number,
  tier: number,
  nonce: Uint8Array,
  secret: Uint8Array,
) {
  return selector(handTag, seat, tier, nonce, secret)[0] & 3;
}

export function nullifier(
  handTag: Uint8Array,
  seat: number,
  tier: number,
  secret: Uint8Array,
) {
  return blake2s(join(NULLIFIER_DOMAIN, handTag, Uint8Array.of(seat, tier), secret));
}

export function objectiveDescription(tier: number, index: number) {
  const value = OBJECTIVES[tier]?.[index];

  if (!value) {
    throw new Error("invalid challenge objective");
  }

  return value;
}

export function encodeHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function decodeHex(value: string) {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new Error("invalid challenge bytes");
  }

  return Uint8Array.from({ length: 32 }, (_, i) =>
    Number.parseInt(value.slice(i * 2, i * 2 + 2), 16),
  );
}

export function saveChallengeSecret(
  room: string,
  handNo: number,
  seat: number,
  value: ChallengeSecret,
) {
  sessionStorage.setItem(secretKey(room, handNo, seat), JSON.stringify(value));
}

export function loadChallengeSecret(room: string, handNo: number, seat: number) {
  const stored = sessionStorage.getItem(secretKey(room, handNo, seat));

  if (!stored) {
    return undefined;
  }

  try {
    const value = JSON.parse(stored) as Partial<ChallengeSecret>;

    if (
      value.version === CHALLENGE_VERSION &&
      (value.tier === EASY_TIER || value.tier === HARD_TIER) &&
      typeof value.secret === "string" &&
      /^[0-9a-f]{64}$/.test(value.secret) &&
      typeof value.commitment === "string" &&
      /^[0-9a-f]{64}$/.test(value.commitment)
    ) {
      return value as ChallengeSecret;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function secretKey(room: string, handNo: number, seat: number) {
  return `noir-poker-challenge-${room}-${handNo}-${seat}`;
}

function join(...parts: Uint8Array[]) {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const bytes = new Uint8Array(size);
  let offset = 0;

  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }

  return bytes;
}
