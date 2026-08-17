import circuit from "@/zk/challenge_v1.json";

export type ProofStatus = "preparing" | "proving";

type ChallengeProofInput = {
  handTag: Uint8Array;
  seat: number;
  tier: number;
  commitment: Uint8Array;
  nonce: Uint8Array;
  factsHash: Uint8Array;
  nullifier: Uint8Array;
  secret: Uint8Array;
  facts: readonly number[];
};

export async function proveChallenge(
  input: ChallengeProofInput,
  status: (value: ProofStatus) => void,
) {
  status("preparing");

  const [{ BackendType, Barretenberg, UltraHonkBackend }, { Noir }] = await Promise.all([
    import("@aztec/bb.js"),
    import("@noir-lang/noir_js"),
  ]);
  const noir = new Noir(circuit as ConstructorParameters<typeof Noir>[0]);
  const { witness } = await noir.execute({
    hand_tag: Array.from(input.handTag),
    seat: input.seat,
    tier: input.tier,
    commitment: Array.from(input.commitment),
    nonce: Array.from(input.nonce),
    facts_hash: Array.from(input.factsHash),
    nullifier: Array.from(input.nullifier),
    secret: Array.from(input.secret),
    facts: Array.from(input.facts),
  });

  status("proving");

  const api = await Barretenberg.new({ backend: BackendType.WasmWorker });

  try {
    const backend = new UltraHonkBackend(circuit.bytecode, api);
    const proof = await backend.generateProof(witness, {
      verifierTarget: "noir-recursive",
    });

    if (proof.publicInputs.length !== 162 || proof.proof.length > 65536) {
      throw new Error("invalid challenge proof");
    }

    return {
      proof: encodeBase64(proof.proof),
      public_inputs: encodeBase64(flattenFields(proof.publicInputs)),
    };
  } finally {
    await api.destroy();
  }
}

function flattenFields(fields: string[]) {
  const bytes = new Uint8Array(fields.length * 32);

  for (let i = 0; i < fields.length; i += 1) {
    const value = fields[i];

    if (!/^0x[0-9a-f]{64}$/.test(value)) {
      throw new Error("invalid public input");
    }

    for (let j = 0; j < 32; j += 1) {
      bytes[i * 32 + j] = Number.parseInt(value.slice(2 + j * 2, 4 + j * 2), 16);
    }
  }

  return bytes;
}

function encodeBase64(bytes: Uint8Array) {
  let value = "";

  for (const byte of bytes) {
    value += String.fromCharCode(byte);
  }

  return btoa(value);
}
