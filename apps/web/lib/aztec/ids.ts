import { sha256 } from "@noble/hashes/sha2.js";

const TABLE_DOMAIN = new TextEncoder().encode("NOIR_POKER_TABLE_V1");
const ENTRY_DOMAIN = new TextEncoder().encode("NOIR_POKER_ENTRY_V1");

export function tableIdForRoom(room: string) {
  return digestField(join(TABLE_DOMAIN, uuidBytes(room)));
}

export function entryIdForSeat(tableId: bigint, seat: number, nonce: Uint8Array) {
  if (tableId < 0n || tableId >= 1n << 248n) {
    throw new Error("invalid table id");
  }
  if (!Number.isInteger(seat) || seat < 0 || seat > 5) {
    throw new Error("invalid seat");
  }
  if (nonce.length !== 32) {
    throw new Error("invalid entry nonce");
  }

  return digestField(join(ENTRY_DOMAIN, bigintBytes(tableId), Uint8Array.of(seat), nonce));
}

export function newEntryNonce() {
  return crypto.getRandomValues(new Uint8Array(32));
}

export function fieldHex(value: bigint) {
  if (value < 0n || value >= 1n << 248n) {
    throw new Error("invalid field id");
  }

  return `0x${value.toString(16).padStart(62, "0")}`;
}

export function nonceHex(value: Uint8Array) {
  if (value.length !== 32) {
    throw new Error("invalid entry nonce");
  }

  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function nonceFromHex(value: string) {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new Error("invalid entry nonce");
  }

  return Uint8Array.from({ length: 32 }, (_, index) =>
    Number.parseInt(value.slice(index * 2, index * 2 + 2), 16),
  );
}

function digestField(value: Uint8Array) {
  return bytesBigint(sha256(value).slice(0, 31));
}

function uuidBytes(value: string) {
  const hex = value.replaceAll("-", "").toLowerCase();

  if (!/^[0-9a-f]{32}$/.test(hex)) {
    throw new Error("invalid room id");
  }

  return Uint8Array.from({ length: 16 }, (_, index) =>
    Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16),
  );
}

function bigintBytes(value: bigint) {
  const bytes = new Uint8Array(32);
  let remaining = value;

  for (let index = bytes.length - 1; index >= 0; index -= 1) {
    bytes[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }

  return bytes;
}

function bytesBigint(value: Uint8Array) {
  let result = 0n;

  for (const byte of value) {
    result = (result << 8n) | BigInt(byte);
  }

  return result;
}

function join(...parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;

  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }

  return result;
}
