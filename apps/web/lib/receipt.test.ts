import assert from "node:assert/strict";

import { catalogRoot, encodeHex, handTag } from "./challenge.ts";
import { uuidBytes } from "./deal.ts";
import { validateReceipt } from "./receipt.ts";

const room = "00112233-4455-6677-8899-aabbccddeeff";
const handNo = 9;
const hand = handTag(uuidBytes(room), BigInt(handNo));
const commitment = new Uint8Array(32).fill(0x22);
const nonce = new Uint8Array(32).fill(0x33);
const facts = new Uint8Array(32).fill(0x44);
const nullifier = new Uint8Array(32).fill(0x55);
const root = catalogRoot();

function publicInputs(mode: 0 | 1, factsHash: Uint8Array, value: Uint8Array) {
  const bytes = [mode, ...hand, 2, ...commitment, ...nonce, ...factsHash, ...value, ...root];
  const fields = Buffer.alloc(bytes.length * 32);
  bytes.forEach((byte, index) => { fields[index * 32 + 31] = byte; });
  return fields.toString("base64");
}

const receipt = {
  protocol_version: 2,
  room,
  hand_no: handNo,
  proof_system: "ultra_honk",
  circuit_id: "challenge_v2",
  bb_version: "5.2.0",
  artifact_sha256: "1c89fb88ae0fb02558efa61de73260f871b323cba2a8a3d7c6423a302237bd5d",
  vk_sha256: "b435db9d240683e181d8bad47203bf85d57ca27982bc676cf2686b5cf3de1d67",
  hand_tag: encodeHex(hand),
  seat: 2,
  commitment: encodeHex(commitment),
  nonce: encodeHex(nonce),
  facts_hash: encodeHex(facts),
  nullifier: encodeHex(nullifier),
  catalog_root: encodeHex(root),
  points: 20,
  draw_proof: "AA==",
  draw_public_inputs: publicInputs(0, new Uint8Array(32), new Uint8Array(32)),
  completion_proof: "AA==",
  completion_public_inputs: publicInputs(1, facts, nullifier),
};

assert.doesNotThrow(() => validateReceipt(receipt));
assert.doesNotThrow(() =>
  validateReceipt({ ...receipt, draw_proof: undefined, draw_public_inputs: undefined }),
);
assert.throws(() => validateReceipt({ ...receipt, draw_proof: undefined }));
assert.throws(() => validateReceipt({ ...receipt, room: "10112233-4455-6677-8899-aabbccddeeff" }));
assert.throws(() => validateReceipt({ ...receipt, hand_no: handNo + 1 }));
assert.throws(() => validateReceipt({ ...receipt, points: 40 }));
assert.throws(() => validateReceipt({ ...receipt, completion_public_inputs: receipt.draw_public_inputs }));
process.stdout.write("proof receipt bindings ok\n");
