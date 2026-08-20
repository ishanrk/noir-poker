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
import type { ProofReceipt, PublishedProof } from "./server.ts";

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
  const proofs = [];
  const kinds: ReceiptProof[] = [];

  if (receipt.draw_proof && receipt.draw_public_inputs) {
    proofs.push({ proof: receipt.draw_proof, publicInputs: receipt.draw_public_inputs });
    kinds.push("draw");
  }
  proofs.push({ proof: receipt.completion_proof, publicInputs: receipt.completion_public_inputs });
  kinds.push("completion");

  const verified = await verifyChallengeProofs(proofs, (index) => onVerified?.(kinds[index]));

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

  const completion = decodePublicInputs(receipt.completion_public_inputs);
  const hasDraw = receipt.draw_proof !== undefined || receipt.draw_public_inputs !== undefined;

  if (
    !commonMatches(completion, receipt) ||
    completion.mode !== 1 ||
    encodeHex(completion.factsHash) !== receipt.facts_hash ||
    encodeHex(completion.nullifier) !== receipt.nullifier ||
    (hasDraw && (!receipt.draw_proof || !receipt.draw_public_inputs))
  ) {
    throw new Error("proof receipt mismatch");
  }

  if (receipt.draw_public_inputs) {
    const draw = decodePublicInputs(receipt.draw_public_inputs);

    if (
      !commonMatches(draw, receipt) ||
      draw.mode !== 0 ||
      encodeHex(draw.factsHash) !== ZERO ||
      encodeHex(draw.nullifier) !== ZERO
    ) {
      throw new Error("proof receipt mismatch");
    }
  }
}

export async function verifyPublishedProof(proof: PublishedProof) {
  const expectedTag = encodeHex(handTag(uuidBytes(proof.room), BigInt(proof.hand_no)));
  const inputs = decodePublicInputs(proof.public_inputs);
  if (proof.kind !== "draw" && proof.kind !== "completion") {
    throw new Error("published proof mismatch");
  }
  const mode = proof.kind === "draw" ? 0 : 1;

  if (
    proof.protocol_version !== CHALLENGE_VERSION ||
    proof.proof_system !== PROOF_SYSTEM ||
    proof.circuit_id !== CIRCUIT_ID ||
    proof.bb_version !== BB_VERSION ||
    proof.artifact_sha256 !== ARTIFACT_SHA256 ||
    proof.vk_sha256 !== VK_SHA256 ||
    proof.seat < 0 ||
    proof.seat > 5 ||
    !Number.isInteger(proof.seat) ||
    !Number.isInteger(proof.hand_no) ||
    proof.hand_no < 0 ||
    proof.hand_tag !== expectedTag ||
    proof.catalog_root !== encodeHex(catalogRoot()) ||
    inputs.mode !== mode ||
    encodeHex(inputs.handTag) !== proof.hand_tag ||
    inputs.seat !== proof.seat ||
    encodeHex(inputs.commitment) !== proof.commitment ||
    encodeHex(inputs.nonce) !== proof.nonce ||
    encodeHex(inputs.catalogRoot) !== proof.catalog_root ||
    (mode === 0 && (encodeHex(inputs.factsHash) !== ZERO || encodeHex(inputs.nullifier) !== ZERO))
  ) {
    throw new Error("published proof mismatch");
  }

  // same verifier for both modes
  if (!(await verifyChallengeProofs([{ proof: proof.proof, publicInputs: proof.public_inputs }]))) {
    throw new Error("proof verification failed");
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
