import {
  aggregateKeys,
  canonicalDeck,
  cipherBytes,
  decryptionValue,
  hex,
  keyPayload,
  openCard,
  pointHex,
  pointFromHex,
  publicKey,
  transcriptNext,
  transcriptStart,
  verifyKey,
  verifyShare,
  type PointValue,
  type ShareProof,
} from "@/lib/deck-crypto";
import { verifyShuffle } from "@/lib/deck-proof";
import type { DealAudit } from "@/lib/server";

export type DeckCheck = {
  transcript: boolean;
  keys: boolean;
  shuffles: boolean;
  openings: boolean;
  deck: number[];
};

export async function verifyDeck(audit: DealAudit, progress: (value: string) => void): Promise<DeckCheck> {
  const ordered = [...audit.deck].sort((a, b) => a - b);
  if (
    audit.protocol_version !== 1 ||
    !Number.isSafeInteger(audit.hand_no) ||
    audit.keys.length < 2 ||
    audit.keys.length !== audit.key_proofs.length ||
    audit.shuffles.length !== audit.keys.length ||
    audit.openings.length !== audit.keys.length ||
    audit.deck.length !== 52 ||
    ordered.some((card, index) => card !== index)
  ) throw new Error("invalid deck transcript");

  let head = transcriptStart(audit.room, audit.hand_no);
  let keyIndex = 0;
  let shuffleIndex = 0;
  let complete = 0;
  const aggregate = await aggregateKeys(audit.keys);
  let prior = audit.shuffles[0]?.input;
  const expected = await canonicalDeck();
  if (!prior || !sameDeck(prior, expected)) throw new Error("invalid canonical deck");
  const participants = new Map<number, number>();
  const shares = new Map<number, PointValue[]>();
  const openings = new Set<number>();

  for (const [seq, record] of audit.records.entries()) {
    if (record.seq !== seq) throw new Error("invalid transcript order");
    const payload = unbase64(record.payload);

    if (record.kind === "key") {
      progress(`checking key ${keyIndex + 1}`);
      const key = audit.keys[keyIndex];
      const proof = audit.key_proofs[keyIndex];
      if (!(await verifyKey(key, proof, head)) || hex(payload) !== hex(keyPayload(key, proof))) {
        throw new Error("invalid participant key");
      }
      if (record.seat !== undefined) participants.set(record.seat, keyIndex);
      keyIndex += 1;
    } else if (record.kind === "shuffle") {
      progress(`checking shuffle ${shuffleIndex + 1}`);
      const value = audit.shuffles[shuffleIndex];
      if (
        value.participant !== shuffleIndex ||
        !prior ||
        !sameDeck(value.input, prior) ||
        !(await verifyShuffle({
          hand: audit.hand_no,
          seat: value.participant,
          context: hex(head),
          input: value.input,
          output: value.output,
          key: aggregate,
        }, value.proof, value.public_inputs))
      ) throw new Error("invalid shuffle proof");
      const expected = join(
        Uint8Array.of(value.participant),
        ...value.input.map(cipherBytes),
        ...value.output.map(cipherBytes),
        unbase64(value.proof),
        unbase64(value.public_inputs),
      );
      if (hex(payload) !== hex(expected)) throw new Error("shuffle missing from transcript");
      prior = value.output;
      shuffleIndex += 1;
    } else if (record.kind === "share") {
      const participant = record.seat === undefined ? 0 : participants.get(record.seat);
      if (participant === undefined) throw new Error("invalid share participant");
      for (const item of parseShares(payload)) {
        if (
          item.position >= prior.length ||
          !(await verifyShare(prior[item.position], audit.keys[participant], item.value, item.proof, head))
        ) throw new Error("invalid decryption share");
        shares.set(item.position, [...(shares.get(item.position) ?? []), item.value]);
      }
    } else if (record.kind === "reveal") {
      for (const item of parseReveals(payload)) {
        const values = shares.get(item.position);
        if (
          item.position >= prior.length ||
          !values ||
          values.length !== audit.keys.length ||
          await openCard(prior[item.position], values) !== item.card
        ) {
          throw new Error("invalid card reveal");
        }
      }
    } else if (record.kind === "opening") {
      const participant = record.seat === undefined ? 0 : participants.get(record.seat);
      if (participant === undefined || openings.has(participant)) throw new Error("invalid final opening");
      progress(`checking opening ${openings.size + 1}`);
      const secret = audit.openings[participant];
      if (pointHex(await publicKey(`0x${secret}`)) !== pointHex(audit.keys[participant])) {
        throw new Error("invalid final opening");
      }
      if (hex(payload) !== secret) throw new Error("opening missing from transcript");
      openings.add(participant);
    } else if (record.kind === "complete") {
      if (complete !== 0 || hex(payload) !== hex(Uint8Array.from(audit.deck))) {
        throw new Error("deck missing from transcript");
      }
      complete += 1;
    } else {
      throw new Error("unknown transcript record");
    }

    head = transcriptNext(head, record.seq, record.kind, record.seat, payload);
    if (hex(head) !== record.hash) throw new Error("invalid transcript hash chain");
  }

  if (
    keyIndex !== audit.keys.length ||
    shuffleIndex !== audit.shuffles.length ||
    openings.size !== audit.openings.length ||
    complete !== 1 ||
    hex(head) !== audit.transcript_hash ||
    !prior
  ) throw new Error("incomplete deck transcript");

  progress("reconstructing deck");
  const deck = await Promise.all(prior.map((card) =>
    Promise.all(audit.openings.map((secret) => decryption(card, secret)))
      .then((shares) => openCard(card, shares)),
  ));
  if (deck.some((card, index) => card !== audit.deck[index])) throw new Error("deck opening mismatch");

  return { transcript: true, keys: true, shuffles: true, openings: true, deck };
}

function parseShares(payload: Uint8Array) {
  const size = 232;
  if (!payload.length || payload.length % size !== 0) throw new Error("invalid share record");
  return Array.from({ length: payload.length / size }, (_, index) => {
    const item = payload.slice(index * size, (index + 1) * size);
    return {
      position: Number(new DataView(item.buffer, item.byteOffset, 8).getBigUint64(0)),
      value: pointFromHex(hex(item.slice(8, 72))),
      proof: {
        a: pointFromHex(hex(item.slice(72, 136))),
        b: pointFromHex(hex(item.slice(136, 200))),
        z: `0x${hex(item.slice(200, 232))}`,
      } satisfies ShareProof,
    };
  });
}

function parseReveals(payload: Uint8Array) {
  const size = 9;
  if (payload.length % size !== 0) throw new Error("invalid reveal record");
  return Array.from({ length: payload.length / size }, (_, index) => {
    const item = payload.slice(index * size, (index + 1) * size);
    return {
      position: Number(new DataView(item.buffer, item.byteOffset, 8).getBigUint64(0)),
      card: item[8],
    };
  });
}

async function decryption(card: DealAudit["shuffles"][number]["output"][number], secret: string) {
  return decryptionValue(card, `0x${secret}`);
}

function sameDeck(a: DealAudit["shuffles"][number]["input"], b: DealAudit["shuffles"][number]["input"]) {
  return a.length === b.length && a.every((card, index) => hex(cipherBytes(card)) === hex(cipherBytes(b[index])));
}

function unbase64(value: string) {
  const raw = atob(value);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

function join(...parts: Uint8Array[]) {
  const output = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}
