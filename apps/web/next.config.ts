import type { NextConfig } from "next";
import { execFileSync } from "node:child_process";
function git(args: string[]) { try { return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return undefined; } }
const source = process.env.NOIR_SOURCE_COMMIT ?? git(["rev-parse", "HEAD"]) ?? "unknown";
const status = git(["status", "--porcelain"]);
const dirty = process.env.NOIR_SOURCE_DIRTY ?? (status === undefined ? "unknown" : String(Boolean(status)));

const config: NextConfig = {
  env: {
    NOIR_BUILD_SOURCE: /^[a-f0-9]{40}$/i.test(source) ? source : "unknown",
    NOIR_BUILD_DIRTY: ["true", "false"].includes(dirty) ? dirty : "unknown",
  },
  agentRules: false,
  turbopack: {
    resolveAlias: {
      buffer: "buffer/index.js",
      "next/dist/compiled/buffer": "buffer/index.js",
    },
  },
  experimental: {
    useTypeScriptCli: false,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default config;
