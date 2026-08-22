import {
  aggregateKeys,
  cipherBytes,
  decryptionValue,
  hex,
  keyPayload,
  openCard,
  pointHex,
  publicKey,
  transcriptNext,
  transcriptStart,
  verifyKey,
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
  if (
    audit.protocol_version !== 1 ||
    !Number.isSafeInteger(audit.hand_no) ||
    audit.keys.length < 2 ||
    audit.keys.length !== audit.key_proofs.length ||
    audit.shuffles.length !== audit.keys.length ||
    audit.openings.length !== audit.keys.length ||
    audit.deck.length !== 52 ||
    new Set(audit.deck).size !== 52
  ) throw new Error("invalid deck transcript");

  let head = transcriptStart(audit.room, audit.hand_no);
  let keyIndex = 0;
  let shuffleIndex = 0;
  let openingIndex = 0;
  const aggregate = await aggregateKeys(audit.keys);
  let prior = audit.shuffles[0]?.input;

  for (const record of audit.records) {
    if (record.seq !== audit.records.indexOf(record)) throw new Error("invalid transcript order");
    const payload = unbase64(record.payload);

    if (record.kind === "key") {
      progress(`checking key ${keyIndex + 1}`);
      const key = audit.keys[keyIndex];
      const proof = audit.key_proofs[keyIndex];
      if (!(await verifyKey(key, proof, head)) || hex(payload) !== hex(keyPayload(key, proof))) {
        throw new Error("invalid participant key");
      }
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
    } else if (record.kind === "opening") {
      progress(`checking opening ${openingIndex + 1}`);
      const secret = audit.openings[openingIndex];
      if (pointHex(await publicKey(`0x${secret}`)) !== pointHex(audit.keys[openingIndex])) {
        throw new Error("invalid final opening");
      }
      if (hex(payload) !== secret) throw new Error("opening missing from transcript");
      openingIndex += 1;
    } else if (record.kind === "complete" && hex(payload) !== hex(Uint8Array.from(audit.deck))) {
      throw new Error("deck missing from transcript");
    }

    head = transcriptNext(head, record.seq, record.kind, record.seat, payload);
    if (hex(head) !== record.hash) throw new Error("invalid transcript hash chain");
  }

  if (
    keyIndex !== audit.keys.length ||
    shuffleIndex !== audit.shuffles.length ||
    openingIndex !== audit.openings.length ||
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
