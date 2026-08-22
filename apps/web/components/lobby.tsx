"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { type FormEvent, useMemo, useState } from "react";

import { AztecConnect } from "@/components/aztec-connect";
import { Keycap } from "@/components/keycap";
import { playErrorSound } from "@/components/ui-sounds";
import {
  AZTEC_BIG_BLIND,
  AZTEC_SMALL_BLIND,
  AZTEC_TABLE_STACK,
} from "@/lib/aztec/config";
import type { AztecSession } from "@/lib/aztec/session";
import { createRoom, joinRoom, saveSeat, type RoomMode } from "@/lib/server";

const STACKS = [100, 250, 500, 1000, 2000, 5000] as const;
const SMALL_BLINDS = [1, 2, 5, 10, 25, 50] as const;
const BIG_BLINDS = [2, 5, 10, 20, 50, 100] as const;
const HANDS = [1, 3, 5, 10, 20] as const;

function Scale({
  label,
  values,
  index,
  setIndex,
  card = false,
}: {
  label: string;
  values: readonly number[];
  index: number;
  setIndex: (index: number) => void;
  card?: boolean;
}) {
  return (
    <label className={`scale-control${card ? " hand-scale" : ""}`}>
      <span>
        <span className="scale-label">{label}</span>
        {card ? (
          <output className="hand-count">
            <i aria-hidden="true" />
            <i aria-hidden="true" />
            <span>
              <strong>{values[index]}</strong>
              <small>hands</small>
            </span>
          </output>
        ) : (
          <output>{values[index].toLocaleString("en-US")}</output>
        )}
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
  const [mode, setMode] = useState<RoomMode>("single");
  const [aztec, setAztec] = useState<AztecSession>();
  const [players, setPlayers] = useState(2);
  const [stackIndex, setStackIndex] = useState(3);
  const [smallIndex, setSmallIndex] = useState(2);
  const [bigIndex, setBigIndex] = useState(2);
  const [handsIndex, setHandsIndex] = useState(2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [shake, setShake] = useState(false);
  const [moved, setMoved] = useState(false);
  const normalStack = STACKS[stackIndex];
  const normalSmallBlind = SMALL_BLINDS[smallIndex];
  const normalBigBlind = BIG_BLINDS[bigIndex];
  const stack = mode === "aztec" ? AZTEC_TABLE_STACK : normalStack;
  const smallBlind = mode === "aztec" ? AZTEC_SMALL_BLIND : normalSmallBlind;
  const bigBlind = mode === "aztec" ? AZTEC_BIG_BLIND : normalBigBlind;
  const normalError = useMemo(
    () => normalBigBlind < normalSmallBlind
      ? "Big blind must be at least the small blind"
      : normalStack < normalBigBlind
        ? "Starting stack must cover the big blind"
        : undefined,
    [normalBigBlind, normalSmallBlind, normalStack],
  );
  const aztecValid = Boolean(
    aztec?.ready && aztec.balance >= BigInt(AZTEC_TABLE_STACK),
  );

  function showError(message: string) {
    setError(message);
    playErrorSound();
    setShake(true);
  }

  function select(next: RoomMode) {
    setMoved(true);
    setMode(next);
    setError(undefined);
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);

    try {
      if (mode !== "aztec" && normalError) throw new Error(normalError);
      if (mode === "aztec" && !aztecValid) {
        throw new Error("Connect Aztec and claim PLAY first");
      }

      const result = await createRoom({
        players,
        stack,
        small_blind: smallBlind,
        big_blind: bigBlind,
        hands: HANDS[handsIndex],
        mode,
      });

      if (mode === "aztec" && aztec) {
        await enterAztec(aztec, result.room_id, result.seat, AZTEC_TABLE_STACK);
      }

      saveSeat(result.room, result);
      router.push(`/table/${result.room}${mode === "aztec" ? "?mode=aztec" : ""}`);
    } catch (cause) {
      showError(cause instanceof Error ? cause.message : "server unavailable");
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
        await enterAztec(aztec, result.room_id, result.seat, AZTEC_TABLE_STACK);
      }

      saveSeat(result.room, result);
      router.push(`/table/${result.room}${mode === "aztec" ? "?mode=aztec" : ""}`);
    } catch (cause) {
      showError(cause instanceof Error ? cause.message : "server unavailable");
      setBusy(false);
    }
  }

  return (
    <section
      className={`lobby-panel${shake ? " ui-shake" : ""}`}
      data-mode-motion={moved || undefined}
      onAnimationEnd={(event) => {
        if (event.currentTarget === event.target) setShake(false);
      }}
    >
      <fieldset className="mode-switch">
        <legend>Mode</legend>
        <div>
          <label>
            <input
              type="radio"
              name="mode"
              value="single"
              checked={mode === "single"}
              onChange={() => select("single")}
            />
            <span>
              <strong>Single Player</strong>
              <small>You + bots</small>
            </span>
          </label>
          <label>
            <input
              type="radio"
              name="mode"
              value="multiplayer"
              checked={mode === "multiplayer"}
              onChange={() => select("multiplayer")}
            />
            <span>
              <strong>Multiplayer</strong>
              <small>2–6 players</small>
            </span>
          </label>
          <label>
            <input
              type="radio"
              name="mode"
              value="aztec"
              checked={mode === "aztec"}
              onChange={() => select("aztec")}
            />
            <span>
              <strong>Aztec Poker</strong>
              <small>Private play</small>
            </span>
          </label>
        </div>
      </fieldset>

      {mode === "aztec" && <AztecConnect compact onSession={setAztec} />}

      <div className={`lobby lobby-${mode}`}>
        <form className="lobby-create" onSubmit={create}>
          <div className="form-heading form-heading-new">
            <h3>
              New Game{" "}
              <span>
                — {mode === "single" ? "Single Player" : mode === "multiplayer" ? "Multiplayer" : "Aztec Poker"}
              </span>
            </h3>
            <span className="lobby-computer" aria-hidden="true">
              <Image
                src="/images/comp-transparent.png"
                alt=""
                width={240}
                height={160}
              />
            </span>
          </div>

          <fieldset className="seat-scale">
            <legend>{mode === "single" ? "Total Seats" : "Seats"}</legend>
            <div>
              {[2, 3, 4, 5, 6].map((count) => (
                <label className="key-choice" key={count}>
                  <input
                    type="radio"
                    name="players"
                    value={count}
                    checked={players === count}
                    onChange={() => setPlayers(count)}
                  />
                  <Keycap>{count}</Keycap>
                </label>
              ))}
            </div>
          </fieldset>
          {mode === "single" && <p className="seat-help">One human plus {players - 1} bots.</p>}

          <Scale
            label="Total Number of Hands"
            values={HANDS}
            index={handsIndex}
            setIndex={setHandsIndex}
            card
          />

          {mode !== "aztec" ? (
            <>
              <Scale
                label="Starting Stack"
                values={STACKS}
                index={stackIndex}
                setIndex={setStackIndex}
              />
              <div className="blind-scales">
                <Scale
                  label="Small Blind"
                  values={SMALL_BLINDS}
                  index={smallIndex}
                  setIndex={setSmallIndex}
                />
                <Scale
                  label="Big Blind"
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

          <button className="primary-action key-action key-primary key-create" type="submit" disabled={busy}>
            <Keycap>
              {busy
                ? "Working"
                : mode === "aztec"
                  ? "Create Aztec Game"
                  : "Create Game"}
            </Keycap>
          </button>
        </form>

        {mode !== "single" && <form className="lobby-join" onSubmit={join}>
          <div className="form-heading">
            <h3>Join Game</h3>
          </div>
          <label className="line-input">
            Room ID
            <input name="room" type="text" autoComplete="off" spellCheck="false" required />
          </label>
          <button className="text-action key-action key-join" type="submit" disabled={busy}>
            <Keycap>{busy ? "Working" : mode === "aztec" ? "Join with PLAY" : "Join Game"}</Keycap>
          </button>
          <p>
            {mode === "aztec"
              ? `${AZTEC_TABLE_STACK.toLocaleString()} private PLAY is locked before the table opens.`
              : "Your browser adds fresh randomness before the hand starts."}
          </p>
        </form>}

        {error && (
          <p className="lobby-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}

async function enterAztec(
  session: AztecSession,
  room: string,
  seat: number,
  amount: number,
) {
  const { enterAztecRoom } = await import("@/lib/aztec/entry");

  return enterAztecRoom(session, room, seat, amount);
}
