"use client";

import { useEffect } from "react";

import { AztecConnect } from "@/components/aztec-connect";
import { AZTEC_TESTNET_NODE_URL } from "@/lib/aztec/config";

export function AztecPlayChips() {
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.noirMode = "aztec";

    return () => {
      if (root.dataset.noirMode === "aztec") delete root.dataset.noirMode;
    };
  }, []);

  return (
    <section className="chips-console">
      <header className="chips-intro">
        <p className="eyebrow">Tajaderos</p>
        <h1>Private test credits on Aztec</h1>
        <p>Connect a testnet wallet then claim Tajaderos for Aztec Poker.</p>
      </header>

      <AztecConnect />

      <details className="chips-network">
        <summary>Technical details</summary>
        <span>Aztec 5.2.0 testnet</span>
        <code>{AZTEC_TESTNET_NODE_URL}</code>
      </details>
    </section>
  );
}
