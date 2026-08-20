import assert from "node:assert/strict";

import {
  entryIdForSeat,
  fieldHex,
  nonceFromHex,
  nonceHex,
  tableIdForRoom,
} from "./ids.ts";

const room = "00112233-4455-6677-8899-aabbccddeeff";
const tableId = tableIdForRoom(room);
const nonce = Uint8Array.from({ length: 32 }, (_, index) => index);
const entryId = entryIdForSeat(tableId, 3, nonce);

assert.equal(
  fieldHex(tableId),
  "0x13473e9646e40301dc44449195db2ef544fa00f7195bd172dedc5ff2887770",
);
assert.equal(
  fieldHex(entryId),
  "0x986ddfd3a4c3f4945049fe7596ae04c083ef6a56da3cafba7bdd987cc5ef2d",
);
assert.deepEqual(nonceFromHex(nonceHex(nonce)), nonce);
assert.notEqual(entryIdForSeat(tableId, 2, nonce), entryId);
assert.notEqual(tableIdForRoom("10112233-4455-6677-8899-aabbccddeeff"), tableId);
assert.throws(() => tableIdForRoom("not-a-room"));
assert.throws(() => entryIdForSeat(tableId, 6, nonce));
assert.throws(() => nonceFromHex("00"));

console.log("aztec id vectors passed");
