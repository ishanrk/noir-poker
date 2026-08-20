import {
  entryIdForSeat,
  fieldHex,
  newEntryNonce,
  nonceHex,
  tableIdForRoom,
} from "./ids";
import { enterPlayChipTable, playChipEntry } from "./play-chips";
import type { AztecSession } from "./session";

export type AztecEntryReceipt = {
  room: string;
  seat: number;
  amount: string;
  tableId: string;
  entryId: string;
  nonce: string;
  txHash: string;
};

export async function enterAztecRoom(
  session: AztecSession,
  room: string,
  seat: number,
  amount: number,
) {
  if (!session.ready) {
    throw new Error("Aztec wallet is not ready");
  }
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error("invalid PLAY buy-in");
  }
  if (session.balance < BigInt(amount)) {
    throw new Error("not enough PLAY");
  }

  const tableId = tableIdForRoom(room);
  const nonce = newEntryNonce();
  const entryId = entryIdForSeat(tableId, seat, nonce);
  const transaction = await enterPlayChipTable(
    session.contract,
    session.connection.account.item,
    tableId,
    entryId,
    BigInt(amount),
  );
  const entry = await playChipEntry(
    session.contract,
    session.connection.account.item,
    entryId,
  );

  if (
    !entry.exists ||
    entry.tableId !== tableId ||
    entry.amount !== BigInt(amount)
  ) {
    throw new Error("Aztec entry does not match the room buy-in");
  }

  const receipt: AztecEntryReceipt = {
    room,
    seat,
    amount: String(amount),
    tableId: fieldHex(tableId),
    entryId: fieldHex(entryId),
    nonce: nonceHex(nonce),
    txHash: transaction.receipt.txHash.toString(),
  };

  sessionStorage.setItem(entryKey(room), JSON.stringify(receipt));
  await session.refresh();
  return receipt;
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
      typeof receipt.nonce === "string" &&
      typeof receipt.txHash === "string"
    ) {
      return receipt as AztecEntryReceipt;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function entryKey(room: string) {
  return `noir-poker-aztec-entry-${room}`;
}
