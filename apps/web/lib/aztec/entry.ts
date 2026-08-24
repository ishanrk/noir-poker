import {
  authorizeAztec,
  confirmAztec,
  type AztecReservation,
} from "../server";
import { enterPlayChipTable, playChipEntry } from "./play-chips";
import type { AztecSession } from "./session";

export type AztecEntryReceipt = {
  room: string;
  seat: number;
  amount: string;
  tableId: string;
  entryId: string;
  txHash?: string;
};

type PendingEntry = {
  reservation: AztecReservation;
  txHash?: string;
  intent?: AztecEntryIntent;
};

export type AztecEntryIntent =
  | { kind: "create"; players: number; hands: number; name: string }
  | { kind: "join"; room: string; name: string };

export async function enterAztecRoom(
  session: AztecSession,
  reserved: AztecReservation,
  intent: AztecEntryIntent,
  onState?: (state: "authorizing" | "locking" | "checking") => void,
) {
  if (!session.claimed) {
    throw new Error("Aztec wallet is not ready");
  }

  const pending = loadPending(session, intent);
  const pendingTx = pending?.reservation.entry_id === reserved.entry_id
    ? pending.txHash
    : undefined;
  savePending(session, { reservation: reserved, txHash: pendingTx, intent });
  onState?.("authorizing");
  let entry: AztecReservation;
  try {
    entry = await authorizeAztec(reserved);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "";
    if (message === "entry unavailable" || message === "invalid entry token") {
      sessionStorage.removeItem(pendingKey(session.connection.account.item.toString()));
      throw new Error("Entry expired  Try again");
    }
    throw cause;
  }
  const tableId = field(entry.table_id);
  const entryId = field(entry.entry_id);
  const account = session.connection.account.item;
  let txHash = pendingTx;
  let recorded = await playChipEntry(session.contract, account, entryId);

  if (!recorded.exists) {
    if (session.balance < BigInt(entry.amount)) {
      throw new Error("Not enough Tajaderos");
    }
    onState?.("locking");
    const transaction = await enterPlayChipTable(
      session.contract,
      account,
      tableId,
      entryId,
      entry.seat,
      BigInt(entry.amount),
    );
    txHash = transaction.receipt.txHash.toString();
    savePending(session, { reservation: entry, txHash, intent });
    recorded = await playChipEntry(session.contract, account, entryId);
  }

  onState?.("checking");

  if (
    !recorded.exists ||
    recorded.tableId !== tableId ||
    recorded.account.toLowerCase() !== account.toString().toLowerCase() ||
    recorded.seat !== entry.seat ||
    recorded.amount !== BigInt(entry.amount)
  ) {
    throw new Error("Entry does not match this seat");
  }

  const seat = await confirmAztec(entry);
  const receipt: AztecEntryReceipt = {
    room: seat.room,
    seat: seat.seat,
    amount: String(entry.amount),
    tableId: entry.table_id,
    entryId: entry.entry_id,
    txHash,
  };

  sessionStorage.setItem(entryKey(seat.room), JSON.stringify(receipt));
  sessionStorage.removeItem(pendingKey(account.toString()));
  await session.refresh().catch(() => undefined);
  return { receipt, seat };
}

export function pendingAztecEntry(session: AztecSession, intent: AztecEntryIntent) {
  const pending = loadPending(session);
  if (!pending) return undefined;
  if (!matchesIntent(pending, intent)) {
    throw new Error(`Pending Aztec entry for room ${pending.reservation.room}`);
  }
  return pending.reservation;
}

export function loadAztecEntry(room: string) {
  const stored = sessionStorage.getItem(entryKey(room));

  if (!stored) {
    return undefined;
  }

  try {
    const receipt = JSON.parse(stored) as Partial<AztecEntryReceipt>;

    if (
      receipt.room === room &&
      typeof receipt.seat === "number" &&
      typeof receipt.amount === "string" &&
      typeof receipt.tableId === "string" &&
      typeof receipt.entryId === "string" &&
      (receipt.txHash === undefined || typeof receipt.txHash === "string")
    ) {
      return receipt as AztecEntryReceipt;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function loadPending(session: AztecSession, intent?: AztecEntryIntent) {
  const account = session.connection.account.item.toString();
  const stored = sessionStorage.getItem(pendingKey(account));

  if (!stored) return undefined;

  try {
    const pending = JSON.parse(stored) as PendingEntry;
    const entry = pending.reservation;
    if (
      typeof entry?.room === "string" &&
      typeof entry.room_id === "string" &&
      Number.isInteger(entry.seat) &&
      typeof entry.admission === "string" &&
      typeof entry.token === "string" &&
      typeof entry.table_id === "string" &&
      typeof entry.entry_id === "string" &&
      Number.isInteger(entry.amount) &&
      typeof entry.authorized === "boolean" &&
      (pending.txHash === undefined || typeof pending.txHash === "string")
    ) {
      if (!intent || matchesIntent(pending, intent)) return pending;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function matchesIntent(pending: PendingEntry, intent: AztecEntryIntent) {
  if (!pending.intent) {
    return intent.kind === "create"
      ? pending.reservation.seat === 0
      : pending.reservation.seat !== 0 && pending.reservation.room === intent.room;
  }
  if (pending.intent.kind !== intent.kind) return false;
  if (intent.kind === "join" && pending.intent.kind === "join") {
    return pending.intent.room === intent.room && pending.intent.name === intent.name;
  }
  if (intent.kind === "create" && pending.intent.kind === "create") {
    return pending.intent.players === intent.players
      && pending.intent.hands === intent.hands
      && pending.intent.name === intent.name;
  }
  return false;
}

function savePending(session: AztecSession, pending: PendingEntry) {
  const account = session.connection.account.item.toString();
  sessionStorage.setItem(pendingKey(account), JSON.stringify(pending));
}

function field(value: string) {
  if (!/^0x[0-9a-f]{1,64}$/i.test(value)) {
    throw new Error("Invalid Aztec entry");
  }
  return BigInt(value);
}

function entryKey(room: string) {
  return `noir-poker-aztec-entry-${room}`;
}

function pendingKey(account: string) {
  return `noir-poker-aztec-pending-${account.toLowerCase()}`;
}
