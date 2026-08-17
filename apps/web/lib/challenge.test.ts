import assert from "node:assert/strict";

import {
  commitment,
  decodeHex,
  encodeHex,
  factsHash,
  nullifier,
  objectiveIndex,
  objectiveMet,
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
assert.equal(objectiveMet(0, 2, [0, 0, 1, 0, 0, 0]), true);
assert.equal(objectiveMet(0, 2, [0, 0, 0, 0, 0, 0]), false);
assert.equal(objectiveMet(1, 3, [0, 0, 0, 0, 1, 1]), true);
assert.equal(objectiveMet(1, 3, [0, 1, 0, 0, 1, 1]), false);
