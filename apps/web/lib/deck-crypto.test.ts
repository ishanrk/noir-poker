import assert from "node:assert/strict";

import {
  aggregateKeys,
  canonicalDeck,
  decryptionShare,
  hex,
  keyProof,
  openCard,
  publicKey,
  shuffleDeck,
  transcriptNext,
  transcriptStart,
  verifyKey,
  verifyShare,
} from "./deck-crypto.ts";

const a = `0x${"07".padStart(64, "0")}`;
const b = `0x${"0b".padStart(64, "0")}`;
const room = "00112233-4455-6677-8899-aabbccddeeff";
const context = transcriptStart(room, 2);
const aKey = await publicKey(a);
const bKey = await publicKey(b);

assert.equal(await verifyKey(aKey, await keyProof(a, context), context), true);

const key = await aggregateKeys([aKey, bKey]);
const deck = await canonicalDeck();
const shuffled = await shuffleDeck(deck, key);
const card = shuffled.output[0];
const aShare = await decryptionShare(card, a, context);
const bShare = await decryptionShare(card, b, context);

assert.equal(await verifyShare(card, aKey, aShare.value, aShare.proof, context), true);
assert.equal(await verifyShare(card, bKey, bShare.value, bShare.proof, context), true);
assert.equal(
  await openCard(card, [aShare.value, bShare.value]),
  shuffled.permutation[0],
);

const next = transcriptNext(context, 0, "key", 0, new TextEncoder().encode("a"));
assert.notEqual(hex(next), hex(context));

// Cache every public canonical point without retaining a mutable input deck.
for (let pass = 0; pass < 3; pass++) {
  for (let index = 0; index < 52; index++) assert.equal(await openCard(deck[index], []), index);
}
const invalid = structuredClone(deck[0]);
invalid.right = { x: "0x" + "0".repeat(64), y: "0x" + "0".repeat(64) };
await assert.rejects(openCard(invalid, []), /invalid/);
assert.equal(await openCard(deck[0], []), 0);
