import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import "../lib/aztec/polyfills.ts";
import {
  catalogRoot,
  commitment,
  factsHash,
  handTag,
  nullifier,
  objectiveAt,
  objectiveIndex,
  objectiveMet,
  objectivePath,
  encodeHex,
} from "../lib/challenge.ts";
import { proveChallenge, verifyChallengeProofs } from "../lib/challenge-proof.ts";

const room = Uint8Array.from({ length: 16 }, (_, index) => index + 1);
const tag = handTag(room, 9n);
const seat = 1;
const secret = Uint8Array.from({ length: 32 }, (_, index) => index + 17);
const nonce = Uint8Array.from({ length: 32 }, (_, index) => 255 - index);
const index = objectiveIndex(tag, seat, nonce, secret);
const objective = objectiveAt(index);
const root = catalogRoot();
const siblings = objectivePath(index);
const zeros = new Uint8Array(32);
const draw = await proveChallenge(
  {
    mode: 0,
    handTag: tag,
    seat,
    commitment: commitment(tag, seat, secret),
    nonce,
    factsHash: zeros,
    nullifier: zeros,
    catalogRoot: root,
    secret,
    factsSalt: zeros,
    facts: [0, 0, 0, 0, 0, 0],
    mustTrue: objective.mustTrue,
    mustFalse: objective.mustFalse,
    siblings,
  },
  () => undefined,
);
const facts = objective.mustTrue.map((value) => (value === 1 ? 1 : 0));
const salt = Uint8Array.from({ length: 32 }, (_, index) => index + 73);

assert.equal(objectiveMet(objective, facts), true);

const completion = await proveChallenge(
  {
    mode: 1,
    handTag: tag,
    seat,
    commitment: commitment(tag, seat, secret),
    nonce,
    factsHash: factsHash(tag, seat, salt, facts),
    nullifier: nullifier(tag, seat, secret),
    catalogRoot: root,
    secret,
    factsSalt: salt,
    facts,
    mustTrue: objective.mustTrue,
    mustFalse: objective.mustFalse,
    siblings,
  },
  () => undefined,
);
const verified = await verifyChallengeProofs([
  { proof: draw.proof, publicInputs: draw.public_inputs },
  { proof: completion.proof, publicInputs: completion.public_inputs },
]);

assert.equal(verified, true);
const dir = await mkdtemp(join(tmpdir(), "noir-poker-proof-"));
const run = promisify(execFile);
const common = {
  protocol_version: 2,
  room: "01020304-0506-0708-090a-0b0c0d0e0f10",
  hand_no: 9,
  seat,
  proof_system: "ultra_honk",
  circuit_id: "challenge_v2",
  bb_version: "5.2.0",
  artifact_sha256: "1c89fb88ae0fb02558efa61de73260f871b323cba2a8a3d7c6423a302237bd5d",
  vk_sha256: "b435db9d240683e181d8bad47203bf85d57ca27982bc676cf2686b5cf3de1d67",
  hand_tag: encodeHex(tag),
  commitment: encodeHex(commitment(tag, seat, secret)),
  nonce: encodeHex(nonce),
  catalog_root: encodeHex(root),
};

try {
  const values = [
    { ...common, kind: "draw", proof: draw.proof, public_inputs: draw.public_inputs },
    {
      ...common,
      kind: "completion",
      facts_hash: encodeHex(factsHash(tag, seat, salt, facts)),
      nullifier: encodeHex(nullifier(tag, seat, secret)),
      proof: completion.proof,
      public_inputs: completion.public_inputs,
    },
  ];

  for (const value of values) {
    const file = join(dir, `${value.kind}.json`);
    await writeFile(file, JSON.stringify(value));
    await run(process.execPath, ["scripts/verify-receipt.mjs", file], { cwd: process.cwd() });
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}
console.log(`verified challenge ${index}`);
