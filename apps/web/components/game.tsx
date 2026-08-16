"use client";

import { useEffect, useState } from "react";

import { Table, type View } from "@/components/table";

const SEED = new Uint8Array(32).fill(0x42);
const STACKS = new Uint32Array(6).fill(1000);

export function Game() {
  const [view, setView] = useState<View>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;

    async function load() {
      try {
        const wasm = await import("@/wasm/game_wasm");
        await wasm.default();

        const game = new wasm.Game(SEED, 0, STACKS, 5, 10, 0);

        try {
          const next = game.view() as View;

          if (live) {
            setView(next);
          }
        } finally {
          game.free();
        }
      } catch {
        if (live) {
          setFailed(true);
        }
      }
    }

    void load();

    return () => {
      live = false;
    };
  }, []);

  if (failed) {
    return <p className="table-status table-error">Unable to load table</p>;
  }

  if (!view) {
    return <p className="table-status">Loading table...</p>;
  }

  return <Table view={view} />;
}
