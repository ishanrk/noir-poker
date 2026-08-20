import { Buffer } from "buffer";
import process from "process";

type BrowserGlobals = typeof globalThis & {
  Buffer?: typeof Buffer;
  process?: typeof process;
  global?: typeof globalThis;
};

const root = globalThis as BrowserGlobals;

root.Buffer ??= Buffer;
root.process ??= process;
root.global ??= globalThis;
