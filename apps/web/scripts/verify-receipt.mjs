import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BackendType,
  Barretenberg,
  UltraHonkBackend,
  deflattenFields,
} from "@aztec/bb.js";

const ARTIFACT_SHA256 = "83a9a72327d42546fe6449306b916c993d1df820717f8bccd2dd6c9659b3f171";
const VK_SHA256 = "b435db9d240683e181d8bad47203bf85d57ca27982bc676cf2686b5cf3de1d67";
const ROOT = "0e5885f1c42a9799237a606f214f7256806d77977179e5b9ff49ea99b446c409";
const ZERO = "00".repeat(32);
const here = dirname(fileURLToPath(import.meta.url));
const artifactPath = resolve(here, "../zk/challenge_v2.json");
const source = await readFile(artifactPath);
const artifact = JSON.parse(source);
const input = process.argv[2];

if (!input) {
  throw new Error("usage node scripts/verify-receipt.mjs receipt.json");
}

if (createHash("sha256").update(source).digest("hex") !== ARTIFACT_SHA256) {
  throw new Error("challenge artifact mismatch");
}

const receipt = await loadReceipt(input);
const draw = decodePublic(receipt.draw_public_inputs);
const completion = decodePublic(receipt.completion_public_inputs);

if (
  receipt.protocol_version !== 2 ||
  receipt.proof_system !== "ultra_honk" ||
  receipt.circuit_id !== "challenge_v2" ||
  receipt.bb_version !== "5.2.0" ||
  receipt.artifact_sha256 !== ARTIFACT_SHA256 ||
  receipt.vk_sha256 !== VK_SHA256 ||
  receipt.catalog_root !== ROOT ||
  receipt.points !== 20 ||
  !Number.isInteger(receipt.seat) ||
  receipt.seat < 0 ||
  receipt.seat > 5 ||
  !common(draw, receipt) ||
  !common(completion, receipt) ||
  draw.mode !== 0 ||
  draw.factsHash !== ZERO ||
  draw.nullifier !== ZERO ||
  completion.mode !== 1 ||
  completion.factsHash !== receipt.facts_hash ||
  completion.nullifier !== receipt.nullifier
) {
  throw new Error("proof receipt mismatch");
}

const api = await Barretenberg.new({ backend: BackendType.Wasm });

try {
  const backend = new UltraHonkBackend(artifact.bytecode, api);

  for (const [proof, publicInputs] of [
    [receipt.draw_proof, receipt.draw_public_inputs],
    [receipt.completion_proof, receipt.completion_public_inputs],
  ]) {
    const verified = await backend.verifyProof(
      {
        proof: Buffer.from(proof, "base64"),
        publicInputs: deflattenFields(Buffer.from(publicInputs, "base64")),
      },
      { verifierTarget: "noir-recursive" },
    );

    if (!verified) {
      throw new Error("proof verification failed");
    }
  }
} finally {
  await api.destroy();
}

process.stdout.write(`verified ${receipt.nullifier}\n`);

async function loadReceipt(value) {
  if (value === "-") {
    let source = "";

    for await (const chunk of process.stdin) source += chunk;
    return JSON.parse(source);
  }

  if (/^https?:\/\//.test(value)) {
    const response = await fetch(value);

    if (!response.ok) throw new Error(`receipt request failed ${response.status}`);
    return response.json();
  }

  return JSON.parse(await readFile(value, "utf8"));
}

function decodePublic(value) {
  const bytes = Buffer.from(value, "base64");

  if (bytes.length !== 194 * 32) throw new Error("invalid public inputs");

  const fields = Array.from({ length: 194 }, (_, i) => {
    const field = bytes.subarray(i * 32, i * 32 + 32);

    if (field.subarray(0, 31).some((byte) => byte !== 0)) {
      throw new Error("invalid public inputs");
    }

    return field[31];
  });
  let offset = 0;
  const take = () => fields[offset++];
  const hex = () => Buffer.from(Array.from({ length: 32 }, take)).toString("hex");

  return {
    mode: take(),
    handTag: hex(),
    seat: take(),
    commitment: hex(),
    nonce: hex(),
    factsHash: hex(),
    nullifier: hex(),
    catalogRoot: hex(),
  };
}

function common(inputs, receipt) {
  return (
    inputs.handTag === receipt.hand_tag &&
    inputs.seat === receipt.seat &&
    inputs.commitment === receipt.commitment &&
    inputs.nonce === receipt.nonce &&
    inputs.catalogRoot === receipt.catalog_root
  );
}
