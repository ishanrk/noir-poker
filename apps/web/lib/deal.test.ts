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
const commitment = dealCommitment(room, BigInt(7), secret);
const seed = dealSeed(room, BigInt(7), secret, shares);
const deck = shuffleDeck(seed);

assert.equal(encodeHex(commitment), "e11f12bea858c9319b49f596f39f61976f5085010dd16069661ee759f7cda74a");
assert.equal(encodeHex(seed), "2804b581997cff7e45e6801f10130d4638188c6c19115f7741273282cbef08bd");
assert.deepEqual(deck, [
  38, 18, 43, 22, 5, 11, 33, 35, 47, 24, 32, 25,
  23, 2, 6, 46, 48, 27, 4, 3, 44, 42, 15, 13,
  39, 30, 49, 41, 7, 1, 12, 37, 9, 10, 20, 40,
  17, 21, 0, 29, 36, 8, 26, 16, 14, 28, 19, 51,
  50, 31, 45, 34,
]);
assert.deepEqual(dealLayout(deck, 3, 1), {
  hole: [[18, 5], [43, 11], [38, 22]],
  burns: [33, 32, 23],
  board: [35, 47, 24, 25, 2],
});
assert.deepEqual(deck.slice(0, 5).map(cardValue), ["A♥", "7♦", "6♠", "J♦", "7♣"]);
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
