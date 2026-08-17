import assert from "node:assert/strict";

import {
  CATALOG,
  catalogRoot,
  commitment,
  decodeHex,
  encodeHex,
  factsHash,
  handTag as deriveHandTag,
  leafHash,
  nullifier,
  objectiveAt,
  objectiveIndex,
  objectiveMet,
  objectivePath,
  pathRoot,
  selector,
} from "./challenge.ts";

const handTag = decodeHex("11".repeat(32));
const secret = decodeHex("22".repeat(32));
const nonce = decodeHex("33".repeat(32));
const salt = decodeHex("44".repeat(32));

assert.equal(
  encodeHex(deriveHandTag(Uint8Array.from({ length: 16 }, (_, i) => i), 1n)),
  "141b7dec6b10598c546bdf8cce1be32f665e4711959deccaa67f00f2ed905834",
);

assert.equal(
  encodeHex(commitment(handTag, 2, secret)),
  "2bc670e96587a294cd84d516fc5bca12c27475f24acfbd265c92fc1cde2c98b6",
);
assert.equal(
  encodeHex(selector(handTag, 2, nonce, secret)),
  "56f4c60caae9bff7de89e6abdbd5644eb47027d761554450e2d2a1f459277ce4",
);
assert.equal(objectiveIndex(handTag, 2, nonce, secret), 6);
assert.equal(
  encodeHex(nullifier(handTag, 2, secret)),
  "15978f5f3c49bc3521ee3e1dc8d43ab00428ad899aa105db3a4ec825cc26d77a",
);
assert.equal(
  encodeHex(factsHash(handTag, 2, salt, [1, 1, 1, 1, 1, 1])),
  "219fdf285ea291ee6e2c065fca84f58eac0bbe38c6f87614df3e5db01d753104",
);

const root = catalogRoot();
const selected = objectiveAt(6);
const path = objectivePath(6);

assert.equal(encodeHex(root), "0e5885f1c42a9799237a606f214f7256806d77977179e5b9ff49ea99b446c409");
assert.equal(
  encodeHex(leafHash(selected)),
  "9c1c3e4b190b5860de5f82ced264ab4f3cd8877de2ef2956978dda4e1cf81e73",
);
assert.deepEqual(
  path.map(encodeHex),
  [
    "c0da3f27bc1b3b9319ee93281dd4a228175ec8912a3d74cd14a1ade9fc7963c4",
    "372a18faabb3d8e1ea3557e08655c7467511cea1bbfba232696bf576c8ff533a",
    "fde9d0e8e8c451925a9196bbbeffeb4d3d6dcd91bc5c140bced96ee410a2908f",
  ],
);
assert.deepEqual(pathRoot(leafHash(selected), 6, path), root);

for (const value of CATALOG) {
  assert.deepEqual(pathRoot(leafHash(value), value.index, objectivePath(value.index)), root);
}

for (let bits = 0; bits < 64; bits += 1) {
  const facts = Array.from({ length: 6 }, (_, i) => (bits >> i) & 1);

  for (const value of CATALOG) {
    assert.equal(objectiveMet(value, facts), expected(value.index, facts));
  }
}

const tampered = path.map((value) => value.slice());

tampered[0][0] ^= 1;
assert.notDeepEqual(pathRoot(leafHash(selected), 6, tampered), root);
assert.equal(selected.description, "Raise before the flop and finish ahead");

function expected(index: number, facts: number[]) {
  if (index < 6) {
    return facts[index] === 1;
  }

  if (index === 6) {
    return facts[1] === 1 && facts[5] === 1;
  }

  return facts[1] === 0 && facts[4] === 1 && facts[5] === 1;
}
