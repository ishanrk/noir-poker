import circuit from "@/zk/challenge_v2.json";

export type ProofStatus = "preparing" | "proving";

export type ChallengeProofInput = {
  mode: 0 | 1;
  handTag: Uint8Array;
  seat: number;
  commitment: Uint8Array;
  nonce: Uint8Array;
  factsHash: Uint8Array;
  nullifier: Uint8Array;
  catalogRoot: Uint8Array;
  secret: Uint8Array;
  factsSalt: Uint8Array;
  facts: readonly number[];
  mustTrue: readonly number[];
  mustFalse: readonly number[];
  siblings: readonly Uint8Array[];
};

export type ChallengePublicInputs = Pick<
  ChallengeProofInput,
  | "mode"
  | "handTag"
  | "seat"
  | "commitment"
  | "nonce"
  | "factsHash"
  | "nullifier"
  | "catalogRoot"
>;

const PUBLIC_FIELDS = 194;
const PUBLIC_BYTES = PUBLIC_FIELDS * 32;

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
    mode: input.mode,
    hand_tag: Array.from(input.handTag),
    seat: input.seat,
    commitment: Array.from(input.commitment),
    nonce: Array.from(input.nonce),
    facts_hash: Array.from(input.factsHash),
    nullifier: Array.from(input.nullifier),
    catalog_root: Array.from(input.catalogRoot),
    secret: Array.from(input.secret),
    facts_salt: Array.from(input.factsSalt),
    facts: Array.from(input.facts),
    must_true: Array.from(input.mustTrue),
    must_false: Array.from(input.mustFalse),
    siblings: input.siblings.map((value) => Array.from(value)),
  });

  status("proving");

  const api = await Barretenberg.new({ backend: BackendType.WasmWorker });

  try {
    const backend = new UltraHonkBackend(circuit.bytecode, api);
    const proof = await backend.generateProof(witness, {
      verifierTarget: "noir-recursive",
    });

    if (proof.publicInputs.length !== PUBLIC_FIELDS || proof.proof.length > 65536) {
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

type EncodedProof = {
  proof: string;
  publicInputs: string;
};

export async function verifyChallengeProofs(
  proofs: readonly EncodedProof[],
  onVerified?: (index: number) => void,
) {
  const { BackendType, Barretenberg, UltraHonkBackend, deflattenFields } = await import(
    "@aztec/bb.js"
  );
  const api = await Barretenberg.new({ backend: BackendType.WasmWorker });

  try {
    const backend = new UltraHonkBackend(circuit.bytecode, api);

    for (let i = 0; i < proofs.length; i += 1) {
      const proof = proofs[i];
      const proofBytes = decodeBase64(proof.proof);
      const publicInputs = decodeBase64(proof.publicInputs);

      if (
        proofBytes.length === 0 ||
        proofBytes.length > 65536 ||
        proofBytes.length % 32 !== 0 ||
        publicInputs.length !== PUBLIC_BYTES
      ) {
        return false;
      }

      const verified = await backend.verifyProof(
        {
          proof: proofBytes,
          publicInputs: deflattenFields(publicInputs),
        },
        { verifierTarget: "noir-recursive" },
      );

      if (!verified) {
        return false;
      }

      onVerified?.(i);
    }

    return true;
  } finally {
    await api.destroy();
  }
}

export function decodePublicInputs(value: string): ChallengePublicInputs {
  const fields = decodeBase64(value);

  if (fields.length !== PUBLIC_BYTES) {
    throw new Error("invalid public inputs");
  }

  const values = Array.from({ length: PUBLIC_FIELDS }, (_, i) => {
    const field = fields.subarray(i * 32, i * 32 + 32);

    if (field.subarray(0, 31).some((byte) => byte !== 0)) {
      throw new Error("invalid public inputs");
    }

    return field[31];
  });
  let offset = 0;
  const take = () => values[offset++];
  const bytes = () => Uint8Array.from({ length: 32 }, take);
  const mode = take();

  if (mode !== 0 && mode !== 1) {
    throw new Error("invalid public inputs");
  }

  return {
    mode,
    handTag: bytes(),
    seat: take(),
    commitment: bytes(),
    nonce: bytes(),
    factsHash: bytes(),
    nullifier: bytes(),
    catalogRoot: bytes(),
  };
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

function decodeBase64(value: string) {
  const raw = atob(value);

  return Uint8Array.from(raw, (byte) => byte.charCodeAt(0));
}
