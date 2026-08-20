import assert from "node:assert/strict";

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
console.log(`verified challenge ${index}`);
