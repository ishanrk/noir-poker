import {
  decodePublicInputs,
  verifyChallengeProof,
  type ChallengePublicInputs,
} from "@/lib/challenge-proof";
import { CHALLENGE_POINTS, CHALLENGE_VERSION, catalogRoot, decodeHex, encodeHex } from "@/lib/challenge";
import type { ProofReceipt } from "@/lib/server";

const PROOF_SYSTEM = "ultra_honk";
const CIRCUIT_ID = "challenge_v2";
const BB_VERSION = "5.2.0";
const ARTIFACT_SHA256 = "83a9a72327d42546fe6449306b916c993d1df820717f8bccd2dd6c9659b3f171";
const VK_SHA256 = "b435db9d240683e181d8bad47203bf85d57ca27982bc676cf2686b5cf3de1d67";
const ZERO = "00".repeat(32);

export async function verifyReceipt(receipt: ProofReceipt) {
  validateReceipt(receipt);

  if (!(await verifyChallengeProof(receipt.draw_proof, receipt.draw_public_inputs))) {
    throw new Error("draw proof failed");
  }

  if (!(await verifyChallengeProof(receipt.completion_proof, receipt.completion_public_inputs))) {
    throw new Error("completion proof failed");
  }
}

export function validateReceipt(receipt: ProofReceipt) {
  if (
    receipt.protocol_version !== CHALLENGE_VERSION ||
    receipt.proof_system !== PROOF_SYSTEM ||
    receipt.circuit_id !== CIRCUIT_ID ||
    receipt.bb_version !== BB_VERSION ||
    receipt.artifact_sha256 !== ARTIFACT_SHA256 ||
    receipt.vk_sha256 !== VK_SHA256 ||
    receipt.points !== CHALLENGE_POINTS ||
    receipt.seat < 0 ||
    receipt.seat > 5 ||
    !Number.isInteger(receipt.seat) ||
    receipt.catalog_root !== encodeHex(catalogRoot())
  ) {
    throw new Error("invalid proof receipt");
  }

  for (const value of [
    receipt.hand_tag,
    receipt.commitment,
    receipt.nonce,
    receipt.facts_hash,
    receipt.nullifier,
    receipt.catalog_root,
  ]) {
    decodeHex(value);
  }

  const draw = decodePublicInputs(receipt.draw_public_inputs);
  const completion = decodePublicInputs(receipt.completion_public_inputs);

  if (
    !commonMatches(draw, receipt) ||
    !commonMatches(completion, receipt) ||
    draw.mode !== 0 ||
    encodeHex(draw.factsHash) !== ZERO ||
    encodeHex(draw.nullifier) !== ZERO ||
    completion.mode !== 1 ||
    encodeHex(completion.factsHash) !== receipt.facts_hash ||
    encodeHex(completion.nullifier) !== receipt.nullifier
  ) {
    throw new Error("proof receipt mismatch");
  }
}

function commonMatches(inputs: ChallengePublicInputs, receipt: ProofReceipt) {
  return (
    encodeHex(inputs.handTag) === receipt.hand_tag &&
    inputs.seat === receipt.seat &&
    encodeHex(inputs.commitment) === receipt.commitment &&
    encodeHex(inputs.nonce) === receipt.nonce &&
    encodeHex(inputs.catalogRoot) === receipt.catalog_root
  );
}
