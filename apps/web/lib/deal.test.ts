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
  type ParticipantRecord,
} from "./deal.ts";
import { contribution, loadParticipant, observeDeal, pinDeal } from "./participant.ts";

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

const config = { players: 3, stack: 1000, small_blind: 5, big_blind: 10 };
const current = { ...audit, protocol_version: 2, config };
const layout = dealLayout(deck, 3, 1);
const record: ParticipantRecord = {
  version: 1, protocol_version: 2, room, hand_no: 7, config, dealer: 1,
  commitment: current.commitment, seat: 0, contribution: encodeHex(shares[0]),
  observed: { hole: layout.hole[0].map(cardValue), board: layout.board.slice(0, 3).map(cardValue) },
};
assert.equal(verifyDealAudit(current, record).participant, "matches participant record");
assert.equal(verifyDealAudit(current).participant, "participant evidence unavailable");
const replacementSecret = new Uint8Array(32).fill(0x77);
const replacementSeed = dealSeed(room, 7n, replacementSecret, shares);
const replacement = {
  ...current, commitment: encodeHex(dealCommitment(room, 7n, replacementSecret)),
  server_secret: encodeHex(replacementSecret), seed: encodeHex(replacementSeed),
  deck: shuffleDeck(replacementSeed).map((card) => ({ value: cardValue(card) })),
};
assert.equal(verifyDealAudit(replacement).transcript, "transcript consistent");
assert.throws(() => verifyDealAudit(replacement, record), /participant/);
assert.throws(() => verifyDealAudit(current, { ...record, contribution: "ff".repeat(32) }), /participant/);
assert.throws(() => verifyDealAudit(current, {
  ...record, observed: { ...record.observed, hole: ["2♣", "3♣"] },
}), /participant/);
for (const bad of [
  null, {}, { ...current, hand_no: Number.MAX_SAFE_INTEGER + 1 },
  { ...current, hand_no: -1 }, { ...current, players: 1 }, { ...current, dealer: 3 },
  { ...current, dealer: 0.5 }, { ...current, deck: current.deck.slice(1) },
  { ...current, deck: [...current.deck, current.deck[0]] },
  { ...current, deck: [{ value: "1♠" }, ...current.deck.slice(1)] },
  { ...current, deck: [current.deck[1], ...current.deck.slice(1)] },
  { ...current, contributions: null }, { ...current, config: {} },
]) assert.throws(() => verifyDealAudit(bad));
assert.throws(() => verifyDealAudit(current, record, { room, hand_no: 8 }), /identity/);
assert.throws(() => verifyDealAudit(current, { ...record, token: "private" }), /invalid participant/);

const data = new Map<string, string>();
const store = {
  getItem: (key: string) => data.get(key) ?? null,
  setItem: (key: string, value: string) => { data.set(key, value); },
};
const deal = {
  protocol_version: 2, config, dealer: 1, hand_no: 7, commitment: current.commitment,
  contributors: 0, required: 3, mine: false, state: "collecting" as const, audit: false,
};
pinDeal(room, 0, deal, store);
assert.equal(loadParticipant(room, 7, 0, store)?.contribution, undefined);
const share = contribution(room, 0, deal, store);
assert.equal(contribution(room, 0, deal, store), share);
assert.throws(() => contribution(room, 0, { ...deal, commitment: "ff".repeat(32) }, store), /conflict/);
const hole = record.observed.hole.map((value) => ({ value }));
observeDeal(room, 0, deal, hole, [], store);
observeDeal(room, 0, deal, hole, record.observed.board.map((value) => ({ value })), store);
const saved = JSON.stringify([...data]);
assert.throws(() => observeDeal(room, 0, deal, [{ value: "2♣" }, { value: "3♣" }], [], store), /conflict/);
assert.equal(JSON.stringify([...data]), saved);
assert.throws(() => contribution(room, 1, deal, {
  ...store, setItem: () => { throw new Error("quota"); },
}), /Cannot save/);
process.stdout.write("participant evidence and storage checks ok\n");
