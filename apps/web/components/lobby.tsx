"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useMemo, useState } from "react";

import { createRoom, joinRoom, saveSeat } from "@/lib/server";

const STACKS = [100, 250, 500, 1000, 2000, 5000] as const;
const SMALL_BLINDS = [1, 2, 5, 10, 25, 50] as const;
const BIG_BLINDS = [2, 5, 10, 20, 50, 100] as const;

function Scale({
  label,
  values,
  index,
  setIndex,
}: {
  label: string;
  values: readonly number[];
  index: number;
  setIndex: (index: number) => void;
}) {
  return (
    <label className="scale-control">
      <span>
        {label}
        <output>{values[index].toLocaleString("en-US")}</output>
      </span>
      <input
        type="range"
        min="0"
        max={values.length - 1}
        value={index}
        onChange={(event) => setIndex(Number(event.target.value))}
      />
      <span className="scale-ticks" aria-hidden="true">
        {values.map((value) => (
          <i key={value}>{value >= 1000 ? `${value / 1000}k` : value}</i>
        ))}
      </span>
    </label>
  );
}

export function Lobby() {
  const router = useRouter();
  const [players, setPlayers] = useState(2);
  const [stackIndex, setStackIndex] = useState(3);
  const [smallIndex, setSmallIndex] = useState(2);
  const [bigIndex, setBigIndex] = useState(2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const stack = STACKS[stackIndex];
  const smallBlind = SMALL_BLINDS[smallIndex];
  const bigBlind = BIG_BLINDS[bigIndex];
  const valid = useMemo(
    () => bigBlind >= smallBlind && stack >= bigBlind,
    [bigBlind, smallBlind, stack],
  );

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);

    try {
      const result = await createRoom({
        players,
        stack,
        small_blind: smallBlind,
        big_blind: bigBlind,
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

    const room = String(new FormData(event.currentTarget).get("room")).trim();

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
    <div className="lobby">
      <form className="lobby-create" onSubmit={create}>
        <div className="form-heading">
          <span>Create</span>
          <h3>New table</h3>
        </div>

        <fieldset className="seat-scale">
          <legend>Seats</legend>
          <div>
            {[2, 3, 4, 5, 6].map((count) => (
              <label key={count}>
                <input
                  type="radio"
                  name="players"
                  value={count}
                  checked={players === count}
                  onChange={() => setPlayers(count)}
                />
                <span>{count}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <Scale label="Starting stack" values={STACKS} index={stackIndex} setIndex={setStackIndex} />
        <div className="blind-scales">
          <Scale
            label="Small blind"
            values={SMALL_BLINDS}
            index={smallIndex}
            setIndex={setSmallIndex}
          />
          <Scale
            label="Big blind"
            values={BIG_BLINDS}
            index={bigIndex}
            setIndex={setBigIndex}
          />
        </div>

        {!valid && <p className="form-error">Big blind must cover the small blind and stack.</p>}
        <button className="primary-action" type="submit" disabled={busy || !valid}>
          Create fair table <span>→</span>
        </button>
      </form>

      <form className="lobby-join" onSubmit={join}>
        <div className="form-heading">
          <span>Join</span>
          <h3>Existing table</h3>
        </div>
        <label className="line-input">
          Room id
          <input name="room" type="text" autoComplete="off" spellCheck="false" required />
        </label>
        <button className="text-action" type="submit" disabled={busy}>
          Take a seat →
        </button>
        <p>
          Your browser contributes 256 fresh random bits when you enter. The contribution
          becomes public only after the hand is over.
        </p>
      </form>

      {error && <p className="lobby-error">{error}</p>}
    </div>
  );
}
