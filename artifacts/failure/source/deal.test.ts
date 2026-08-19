import assert from "node:assert/strict";

import {
  cardValue,
  dealCommitment,
  dealLayout,
  dealSeed,
  decodeHex,
  encodeHex,
  shuffleDeck,
  verifyDealAudit,
} from "./deal.ts";

const room = "00112233-4455-6677-8899-aabbccddeeff";
const secret = Uint8Array.from({ length: 32 }, () => 0x11);
const shares = [0x22, 0x33, 0x44].map((byte) => Uint8Array.from({ length: 32 }, () => byte));
const commitment = dealCommitment(room, 7n, secret);
const seed = dealSeed(room, 7n, secret, shares);
const deck = shuffleDeck(seed);

assert.equal(encodeHex(commitment), "e11f12bea858c9319b49f596f39f61976f5085010dd16069661ee759f7cda74a");
assert.equal(encodeHex(seed), "7ee43ff91db755fb8deb2734d1c484ef9dcdfd0249cdab154ba10c467783db1f");
assert.deepEqual(deck, [
  25, 11, 16, 18, 43, 9, 2, 17, 3, 42, 1, 15, 30, 8, 37, 20, 22, 38, 33, 49,
  28, 26, 19, 4, 12, 45, 23, 14, 0, 7, 51, 13, 10, 21, 50, 31, 6, 39, 36, 29,
  46, 44, 34, 5, 40, 35, 32, 47, 27, 41, 24, 48,
]);
assert.deepEqual(dealLayout(deck, 3, 1), {
  hole: [[11, 43], [16, 9], [25, 18]],
  burns: [2, 1, 30],
  board: [17, 3, 42, 15, 8],
});
assert.deepEqual(deck.slice(0, 5).map(cardValue), ["A♦", "K♣", "5♦", "7♦", "6♠"]);
assert.equal(decodeHex(encodeHex(seed)).length, 32);

const audit = {
  protocol_version: 1,
  algorithm: "sha256-counter-rejection-fisher-yates-v1",
  room,
  hand_no: 7,
  players: 3,
  dealer: 1,
  commitment: encodeHex(commitment),
  server_secret: encodeHex(secret),
  contributions: shares.map((share, seat) => ({ seat, share: encodeHex(share) })),
  seed: encodeHex(seed),
  deck: deck.map((card) => ({ value: cardValue(card) })),
};

assert.equal(verifyDealAudit(audit).shuffle, true);
for (const field of ["commitment", "seed"] as const) {
  assert.throws(() => verifyDealAudit({ ...audit, [field]: `ff${audit[field].slice(2)}` }));
}
assert.throws(() =>
  verifyDealAudit({ ...audit, deck: [{ value: "A♠" }, ...audit.deck.slice(1)] }),
);

process.stdout.write("deal protocol vectors ok\n");
