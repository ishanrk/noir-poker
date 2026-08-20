"use client";

import dynamic from "next/dynamic";

import type { AztecSession } from "@/lib/aztec/session";

export type AztecConnectProps = {
  compact?: boolean;
  onSession?: (session: AztecSession | undefined) => void;
};

const AztecConnectClient = dynamic(
  async () => {
    // load browser globals before wallet code
    await import("@/lib/aztec/polyfills");
    const client = await import("@/components/aztec-connect-client");

    return client.AztecConnect;
  },
  {
    ssr: false,
    loading: () => (
      <section className="aztec-connect aztec-connect-compact">
        <div className="aztec-connect-label">
          <span>Aztec</span>
          <small>Loading wallet support</small>
        </div>
      </section>
    ),
  },
);

export function AztecConnect(props: AztecConnectProps) {
  return <AztecConnectClient {...props} />;
}
