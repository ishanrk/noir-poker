import { Buffer } from "buffer";
import process from "process";

type BrowserGlobals = typeof globalThis & {
  Buffer?: typeof Buffer;
  process?: typeof process;
  global?: typeof globalThis;
};

const root = globalThis as BrowserGlobals;

Object.defineProperty(root, "Buffer", {
  configurable: true,
  get: () => Buffer,
  set: () => undefined,
});

if (!("writeBigUInt64BE" in Uint8Array.prototype)) {
  Object.defineProperty(Uint8Array.prototype, "writeBigUInt64BE", {
    configurable: true,
    value(this: Uint8Array, value: bigint, offset = 0) {
      new DataView(this.buffer, this.byteOffset, this.byteLength).setBigUint64(
        offset,
        value,
        false,
      );
      return offset + 8;
    },
  });
}

root.process = process;
root.global = globalThis;
