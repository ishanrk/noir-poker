"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { AztecConnect } from "@/components/aztec-connect";
import { Keycap } from "@/components/keycap";
import { playErrorSound, playPickupSound } from "@/components/ui-sounds";
import { timing } from "@/lib/diagnostics";
import {
  AZTEC_BIG_BLIND,
  AZTEC_SMALL_BLIND,
  AZTEC_TABLE_STACK,
} from "@/lib/aztec/config";
import type { AztecEntryIntent } from "@/lib/aztec/entry";
import type { AztecSession } from "@/lib/aztec/session";
import {
  createRoom,
  joinRoom,
  reserveAztecJoin,
  reserveAztecRoom,
  saveSeat,
  type AztecReservation,
  type RoomMode,
} from "@/lib/server";

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
  const wasAztec = useRef(false);
  const [mode, setMode] = useState<RoomMode>("single");
  const [aztec, setAztec] = useState<AztecSession>();
  const [players, setPlayers] = useState(2);
  const [stackIndex, setStackIndex] = useState(3);
  const [smallIndex, setSmallIndex] = useState(2);
  const [bigIndex, setBigIndex] = useState(2);
  const [handsIndex, setHandsIndex] = useState(2);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [aztecStep, setAztecStep] = useState<string>();
  const busyRef = useRef(false);
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
  const aztecValid = Boolean(aztec?.claimed);

  useEffect(() => {
    const root = document.documentElement;
    let timer: number | undefined;

    root.dataset.noirMode = mode;

    if (mode === "aztec" && !wasAztec.current) {
      root.classList.add("aztec-entering");
      timer = window.setTimeout(() => root.classList.remove("aztec-entering"), 320);
    } else {
      root.classList.remove("aztec-entering");
    }

    wasAztec.current = mode === "aztec";

    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      root.classList.remove("aztec-entering");
      if (root.dataset.noirMode === mode) delete root.dataset.noirMode;
    };
  }, [mode]);

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
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(undefined);

    try {
      if (mode !== "aztec" && normalError) throw new Error(normalError);
      if (mode === "aztec" && !aztecValid) {
        throw new Error("Connect Aztec and claim Tajaderos first");
      }

      playPickupSound();
      timing('room-request');
      const result = mode === "aztec" && aztec
          ? (await enterAztec(
            aztec,
            {
              kind: "create",
              players,
              hands: HANDS[handsIndex],
              name: name.trim(),
            },
            () => reserveAztecRoom({
                players,
                hands: HANDS[handsIndex],
                name: name.trim() || undefined,
                account: aztec.connection.account.item.toString(),
              }),
            setAztecStep,
          )).seat
        : await createRoom({
            players,
            stack,
            small_blind: smallBlind,
            big_blind: bigBlind,
            hands: HANDS[handsIndex],
            mode,
            name: mode === "multiplayer" ? name.trim() || undefined : undefined,
          });

      saveSeat(result.room, result);
      timing('room-ready');
      router.push(`/table/${result.room}${mode === "aztec" ? "?mode=aztec" : ""}`);
    } catch (cause) {
      showError(cause instanceof Error ? cause.message : "server unavailable");
      busyRef.current = false;
      setBusy(false);
      setAztecStep(undefined);
    }
  }

  async function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(undefined);

    const room = String(new FormData(event.currentTarget).get("room")).trim();

    try {
      if (!room) throw new Error("Enter a room code");
      if (mode === "aztec" && !aztecValid) {
        throw new Error("Connect Aztec and claim Tajaderos first");
      }

      playPickupSound();
      const result = mode === "aztec" && aztec
          ? (await enterAztec(
            aztec,
            { kind: "join", room, name: name.trim() },
            () => reserveAztecJoin(room, {
                name: name.trim() || undefined,
                account: aztec.connection.account.item.toString(),
              }),
            setAztecStep,
          )).seat
        : await joinRoom(room, name.trim() || undefined);

      saveSeat(result.room, result);
      router.push(`/table/${result.room}${mode === "aztec" ? "?mode=aztec" : ""}`);
    } catch (cause) {
      showError(cause instanceof Error ? cause.message : "server unavailable");
      busyRef.current = false;
      setBusy(false);
      setAztecStep(undefined);
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
              <small>2 to 6 players</small>
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
              <small>Private Tajaderos</small>
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
                {mode === "single" ? "Single player" : mode === "multiplayer" ? "Multiplayer" : "Aztec Poker"}
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

          {mode !== "single" && (
            <label className="line-input lobby-name">
              Player Name
              <input
                name="name"
                type="text"
                value={name}
                maxLength={20}
                autoComplete="nickname"
                spellCheck="false"
                placeholder="Player 1"
                onChange={(event) => setName(event.target.value)}
              />
            </label>
          )}

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
          {mode === "single" && <p className="seat-help">One human plus {players - 1} {players === 2 ? "bot" : "bots"}.</p>}

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
                <dt>Tajadero buy-in</dt>
                <dd>{AZTEC_TABLE_STACK.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Blinds</dt>
                <dd>{AZTEC_SMALL_BLIND} small blind · {AZTEC_BIG_BLIND} big blind</dd>
              </div>
              <div>
                <dt>Balance</dt>
                <dd>{aztec?.balance.toLocaleString() ?? "Connect wallet"}</dd>
              </div>
            </dl>
          )}

          <button className="primary-action key-action key-primary key-create" type="submit" disabled={busy}>
            <Keycap>
              {busy
                ? mode === "aztec" ? aztecStep ?? "Reserving Entry" : "Working"
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
            Player Name
            <input
              name="player_name"
              type="text"
              value={name}
              maxLength={20}
              autoComplete="nickname"
              spellCheck="false"
              placeholder="Player 2"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="line-input">
            Room ID
            <input name="room" type="text" autoComplete="off" spellCheck="false" required />
          </label>
          <button className="text-action key-action key-join" type="submit" disabled={busy}>
            <Keycap>{busy ? mode === "aztec" ? aztecStep ?? "Reserving Entry" : "Working" : mode === "aztec" ? "Join Aztec Game" : "Join Game"}</Keycap>
          </button>
          <p>
            {mode === "aztec"
              ? `${AZTEC_TABLE_STACK.toLocaleString()} Tajaderos lock before the table opens.`
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
  intent: AztecEntryIntent,
  reserve: () => Promise<AztecReservation>,
  setState: (state: string) => void,
) {
  const { enterAztecRoom, pendingAztecEntry } = await import("@/lib/aztec/entry");
  const pending = pendingAztecEntry(session, intent);
  if (!pending && session.balance < BigInt(AZTEC_TABLE_STACK)) {
    throw new Error("Not enough Tajaderos");
  }
  const reservation = pending ?? await reserve();

  return enterAztecRoom(session, reservation, intent, (state) => {
    setState({
      authorizing: "Authorizing Entry",
      locking: "Locking Tajaderos",
      checking: "Checking Entry",
    }[state]);
  });
}
