import {
  decodePublicInputs,
  verifyChallengeProofs,
  type ChallengePublicInputs,
} from "./challenge-proof.ts";
import {
  CHALLENGE_POINTS,
  CHALLENGE_VERSION,
  catalogRoot,
  decodeHex,
  encodeHex,
  handTag,
} from "./challenge.ts";
import { uuidBytes } from "./deal.ts";
import type { ProofReceipt } from "./server.ts";

const PROOF_SYSTEM = "ultra_honk";
const CIRCUIT_ID = "challenge_v2";
const BB_VERSION = "5.2.0";
const ARTIFACT_SHA256 = "1c89fb88ae0fb02558efa61de73260f871b323cba2a8a3d7c6423a302237bd5d";
const VK_SHA256 = "b435db9d240683e181d8bad47203bf85d57ca27982bc676cf2686b5cf3de1d67";
const ZERO = "00".repeat(32);

export type ReceiptProof = "draw" | "completion";

export async function verifyReceipt(
  receipt: ProofReceipt,
  onVerified?: (proof: ReceiptProof) => void,
) {
  validateReceipt(receipt);
  const verified = await verifyChallengeProofs(
    [
      { proof: receipt.draw_proof, publicInputs: receipt.draw_public_inputs },
      { proof: receipt.completion_proof, publicInputs: receipt.completion_public_inputs },
    ],
    (index) => onVerified?.(index === 0 ? "draw" : "completion"),
  );

  if (!verified) throw new Error("proof verification failed");
}

export function validateReceipt(receipt: ProofReceipt) {
  const expectedTag = encodeHex(handTag(uuidBytes(receipt.room), BigInt(receipt.hand_no)));

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
    !Number.isInteger(receipt.hand_no) ||
    receipt.hand_no < 0 ||
    receipt.hand_tag !== expectedTag ||
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
  ]) decodeHex(value);

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
