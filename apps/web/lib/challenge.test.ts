import assert from "node:assert/strict";

import {
  CATALOG,
  catalogRoot,
  commitment,
  decodeHex,
  encodeHex,
  factsHash,
  leafHash,
  nullifier,
  objectiveAt,
  objectiveDescription,
  objectiveIndex,
  objectiveMet,
  objectivePath,
  pathRoot,
  selector,
} from "./challenge.ts";

const handTag = decodeHex("11".repeat(32));
const secret = decodeHex("22".repeat(32));
const nonce = decodeHex("33".repeat(32));

assert.equal(
  encodeHex(commitment(handTag, 2, 0, secret)),
  "8db3780236f50489de3c16f2a7a06996f5239ffef4572abdf0234e89aefda674",
);
assert.equal(
  encodeHex(selector(handTag, 2, 0, nonce, secret)),
  "6a1c73af6b8a897beb9e2c1d338b94ce7a692f3f7d847a73201f5769148e1981",
);
assert.equal(objectiveIndex(handTag, 2, 0, nonce, secret), 2);
assert.equal(
  encodeHex(nullifier(handTag, 2, 0, secret)),
  "4378956178b8af73c267002cd809d5ef2c42bd152a63f46ef48316be96c24411",
);
assert.equal(
  encodeHex(factsHash(handTag, 2, [1, 1, 1, 1, 1, 1])),
  "cdc4ad0d044f42a722aca8076bd3d8cdcacae3c49df34d84f45f481683592a23",
);

const root = catalogRoot();
const selected = objectiveAt(0, 2);
const path = objectivePath(0, 2);

assert.equal(encodeHex(root), "b832b47c67eaa2f5b74be82cfad9fd77636f75d866cf1b8437358a7a8406e067");
assert.equal(
  encodeHex(leafHash(selected)),
  "bd6fc38abc9f6b7f426a38ed28bcd8259429fe8817d37c2b173ded4477730436",
);
assert.deepEqual(
  path.map(encodeHex),
  [
    "0435da91a3d4c7e99c13b0bcf04b8171c35e62356b99b76d65fc4b111b7e9dc4",
    "c8b3bb9a420a12a55d5d06f474bdb719d15643e41c89d403adf708d5812a53b5",
    "43bf3aa41def544e83ccb9f02417f129a9580b4010466bb7157f9ae5f4735410",
  ],
);
assert.deepEqual(pathRoot(leafHash(selected), 2, path), root);

for (const objective of CATALOG) {
  const index = objective.tier * 4 + objective.slot;

  assert.deepEqual(
    pathRoot(leafHash(objective), index, objectivePath(objective.tier, objective.slot)),
    root,
  );
}

const descriptions = [
  "See the flop",
  "Raise before the flop",
  "Call before the flop",
  "Check on the flop",
  "Reach showdown",
  "Finish the hand ahead",
  "Raise before the flop and finish ahead",
  "Reach showdown finish ahead and never raise before the flop",
];

assert.deepEqual(CATALOG.map(({ tier, slot }) => objectiveDescription(tier, slot)), descriptions);

for (let bits = 0; bits < 64; bits += 1) {
  const facts = Array.from({ length: 6 }, (_, i) => (bits >> i) & 1);

  for (const objective of CATALOG) {
    assert.equal(objectiveMet(objective, facts), priorObjectiveMet(objective.tier, objective.slot, facts));
  }
}

const tampered = path.map((value) => value.slice());

tampered[0][0] ^= 1;
assert.notDeepEqual(pathRoot(leafHash(selected), 2, tampered), root);
assert.notDeepEqual(pathRoot(leafHash(selected), 2, path), decodeHex("00".repeat(32)));
assert.equal(selected.description, "Call before the flop");

function priorObjectiveMet(tier: number, slot: number, facts: number[]) {
  if (tier === 0) {
    return facts[slot] === 1;
  }

  if (slot === 0) {
    return facts[4] === 1;
  }

  if (slot === 1) {
    return facts[5] === 1;
  }

  if (slot === 2) {
    return facts[1] === 1 && facts[5] === 1;
  }

  return facts[1] === 0 && facts[4] === 1 && facts[5] === 1;
}
