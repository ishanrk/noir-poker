"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { createRoom, joinRoom, saveSeat } from "@/lib/server";

export function Lobby() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);

    const data = new FormData(event.currentTarget);

    try {
      const result = await createRoom({
        players: Number(data.get("players")),
        stack: Number(data.get("stack")),
        small_blind: Number(data.get("small_blind")),
        big_blind: Number(data.get("big_blind")),
      });

      saveSeat(result.room, result);
      router.push(`/table/${result.room}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "server unavailable");
      setBusy(false);
    }
  }

  async function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);

    const data = new FormData(event.currentTarget);
    const room = String(data.get("room")).trim();

    try {
      const result = await joinRoom(room);

      saveSeat(result.room, result);
      router.push(`/table/${result.room}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "server unavailable");
      setBusy(false);
    }
  }

  return (
    <section className="lobby" aria-label="Poker lobby">
      <form className="lobby-panel" onSubmit={create}>
        <div className="lobby-copy">
          <span>Create</span>
          <h2>New table</h2>
        </div>

        <label>
          Players
          <input name="players" type="number" min="2" max="6" defaultValue="2" required />
        </label>
        <label>
          Stack
          <input name="stack" type="number" min="1" defaultValue="1000" required />
        </label>
        <div className="lobby-row">
          <label>
            Small blind
            <input name="small_blind" type="number" min="1" defaultValue="5" required />
          </label>
          <label>
            Big blind
            <input name="big_blind" type="number" min="1" defaultValue="10" required />
          </label>
        </div>
        <button type="submit" disabled={busy}>
          Create table
        </button>
      </form>

      <form className="lobby-panel" onSubmit={join}>
        <div className="lobby-copy">
          <span>Join</span>
          <h2>Existing table</h2>
        </div>

        <label>
          Room id
          <input name="room" type="text" autoComplete="off" required />
        </label>
        <button type="submit" disabled={busy}>
          Join table
        </button>
      </form>

      {error && <p className="lobby-error">{error}</p>}

      <p className="demo-link">
        <Link href="/demo">Open local demo</Link>
      </p>
    </section>
  );
}
