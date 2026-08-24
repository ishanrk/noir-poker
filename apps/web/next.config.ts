import type { NextConfig } from "next";

const config: NextConfig = {
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
