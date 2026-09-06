import {
  encodeHex, participantRecord, sameConfig, type ParticipantRecord,
} from "./deal.ts";
import type { DealView } from "../components/deal-integrity.tsx";

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

function storage(): Storage {
  try {
    return localStorage;
  } catch {
    throw new Error("Participant storage unavailable — enable local storage before contributing");
  }
}

function key(room: string, hand: number, seat: number) {
  return `noir-poker-participant-${room}-${hand}-${seat}`;
}

export function loadParticipant(room: string, hand: number, seat: number, store = storage()) {
  let value: string | null;
  try {
    value = store.getItem(key(room, hand, seat));
  } catch {
    throw new Error("Cannot read participant evidence");
  }
  if (value === null) return undefined;
  const record = participantRecord(JSON.parse(value));
  if (record.room !== room || record.hand_no !== hand || record.seat !== seat) {
    throw new Error("Participant identity conflict");
  }
  return record;
}

function save(record: ParticipantRecord, store: Storage) {
  participantRecord(record);
  const text = JSON.stringify(record);
  try {
    store.setItem(key(record.room, record.hand_no, record.seat), text);
    if (store.getItem(key(record.room, record.hand_no, record.seat)) !== text) {
      throw new Error("write mismatch");
    }
  } catch {
    throw new Error("Cannot save participant evidence — contribution paused");
  }
  return record;
}

function matches(record: ParticipantRecord, deal: DealView) {
  if (record.hand_no !== deal.hand_no || record.protocol_version !== deal.protocol_version ||
    record.commitment !== deal.commitment || record.dealer !== deal.dealer ||
    !sameConfig(record.config, deal.config)) {
    throw new Error("Participant commitment or configuration conflict");
  }
}

export function pinDeal(room: string, seat: number, deal: DealView, store = storage()) {
  const existing = loadParticipant(room, deal.hand_no, seat, store);
  if (existing) {
    matches(existing, deal);
    return existing;
  }
  if (deal.state !== "collecting" || deal.mine) {
    throw new Error("Earlier participant evidence unavailable");
  }
  return save({
    version: 1, protocol_version: deal.protocol_version, room, hand_no: deal.hand_no,
    config: { ...deal.config }, dealer: deal.dealer, commitment: deal.commitment, seat,
    observed: { hole: [], board: [] },
  }, store);
}

export function contribution(room: string, seat: number, deal: DealView, store = storage()) {
  const record = pinDeal(room, seat, deal, store);
  if (record.contribution) return record.contribution;
  const share = encodeHex(crypto.getRandomValues(new Uint8Array(32)));
  save({ ...record, contribution: share }, store);
  return share;
}

export function observeDeal(
  room: string, seat: number, deal: DealView,
  hole: { value: string }[], board: { value: string }[], store = storage(),
) {
  const record = loadParticipant(room, deal.hand_no, seat, store);
  if (!record) return undefined;
  matches(record, deal);
  const observed = { hole: hole.map((card) => card.value), board: board.map((card) => card.value) };
  for (const field of ["hole", "board"] as const) {
    if (!record.observed[field].every((card, index) => card === observed[field][index])) {
      throw new Error("Participant observed cards conflict");
    }
  }
  if (!record.contribution) throw new Error("Participant contribution missing");
  return save({ ...record, observed }, store);
}
