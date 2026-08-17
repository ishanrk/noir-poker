import { BackendType, Barretenberg, UltraHonkBackend } from "@aztec/bb.js";
import { Noir } from "@noir-lang/noir_js";

import circuit from "../zk/challenge_v2.json" with { type: "json" };
import fixture from "../../../circuits/challenge-v2/test-vector.json" with { type: "json" };

const bytes = (value) => Array.from(Buffer.from(value, "hex"));
const common = {
  hand_tag: bytes(fixture.hand_tag),
  seat: fixture.seat,
  commitment: bytes(fixture.commitment),
  nonce: bytes(fixture.nonce),
  catalog_root: bytes(fixture.catalog_root),
  secret: bytes(fixture.secret),
  must_true: fixture.must_true,
  must_false: fixture.must_false,
  siblings: fixture.siblings.map(bytes),
};
const noir = new Noir(circuit);
const draw = await noir.execute({
  ...common,
  mode: 0,
  facts_hash: Array(32).fill(0),
  nullifier: Array(32).fill(0),
  facts_salt: Array(32).fill(0),
  facts: Array(6).fill(0),
});
const completion = await noir.execute({
  ...common,
  mode: 1,
  facts_hash: bytes(fixture.facts_hash),
  nullifier: bytes(fixture.nullifier),
  facts_salt: bytes(fixture.facts_salt),
  facts: fixture.facts,
});
const api = await Barretenberg.new({ backend: BackendType.Wasm });

try {
  const backend = new UltraHonkBackend(circuit.bytecode, api);
  const log = console.log;

  console.log = () => {};
  const started = performance.now();
  const drawProof = await backend.generateProof(draw.witness, {
    verifierTarget: "noir-recursive",
  });
  const completionProof = await backend.generateProof(completion.witness, {
    verifierTarget: "noir-recursive",
  });
  const proveMs = performance.now() - started;
  console.log = log;
  const drawEncoded = encode(drawProof);
  const completionEncoded = encode(completionProof);
  const result = {
    draw: drawEncoded,
    completion: completionEncoded,
    proof: completionEncoded.proof,
    public_inputs: completionEncoded.public_inputs,
    proof_bytes: completionProof.proof.length,
    public_fields: completionProof.publicInputs.length,
    prove_ms: proveMs,
  };

  if (process.argv[2] === "receipt" || process.argv[2] === "corrupt-receipt") {
    const receipt = {
      protocol_version: 2,
      proof_system: "ultra_honk",
      circuit_id: "challenge_v2",
      bb_version: "5.2.0",
      artifact_sha256: "83a9a72327d42546fe6449306b916c993d1df820717f8bccd2dd6c9659b3f171",
      vk_sha256: "b435db9d240683e181d8bad47203bf85d57ca27982bc676cf2686b5cf3de1d67",
      hand_tag: fixture.hand_tag,
      seat: fixture.seat,
      commitment: fixture.commitment,
      nonce: fixture.nonce,
      facts_hash: fixture.facts_hash,
      nullifier: fixture.nullifier,
      catalog_root: fixture.catalog_root,
      points: 20,
      draw_proof: drawEncoded.proof,
      draw_public_inputs: drawEncoded.public_inputs,
      completion_proof: completionEncoded.proof,
      completion_public_inputs: completionEncoded.public_inputs,
    };

    if (process.argv[2] === "corrupt-receipt") receipt.nullifier = "00".repeat(32);
    process.stdout.write(JSON.stringify(receipt));
  } else {
    process.stdout.write(JSON.stringify(result));
  }
} finally {
  await api.destroy();
}

function encode(proof) {
  return {
    proof: Buffer.from(proof.proof).toString("base64"),
    public_inputs: Buffer.concat(
      proof.publicInputs.map((field) => Buffer.from(field.slice(2), "hex")),
    ).toString("base64"),
  };
}
