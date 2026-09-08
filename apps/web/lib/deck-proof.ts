import { withDeckRuntime } from './deck-runtime.ts';
import { timing } from './diagnostics.ts';
import circuit from "../zk/deck_shuffle.json" with { type: "json" };
import { deckShuffleVk } from "../zk/deck-shuffle-vk.ts";

import { bytes, type CipherValue, type PointValue } from "./deck-crypto.ts";

export type ShuffleInput = {
  hand: number;
  seat: number;
  context: string;
  input: readonly CipherValue[];
  output: readonly CipherValue[];
  key: PointValue;
  permutation: readonly number[];
  masks: readonly string[];
};

export async function proveShuffle(input: ShuffleInput, status: (value: string) => void) {
  if (input.input.length !== 52 || input.output.length !== 52) {
    throw new Error("invalid encrypted deck");
  }
  status("loading resources");
  const resourcesAt = performance.now();
  const [{ UltraHonkBackend }, { Noir }] = await Promise.all([
    import("@aztec/bb.js"),
    import("@noir-lang/noir_js"),
  ]);
  timing("resources", { hand: input.hand, duration: performance.now() - resourcesAt });
  status("building witness");
  const witnessAt = performance.now();
  const noir = new Noir(circuit as ConstructorParameters<typeof Noir>[0]);
  const { witness } = await noir.execute(noirInput(input));

  timing("witness", { hand: input.hand, duration: performance.now() - witnessAt });
  status("proving shuffle");
  return withDeckRuntime(async api => {
    const proofAt = performance.now();
    const backend = new UltraHonkBackend(circuit.bytecode, api);
    const proof = await backend.generateProof(witness, { verifierTarget: "noir-recursive" });

    timing("proof", { hand: input.hand, duration: performance.now() - proofAt });
    return {
      proof: base64(proof.proof),
      public_inputs: base64(flatten(proof.publicInputs)),
    };
  });
}

export async function verifyShuffle(
  input: Omit<ShuffleInput, "permutation" | "masks">,
  proofValue: string,
  publicValue: string,
) {
  const [{ UltraHonkVerifierBackend }] = await Promise.all([
    import("@aztec/bb.js"),
  ]);
  const publicInputs = split(unbase64(publicValue));
  const expected = publicFields(input);
  if (publicInputs.length !== expected.length || publicInputs.some((value, index) => value !== expected[index])) {
    throw new Error("shuffle public inputs mismatch");
  }
  return withDeckRuntime(async api => {
    const backend = new UltraHonkVerifierBackend(api);
    const at = performance.now();
    const valid = await backend.verifyProof(
      {
        proof: unbase64(proofValue),
        publicInputs,
        verificationKey: unbase64(deckShuffleVk),
      },
      { verifierTarget: "noir-recursive" },
    );
    timing("verify", { hand: input.hand, duration: performance.now() - at });
    return valid;
  }).catch((error: unknown) => {
    // This pinned backend throws instead of returning false for malformed points.
    if (error instanceof Error && error.message === "Deserialized point is not on the curve") {
      throw new Error("invalid shuffle proof point");
    }
    throw new Error("Proof verifier unavailable. Retry this check after the current hand.");
  });
}

function noirInput(input: ShuffleInput) {
  const coord = (deck: readonly CipherValue[], side: "left" | "right", axis: "x" | "y") =>
    deck.map((card) => card[side][axis]);

  return {
    protocol_version: 1,
    hand_no: input.hand,
    seat: input.seat,
    context: Array.from(bytes(input.context)),
    input_left_x: coord(input.input, "left", "x"),
    input_left_y: coord(input.input, "left", "y"),
    input_right_x: coord(input.input, "right", "x"),
    input_right_y: coord(input.input, "right", "y"),
    output_left_x: coord(input.output, "left", "x"),
    output_left_y: coord(input.output, "left", "y"),
    output_right_x: coord(input.output, "right", "x"),
    output_right_y: coord(input.output, "right", "y"),
    key_x: input.key.x,
    key_y: input.key.y,
    permutation: Array.from(input.permutation),
    masks: Array.from(input.masks),
  };
}

function publicFields(input: Omit<ShuffleInput, "permutation" | "masks">) {
  const value = noirInput({ ...input, permutation: [], masks: [] });
  const fields = [
    value.protocol_version,
    value.hand_no,
    value.seat,
    ...value.context,
    ...value.input_left_x,
    ...value.input_left_y,
    ...value.input_right_x,
    ...value.input_right_y,
    ...value.output_left_x,
    ...value.output_left_y,
    ...value.output_right_x,
    ...value.output_right_y,
    value.key_x,
    value.key_y,
  ];
  return fields.map((field) => `0x${BigInt(field).toString(16).padStart(64, "0")}`);
}

function flatten(fields: string[]) {
  const output = new Uint8Array(fields.length * 32);

  for (let i = 0; i < fields.length; i += 1) {
    const value = fields[i];
    if (!/^0x[0-9a-f]{64}$/.test(value)) throw new Error("invalid public input");
    output.set(bytes(value.slice(2)), i * 32);
  }
  return output;
}

function base64(value: Uint8Array) {
  let raw = "";
  for (const byte of value) raw += String.fromCharCode(byte);
  return btoa(raw);
}

function unbase64(value: string) {
  const raw = atob(value);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

function split(value: Uint8Array) {
  if (value.length % 32 !== 0) throw new Error("invalid public inputs");
  return Array.from({ length: value.length / 32 }, (_, index) =>
    `0x${Array.from(value.slice(index * 32, index * 32 + 32), (byte) => byte.toString(16).padStart(2, "0")).join("")}`,
  );
}
