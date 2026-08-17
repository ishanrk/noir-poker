import { blake2s } from "@noble/hashes/blake2.js";

export const CHALLENGE_VERSION = 2;
export const CHALLENGE_POINTS = 20;

export type ChallengeSecret = {
  version: number;
  secret: string;
  commitment: string;
};

export type Objective = {
  index: number;
  description: string;
  mustTrue: readonly number[];
  mustFalse: readonly number[];
};

const HAND_DOMAIN = Uint8Array.from([78, 80, 72, 65, 78, 68, 48, 50]);
const COMMITMENT_DOMAIN = Uint8Array.from([78, 80, 67, 79, 77, 77, 48, 50]);
const SELECTOR_DOMAIN = Uint8Array.from([78, 80, 83, 69, 76, 69, 48, 50]);
const FACTS_DOMAIN = Uint8Array.from([78, 80, 70, 65, 67, 84, 48, 50]);
const NULLIFIER_DOMAIN = Uint8Array.from([78, 80, 78, 85, 76, 76, 48, 50]);
const LEAF_DOMAIN = Uint8Array.from([78, 80, 76, 69, 65, 70, 48, 50]);
const NODE_DOMAIN = Uint8Array.from([78, 80, 78, 79, 68, 69, 48, 50]);

export const CATALOG: readonly Objective[] = [
  objective(0, "See the flop", [1, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0]),
  objective(1, "Raise before the flop", [0, 1, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0]),
  objective(2, "Call before the flop", [0, 0, 1, 0, 0, 0], [0, 0, 0, 0, 0, 0]),
  objective(3, "Check on the flop", [0, 0, 0, 1, 0, 0], [0, 0, 0, 0, 0, 0]),
  objective(4, "Reach showdown", [0, 0, 0, 0, 1, 0], [0, 0, 0, 0, 0, 0]),
  objective(5, "Finish the hand ahead", [0, 0, 0, 0, 0, 1], [0, 0, 0, 0, 0, 0]),
  objective(
    6,
    "Raise before the flop and finish ahead",
    [0, 1, 0, 0, 0, 1],
    [0, 0, 0, 0, 0, 0],
  ),
  objective(
    7,
    "Reach showdown finish ahead and never raise before the flop",
    [0, 0, 0, 0, 1, 1],
    [0, 1, 0, 0, 0, 0],
  ),
] as const;

export function handTag(room: Uint8Array, handNo: bigint) {
  const no = new Uint8Array(8);

  new DataView(no.buffer).setBigUint64(0, handNo);
  return blake2s(join(HAND_DOMAIN, room, no));
}

export function commitment(handTag: Uint8Array, seat: number, secret: Uint8Array) {
  return blake2s(join(COMMITMENT_DOMAIN, handTag, Uint8Array.of(seat), secret));
}

export function selector(
  handTag: Uint8Array,
  seat: number,
  nonce: Uint8Array,
  secret: Uint8Array,
) {
  return blake2s(join(SELECTOR_DOMAIN, handTag, Uint8Array.of(seat), nonce, secret));
}

export function objectiveIndex(
  handTag: Uint8Array,
  seat: number,
  nonce: Uint8Array,
  secret: Uint8Array,
) {
  return selector(handTag, seat, nonce, secret)[0] & 7;
}

export function nullifier(handTag: Uint8Array, seat: number, secret: Uint8Array) {
  return blake2s(join(NULLIFIER_DOMAIN, handTag, Uint8Array.of(seat), secret));
}

export function factsHash(
  handTag: Uint8Array,
  seat: number,
  salt: Uint8Array,
  facts: readonly number[],
) {
  return blake2s(
    join(FACTS_DOMAIN, handTag, Uint8Array.of(seat), salt, Uint8Array.from(facts)),
  );
}

export function objectiveAt(index: number) {
  const value = CATALOG[index];

  if (!value || value.index !== index) {
    throw new Error("invalid challenge objective");
  }

  return value;
}

export function leafHash(value: Objective) {
  return blake2s(
    join(
      LEAF_DOMAIN,
      Uint8Array.of(value.index),
      Uint8Array.from(value.mustTrue),
      Uint8Array.from(value.mustFalse),
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

export function objectivePath(index: number) {
  objectiveAt(index);

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

export function objectiveMet(value: Objective, facts: readonly number[]) {
  if (facts.length !== 6 || facts.some((fact) => fact !== 0 && fact !== 1)) {
    return false;
  }

  let literals = 0;

  for (let i = 0; i < 6; i += 1) {
    const yes = value.mustTrue[i];
    const no = value.mustFalse[i];

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
  index: number,
  description: string,
  mustTrue: readonly number[],
  mustFalse: readonly number[],
): Objective {
  return { index, description, mustTrue, mustFalse };
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
