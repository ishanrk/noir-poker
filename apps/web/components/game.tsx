"use client";

import { useEffect, useRef, useState } from "react";

import { Table, type View } from "@/components/table";
import type { Game as WasmGame } from "@/wasm/game_wasm";

const SEED = new Uint8Array(32).fill(0x42);
const STACKS = new Uint32Array(6).fill(1000);

export function Game() {
  const game = useRef<WasmGame | null>(null);
  const hand = useRef(1);
  const [view, setView] = useState<View>();
  const [error, setError] = useState<string>();
  const [raiseTo, setRaiseTo] = useState(0);

  useEffect(() => {
    let live = true;
    let current: WasmGame | null = null;

    async function load() {
      try {
        const wasm = await import("@/wasm/game_wasm");
        await wasm.default();

        current = new wasm.Game(SEED, 0, STACKS, 5, 10, 0);
        const next = current.view() as View;

        if (!live) {
          current.free();
          current = null;
          return;
        }

        game.current = current;
        setView(next);
        setRaiseTo(next.actions?.raise?.min_to ?? 0);
      } catch {
        current?.free();
        current = null;

        if (live) {
          setError("Unable to load table");
        }
      }
    }

    void load();

    return () => {
      live = false;
      current?.free();
      current = null;
      game.current = null;
    };
  }, []);

  function act(run: (game: WasmGame) => unknown) {
    const current = game.current;

    if (!current) {
      return false;
    }

    try {
      const next = run(current) as View;

      setView(next);
      setRaiseTo(next.actions?.raise?.min_to ?? 0);
      setError(undefined);
      return true;
    } catch {
      setError("Action failed");
      return false;
    }
  }

  function nextHand() {
    const seed = SEED.slice();

    seed[0] = hand.current;

    if (act((current) => current.next_hand(seed))) {
      hand.current += 1;
    }
  }

  if (!view && error) {
    return <p className="table-status table-error">{error}</p>;
  }

  if (!view) {
    return <p className="table-status">Loading table...</p>;
  }

  return (
    <Table
      view={view}
      error={error}
      raiseTo={raiseTo}
      setRaiseTo={setRaiseTo}
      onFold={() => act((current) => current.fold())}
      onCheck={() => act((current) => current.check())}
      onCall={() => act((current) => current.call())}
      onRaise={() => act((current) => current.raise_to(raiseTo))}
      onNewHand={nextHand}
    />
  );
}
