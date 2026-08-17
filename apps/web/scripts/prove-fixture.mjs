import { BackendType, Barretenberg, UltraHonkBackend } from "@aztec/bb.js";
import { Noir } from "@noir-lang/noir_js";

import circuit from "../zk/challenge_v1.json" with { type: "json" };
import fixture from "../../../circuits/challenge-v1/test-vector.json" with { type: "json" };

const bytes = (value) => Array.from(Buffer.from(value, "hex"));
const noir = new Noir(circuit);
const { witness } = await noir.execute({
  hand_tag: bytes(fixture.hand_tag),
  seat: fixture.seat,
  tier: fixture.tier,
  commitment: bytes(fixture.commitment),
  nonce: bytes(fixture.nonce),
  facts_hash: bytes(fixture.facts_hash),
  nullifier: bytes(fixture.nullifier),
  secret: bytes(fixture.secret),
  facts: fixture.facts,
});
const api = await Barretenberg.new({ backend: BackendType.Wasm });

try {
  const backend = new UltraHonkBackend(circuit.bytecode, api);
  const log = console.log;

  console.log = () => {};
  const proof = await backend.generateProof(witness, {
    verifierTarget: "noir-recursive",
  });
  console.log = log;

  process.stdout.write(
    JSON.stringify({
      proof: Buffer.from(proof.proof).toString("base64"),
      public_inputs: Buffer.concat(
        proof.publicInputs.map((field) => Buffer.from(field.slice(2), "hex")),
      ).toString("base64"),
    }),
  );
} finally {
  await api.destroy();
}
