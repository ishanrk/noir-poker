import { sha256 } from "@noble/hashes/sha2.js";

export const DECK_SIZE = 52;

const KEY_DOMAIN = new TextEncoder().encode("NPKEY001");
const SHARE_DOMAIN = new TextEncoder().encode("NPSHARE1");
const TRANSCRIPT_DOMAIN = new TextEncoder().encode("NPDECK01");
const SCALAR_MODULUS = 0x30644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd47n;

export type PointValue = { x: string; y: string };
export type CipherValue = { left: PointValue; right: PointValue };
export type ShareProof = { a: PointValue; b: PointValue; z: string };

type Curve = Awaited<ReturnType<typeof curve>>;
type Point = Curve["Point"]["prototype"];
type Scalar = InstanceType<Curve["Scalar"]>;

export function randomScalar() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes.subarray(1));
  return `0x${hex(bytes)}`;
}

export async function publicKey(secret: string): Promise<PointValue> {
  const { Grumpkin, Scalar } = await curve();
  return pointValue(await Grumpkin.mul(Grumpkin.generator, scalar(secret, Scalar)));
}

export async function keyProof(secretValue: string, context: Uint8Array): Promise<ShareProof> {
  const api = await curve();
  const secret = scalar(secretValue, api.Scalar);
  const nonce = scalar(randomScalar(), api.Scalar);
  const key = await api.Grumpkin.mul(api.Grumpkin.generator, secret);
  const a = await api.Grumpkin.mul(api.Grumpkin.generator, nonce);
  const c = challenge(KEY_DOMAIN, context, [key, a], api.Scalar);
  const z = new api.Scalar((nonce.toBigInt() + c.toBigInt() * secret.toBigInt()) % SCALAR_MODULUS);

  return { a: pointValue(a), b: zeroPoint(), z: scalarValue(z) };
}

export async function verifyKey(keyValue: PointValue, proof: ShareProof, context: Uint8Array) {
  const api = await curve();
  const key = point(keyValue, api);
  const a = point(proof.a, api);
  const z = scalar(proof.z, api.Scalar);
  const c = challenge(KEY_DOMAIN, context, [key, a], api.Scalar);
  const [left, right] = await Promise.all([
    api.Grumpkin.mul(api.Grumpkin.generator, z),
    api.Grumpkin.mul(key, c),
  ]);

  return pointHex(proof.b) === "0".repeat(128)
    && (await api.Grumpkin.add(a, right)).equals(left);
}

export async function canonicalDeck(): Promise<CipherValue[]> {
  const { Grumpkin, Scalar } = await curve();

  return Promise.all(Array.from({ length: DECK_SIZE }, async (_, i) => ({
    left: zeroPoint(),
    right: pointValue(await Grumpkin.mul(Grumpkin.generator, new Scalar(i + 1))),
  })));
}

export async function aggregateKeys(values: readonly PointValue[]): Promise<PointValue> {
  if (!values.length) throw new Error("missing deck keys");
  const api = await curve();
  let sum = point(values[0], api);

  for (const value of values.slice(1)) sum = await api.Grumpkin.add(sum, point(value, api));
  return pointValue(sum);
}

export async function shuffleDeck(deck: readonly CipherValue[], key: PointValue) {
  if (deck.length !== DECK_SIZE) throw new Error("invalid encrypted deck");
  const api = await curve();
  const permutation = Array.from({ length: DECK_SIZE }, (_, i) => i);

  for (let i = DECK_SIZE - 1; i > 0; i -= 1) {
    const swap = randomIndex(i + 1);
    [permutation[i], permutation[swap]] = [permutation[swap], permutation[i]];
  }

  const masks = Array.from({ length: DECK_SIZE }, randomScalar);
  const publicKey = point(key, api);
  const output = await Promise.all(permutation.map(async (source, i) => {
    const mask = scalar(masks[i], api.Scalar);
    const card = cipher(deck[source], api);
    const [leftMask, rightMask] = await Promise.all([
      api.Grumpkin.mul(api.Grumpkin.generator, mask),
      api.Grumpkin.mul(publicKey, mask),
    ]);

    return {
      left: pointValue(card.left.isInfinite ? leftMask : await api.Grumpkin.add(card.left, leftMask)),
      right: pointValue(await api.Grumpkin.add(card.right, rightMask)),
    };
  }));

  return { output, permutation, masks };
}

export async function decryptionShare(
  cardValue: CipherValue,
  secretValue: string,
  context: Uint8Array,
) {
  const api = await curve();
  const secret = scalar(secretValue, api.Scalar);
  const nonce = scalar(randomScalar(), api.Scalar);
  const card = cipher(cardValue, api);
  const key = await api.Grumpkin.mul(api.Grumpkin.generator, secret);
  const value = await api.Grumpkin.mul(card.left, secret);
  const [a, b] = await Promise.all([
    api.Grumpkin.mul(api.Grumpkin.generator, nonce),
    api.Grumpkin.mul(card.left, nonce),
  ]);
  const c = challenge(SHARE_DOMAIN, context, [key, card.left, value, a, b], api.Scalar);
  const z = new api.Scalar((nonce.toBigInt() + c.toBigInt() * secret.toBigInt()) % SCALAR_MODULUS);

  return {
    value: pointValue(value),
    proof: { a: pointValue(a), b: pointValue(b), z: scalarValue(z) },
  };
}

export async function decryptionValue(cardValue: CipherValue, secretValue: string) {
  const api = await curve();
  return pointValue(await api.Grumpkin.mul(
    cipher(cardValue, api).left,
    scalar(secretValue, api.Scalar),
  ));
}

