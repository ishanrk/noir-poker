"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useMemo, useState } from "react";

import { AztecConnect } from "@/components/aztec-connect";
import {
  AZTEC_BIG_BLIND,
  AZTEC_SMALL_BLIND,
  AZTEC_TABLE_STACK,
} from "@/lib/aztec/config";
import { enterAztecRoom } from "@/lib/aztec/entry";
import type { AztecSession } from "@/lib/aztec/session";
import { createRoom, joinRoom, saveSeat } from "@/lib/server";

const STACKS = [100, 250, 500, 1000, 2000, 5000] as const;
const SMALL_BLINDS = [1, 2, 5, 10, 25, 50] as const;
const BIG_BLINDS = [2, 5, 10, 20, 50, 100] as const;

type PlayMode = "normal" | "aztec";

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
  const [mode, setMode] = useState<PlayMode>("normal");
  const [aztec, setAztec] = useState<AztecSession>();
  const [players, setPlayers] = useState(2);
  const [stackIndex, setStackIndex] = useState(3);
  const [smallIndex, setSmallIndex] = useState(2);
  const [bigIndex, setBigIndex] = useState(2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const normalStack = STACKS[stackIndex];
  const normalSmallBlind = SMALL_BLINDS[smallIndex];
  const normalBigBlind = BIG_BLINDS[bigIndex];
  const stack = mode === "aztec" ? AZTEC_TABLE_STACK : normalStack;
  const smallBlind = mode === "aztec" ? AZTEC_SMALL_BLIND : normalSmallBlind;
  const bigBlind = mode === "aztec" ? AZTEC_BIG_BLIND : normalBigBlind;
  const normalValid = useMemo(
    () => normalBigBlind >= normalSmallBlind && normalStack >= normalBigBlind,
    [normalBigBlind, normalSmallBlind, normalStack],
  );
  const aztecValid = Boolean(
    aztec?.ready && aztec.balance >= BigInt(AZTEC_TABLE_STACK),
  );
  const valid = mode === "normal" ? normalValid : aztecValid;

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);

    try {
      if (mode === "aztec" && !aztecValid) {
        throw new Error("Connect Aztec and claim PLAY first");
      }

      const result = await createRoom({
        players,
        stack,
        small_blind: smallBlind,
        big_blind: bigBlind,
      });

      if (mode === "aztec" && aztec) {
        await enterAztecRoom(aztec, result.room, result.seat, AZTEC_TABLE_STACK);
      }

      saveSeat(result.room, result);
      router.push(`/table/${result.room}${mode === "aztec" ? "?mode=aztec" : ""}`);
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
      if (mode === "aztec" && !aztecValid) {
        throw new Error("Connect Aztec and claim PLAY first");
      }

      const result = await joinRoom(room);

      if (mode === "aztec" && aztec) {
        await enterAztecRoom(aztec, result.room, result.seat, AZTEC_TABLE_STACK);
      }

      saveSeat(result.room, result);
      router.push(`/table/${result.room}${mode === "aztec" ? "?mode=aztec" : ""}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "server unavailable");
      setBusy(false);
    }
  }

  return (
    <>
      <fieldset className="mode-switch">
        <legend>Mode</legend>
        <div>
          <label>
            <input
              type="radio"
              name="mode"
              value="normal"
              checked={mode === "normal"}
              onChange={() => {
                setMode("normal");
                setError(undefined);
              }}
            />
            <span>
              <strong>Normal</strong>
              <small>No wallet</small>
            </span>
          </label>
          <label>
            <input
              type="radio"
              name="mode"
              value="aztec"
              checked={mode === "aztec"}
              onChange={() => {
                setMode("aztec");
                setError(undefined);
              }}
            />
            <span>
              <strong>Aztec</strong>
              <small>Private PLAY</small>
            </span>
          </label>
        </div>
      </fieldset>

      {mode === "aztec" && <AztecConnect compact onSession={setAztec} />}

      <div className="lobby">
        <form className="lobby-create" onSubmit={create}>
          <div className="form-heading">
            <h3>New game</h3>
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

          {mode === "normal" ? (
            <>
              <Scale
                label="Starting stack"
                values={STACKS}
                index={stackIndex}
                setIndex={setStackIndex}
              />
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
            </>
          ) : (
            <dl className="aztec-stakes">
              <div>
                <dt>Buy-in</dt>
                <dd>{AZTEC_TABLE_STACK.toLocaleString()} PLAY</dd>
              </div>
              <div>
                <dt>Blinds</dt>
                <dd>{AZTEC_SMALL_BLIND} / {AZTEC_BIG_BLIND}</dd>
              </div>
            </dl>
          )}

          {mode === "normal" && !normalValid && (
            <p className="form-error">Big blind must cover the small blind and stack.</p>
          )}
          <button className="primary-action" type="submit" disabled={busy || !valid}>
            {busy ? "Working" : mode === "aztec" ? "Create Aztec game" : "Create game"}
            {!busy && <span>→</span>}
          </button>
        </form>

        <form className="lobby-join" onSubmit={join}>
          <div className="form-heading">
            <h3>Join game</h3>
          </div>
          <label className="line-input">
            Room id
            <input name="room" type="text" autoComplete="off" spellCheck="false" required />
          </label>
          <button className="text-action" type="submit" disabled={busy || !valid}>
            {busy ? "Working" : mode === "aztec" ? "Join with PLAY →" : "Join game →"}
          </button>
          <p>
            {mode === "aztec"
              ? `${AZTEC_TABLE_STACK.toLocaleString()} private PLAY is locked before the table opens.`
              : "Your browser adds fresh randomness before the hand starts."}
          </p>
        </form>

        {error && (
          <p className="lobby-error" aria-live="polite">
            {error}
          </p>
        )}
      </div>
    </>
  );
}
