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

export type Objective = {
  tier: number;
  slot: number;
  description: string;
  mustTrue: readonly number[];
  mustFalse: readonly number[];
};

const COMMITMENT_DOMAIN = Uint8Array.from([78, 80, 67, 79, 77, 77, 48, 49]);
const SELECTOR_DOMAIN = Uint8Array.from([78, 80, 83, 69, 76, 69, 48, 49]);
const FACTS_DOMAIN = Uint8Array.from([78, 80, 70, 65, 67, 84, 48, 49]);
const NULLIFIER_DOMAIN = Uint8Array.from([78, 80, 78, 85, 76, 76, 48, 49]);
const LEAF_DOMAIN = Uint8Array.from([78, 80, 76, 69, 65, 70, 48, 49]);
const NODE_DOMAIN = Uint8Array.from([78, 80, 78, 79, 68, 69, 48, 49]);

export const CATALOG: readonly Objective[] = [
  objective(0, 0, "See the flop", [1, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0]),
  objective(0, 1, "Raise before the flop", [0, 1, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0]),
  objective(0, 2, "Call before the flop", [0, 0, 1, 0, 0, 0], [0, 0, 0, 0, 0, 0]),
  objective(0, 3, "Check on the flop", [0, 0, 0, 1, 0, 0], [0, 0, 0, 0, 0, 0]),
  objective(1, 0, "Reach showdown", [0, 0, 0, 0, 1, 0], [0, 0, 0, 0, 0, 0]),
  objective(1, 1, "Finish the hand ahead", [0, 0, 0, 0, 0, 1], [0, 0, 0, 0, 0, 0]),
  objective(
    1,
    2,
    "Raise before the flop and finish ahead",
    [0, 1, 0, 0, 0, 1],
    [0, 0, 0, 0, 0, 0],
  ),
  objective(
    1,
    3,
    "Reach showdown finish ahead and never raise before the flop",
    [0, 0, 0, 0, 1, 1],
    [0, 1, 0, 0, 0, 0],
  ),
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

export function factsHash(handTag: Uint8Array, seat: number, facts: readonly number[]) {
  return blake2s(join(FACTS_DOMAIN, handTag, Uint8Array.of(seat), Uint8Array.from(facts)));
}

export function objectiveAt(tier: number, slot: number) {
  const value = CATALOG[tier * 4 + slot];

  if (!value || value.tier !== tier || value.slot !== slot) {
    throw new Error("invalid challenge objective");
  }

  return value;
}

export function leafHash(objective: Objective) {
  return blake2s(
    join(
      LEAF_DOMAIN,
      Uint8Array.of(objective.tier, objective.slot),
      Uint8Array.from(objective.mustTrue),
      Uint8Array.from(objective.mustFalse),
    ),
  );
}

export function nodeHash(left: Uint8Array, right: Uint8Array) {
  return blake2s(join(NODE_DOMAIN, left, right));
}

export function catalogRoot() {
  const leaves = CATALOG.map(leafHash);
  const level = Array.from({ length: 4 }, (_, i) =>
    nodeHash(leaves[i * 2], leaves[i * 2 + 1]),
  );
  const next = [nodeHash(level[0], level[1]), nodeHash(level[2], level[3])];

  return nodeHash(next[0], next[1]);
}

export function objectivePath(tier: number, slot: number) {
  const index = tier * 4 + slot;

  objectiveAt(tier, slot);

  const leaves = CATALOG.map(leafHash);
  const level = Array.from({ length: 4 }, (_, i) =>
    nodeHash(leaves[i * 2], leaves[i * 2 + 1]),
  );
  const next = [nodeHash(level[0], level[1]), nodeHash(level[2], level[3])];

  return [leaves[index ^ 1], level[(index >> 1) ^ 1], next[(index >> 2) ^ 1]];
}

export function pathRoot(leaf: Uint8Array, index: number, siblings: Uint8Array[]) {
  let hash = leaf;

  for (const sibling of siblings) {
    hash = index & 1 ? nodeHash(sibling, hash) : nodeHash(hash, sibling);
    index >>= 1;
  }

  return hash;
}

export function objectiveMet(objective: Objective, facts: readonly number[]) {
  if (facts.length !== 6 || facts.some((fact) => fact !== 0 && fact !== 1)) {
    return false;
  }

  let literals = 0;

  for (let i = 0; i < 6; i += 1) {
    const yes = objective.mustTrue[i];
    const no = objective.mustFalse[i];

    if ((yes !== 0 && yes !== 1) || (no !== 0 && no !== 1) || yes + no > 1) {
      return false;
    }

    literals += yes + no;

    if ((yes === 1 && facts[i] !== 1) || (no === 1 && facts[i] !== 0)) {
      return false;
    }
  }

  return literals > 0;
}

export function objectiveDescription(tier: number, index: number) {
  return objectiveAt(tier, index).description;
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

export function removeChallengeSecret(room: string, handNo: number, seat: number) {
  sessionStorage.removeItem(secretKey(room, handNo, seat));
}

function secretKey(room: string, handNo: number, seat: number) {
  return `noir-poker-challenge-${room}-${handNo}-${seat}`;
}

function objective(
  tier: number,
  slot: number,
  description: string,
  mustTrue: readonly number[],
  mustFalse: readonly number[],
): Objective {
  return { tier, slot, description, mustTrue, mustFalse };
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