export async function verifyShare(
  cardValue: CipherValue,
  keyValue: PointValue,
  valueInput: PointValue,
  proof: ShareProof,
  context: Uint8Array,
) {
  const api = await curve();
  const card = cipher(cardValue, api);
  const key = point(keyValue, api);
  const value = point(valueInput, api);
  const a = point(proof.a, api);
  const b = point(proof.b, api);
  const z = scalar(proof.z, api.Scalar);
  const c = challenge(SHARE_DOMAIN, context, [key, card.left, value, a, b], api.Scalar);
  const [zg, cp, zl, cv] = await Promise.all([
    api.Grumpkin.mul(api.Grumpkin.generator, z),
    api.Grumpkin.mul(key, c),
    api.Grumpkin.mul(card.left, z),
    api.Grumpkin.mul(value, c),
  ]);

  return (await api.Grumpkin.add(a, cp)).equals(zg)
    && (await api.Grumpkin.add(b, cv)).equals(zl);
}

export async function openCard(cardValue: CipherValue, values: readonly PointValue[]) {
  const api = await curve();
  const card = cipher(cardValue, api);
  let value = card.right;

  for (const share of values) {
    const item = point(share, api);
    const inverse = item.isInfinite ? item : new api.Point(item.x, item.y.negate());
    value = await api.Grumpkin.add(value, inverse);
  }
  for (let i = 0; i < DECK_SIZE; i += 1) {
    const cardPoint = await api.Grumpkin.mul(api.Grumpkin.generator, new api.Scalar(i + 1));
    if (cardPoint.equals(value)) return i;
  }
  throw new Error("invalid card opening");
}

export function transcriptStart(room: string, hand: number) {
  return sha256(join(TRANSCRIPT_DOMAIN, uuid(room), u64(BigInt(hand))));
}

export function transcriptNext(
  previous: Uint8Array,
  seq: number,
  kind: string,
  seat: number | undefined,
  payload: Uint8Array,
) {
  const name = new TextEncoder().encode(kind);
  if (name.length > 255 || seat !== undefined && (seat < 0 || seat > 254)) {
    throw new Error("invalid transcript record");
  }
  return sha256(join(
    TRANSCRIPT_DOMAIN,
    previous,
    u64(BigInt(seq)),
    Uint8Array.of(name.length),
    name,
    Uint8Array.of(seat ?? 255),
    sha256(payload),
  ));
}

export function pointHex(value: PointValue) {
  return value.x.slice(2).padStart(64, "0") + value.y.slice(2).padStart(64, "0");
}

export function keyPayload(key: PointValue, proof: ShareProof) {
  return join(
    bytes(pointHex(key)),
    bytes(pointHex(proof.a)),
    bytes(pointHex(proof.b)),
    bytes(proof.z.slice(2)),
  );
}

export function pointBytes(value: PointValue) {
  return bytes(pointHex(value));
}

export function cipherBytes(value: CipherValue) {
  return join(pointBytes(value.left), pointBytes(value.right));
}

export function pointFromHex(value: string): PointValue {
  if (!/^[0-9a-f]{128}$/.test(value)) throw new Error("invalid curve point");
  return { x: `0x${value.slice(0, 64)}`, y: `0x${value.slice(64)}` };
}

export function hex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function bytes(value: string) {
  if (!/^[0-9a-f]+$/.test(value) || value.length % 2 !== 0) throw new Error("invalid hex");
  return Uint8Array.from({ length: value.length / 2 }, (_, i) =>
    Number.parseInt(value.slice(i * 2, i * 2 + 2), 16),
  );
}

async function curve() {
  const [{ Grumpkin }, { Point, GrumpkinScalar }] = await Promise.all([
    import("@aztec/foundation/crypto/grumpkin"),
    import("@aztec/foundation/curves/grumpkin"),
  ]);

  return { Grumpkin, Point, Scalar: GrumpkinScalar };
}

function point(value: PointValue, api: Curve): Point {
  return api.Point.fromString(`${value.x.slice(2)}${value.y.slice(2)}`);
}

function cipher(value: CipherValue, api: Curve) {
  return { left: point(value.left, api), right: point(value.right, api) };
}

function pointValue(value: Point): PointValue {
  return { x: value.x.toString(), y: value.y.toString() };
}

function zeroPoint(): PointValue {
  return { x: `0x${"0".repeat(64)}`, y: `0x${"0".repeat(64)}` };
}

function scalar(value: string, ScalarType: Curve["Scalar"]): Scalar {
  const raw = BigInt(value);
  if (raw <= 0n || raw >= SCALAR_MODULUS) throw new Error("invalid scalar");
  return new ScalarType(raw);
}

function scalarValue(value: Scalar) {
  return `0x${value.toBigInt().toString(16).padStart(64, "0")}`;
}

function challenge(domain: Uint8Array, context: Uint8Array, points: Point[], ScalarType: Curve["Scalar"]) {
  const raw = sha256(join(domain, context, ...points.map((value) => value.toBuffer())));
  return new ScalarType(BigInt(`0x${hex(raw)}`) % SCALAR_MODULUS);
}

function randomIndex(upper: number) {
  const limit = Math.floor(2 ** 32 / upper) * upper;
  const value = new Uint32Array(1);

  do crypto.getRandomValues(value); while (value[0] >= limit);
  return value[0] % upper;
}

function uuid(value: string) {
  const raw = value.replaceAll("-", "");
  if (!/^[0-9a-f]{32}$/.test(raw)) throw new Error("invalid room id");
  return bytes(raw);
}

function u64(value: bigint) {
  const output = new Uint8Array(8);
  new DataView(output.buffer).setBigUint64(0, value);
  return output;
}

function join(...parts: readonly Uint8Array[]) {
  const output = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;

  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}
