import type { DealView } from "../components/deal-integrity";
import type { View } from "../components/table";
import type { RoomMode } from "./server";

export type Waiting = { joined: number; players: number; mode: RoomMode; deal?: DealView };
export type ServerMessage =
  | ({ type: "waiting" } & Waiting)
  | ({ type: "waiting_fair"; rev: number; deal: DealView } & Waiting)
  | { type: "snapshot"; rev: number; view: View }
  | { type: "error"; message: string; code?: string };
export type BetAction = { type: "fold" | "check" | "call" } | { type: "raise_to"; to: number };
export type ClientAction =
  | (BetAction & { hand_no: number; rev: number; request_id: string })
  | { type: "challenge_commit"; hand_no: number; commitment: string }
  | { type: "challenge_draw" | "challenge_claim"; hand_no: number; proof: string; public_inputs: string }
  | { type: "ready" | "deal_entropy"; hand_no: number; commitment: string; entropy: string };

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): value is ObjectValue => value !== null && typeof value === "object" && !Array.isArray(value);
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const positive = (value: unknown): value is number => integer(value) && value > 0;
const hex = (value: unknown) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const mode = (value: unknown) => value === "single" || value === "multiplayer" || value === "aztec";
const optional = (value: unknown, check: (value: unknown) => boolean) => value === undefined || check(value);
const absent = (value: unknown, check: (value: unknown) => boolean) => value === null || optional(value, check);
const card = (value: unknown) => object(value) && typeof value.value === "string" && /^(?:[2-9JQKA]|10)[♣♦♥♠]$/.test(value.value);
const cards = (value: unknown, length: number) => Array.isArray(value) && value.length === length && value.every(card);

function deal(value: unknown): boolean {
  if (!object(value)) return false;
  return integer(value.hand_no) && hex(value.commitment) && integer(value.contributors) &&
    positive(value.required) && value.required <= 6 && value.contributors <= value.required &&
    typeof value.mine === "boolean" && typeof value.audit === "boolean" &&
    ["collecting", "sealed", "revealed"].includes(String(value.state)) &&
    (value.protocol_version === 1 || value.protocol_version === 2) &&
    integer(value.dealer) && object(value.config) && positive(value.config.players) &&
    value.config.players >= 2 && value.config.players <= 6 && value.dealer < value.config.players &&
    positive(value.config.stack) && positive(value.config.small_blind) && positive(value.config.big_blind) &&
    value.config.small_blind <= value.config.big_blind;
}

function assignment(value: ObjectValue): boolean {
  return integer(value.hand_no) && hex(value.hand_tag) && hex(value.commitment) && hex(value.nonce) && hex(value.catalog_root);
}

function challenge(value: unknown): boolean {
  if (!object(value) || !integer(value.hand_no) || !hex(value.hand_tag) || typeof value.assigned !== "boolean" || typeof value.draw_verified !== "boolean") return false;
  return value.assigned ? assignment(value) : !value.draw_verified && optional(value.commitment, hex) && optional(value.nonce, hex) && optional(value.catalog_root, hex);
}

function claim(value: unknown): boolean {
  return object(value) && assignment(value) && hex(value.facts_salt) && hex(value.facts_hash) &&
    Array.isArray(value.facts) && value.facts.length === 6 && value.facts.every((fact) => fact === 0 || fact === 1) &&
    (value.status === "claimable" || value.status === "claimed") && optional(value.points, integer) && optional(value.nullifier, hex);
}

function view(value: unknown): boolean {
  if (!object(value) || !Array.isArray(value.players) || value.players.length < 2 || value.players.length > 6) return false;
  const players = value.players.length;
  const seat = (value: unknown) => integer(value) && value < players;
  const actions = (value: unknown) => object(value) && typeof value.fold === "boolean" && typeof value.check === "boolean" &&
    optional(value.call, integer) && optional(value.raise, (range) => object(range) && integer(range.min_to) && integer(range.max_to) && range.min_to <= range.max_to);
  const ready = (value: unknown) => object(value) && typeof value.mine === "boolean" && typeof value.complete === "boolean" &&
    integer(value.count) && positive(value.players) && value.players <= players && value.count <= value.players;
  const result = (value: unknown) => object(value) && (value.kind === "fold" || value.kind === "showdown") &&
    Array.isArray(value.awards) && value.awards.every((award) => object(award) && seat(award.player) && integer(award.amount)) &&
    Array.isArray(value.revealed) && value.revealed.length === players && value.revealed.every((hole) => absent(hole, (value) => cards(value, 2)));
  return mode(value.mode) && integer(value.hand_no) && seat(value.dealer) && optional(value.turn, seat) &&
    value.players.every((player) => object(player) && integer(player.stack) && integer(player.bet) && typeof player.folded === "boolean" && optional(player.proof_points, integer)) &&
    cards(value.hole, 2) && Array.isArray(value.board) && [0, 3, 4, 5].includes(value.board.length) && value.board.every(card) &&
    integer(value.pot) && ["preflop", "flop", "turn", "river"].includes(String(value.street)) &&
    typeof value.round_complete === "boolean" && typeof value.settled === "boolean" &&
    optional(value.actions, actions) && optional(value.ready, ready) && optional(value.result, result) &&
    optional(value.challenge, challenge) && optional(value.claim, claim) && optional(value.deal, deal) && optional(value.next_deal, deal);
}

export function parseServerMessage(text: string): ServerMessage {
  if (text.length > 262144) throw new Error("Server message too large");
  const value: unknown = JSON.parse(text);
  if (!object(value)) throw new Error("Invalid server message");
  let valid = false;
  if (value.type === "error") valid = typeof value.message === "string" && value.message.length <= 4096 && optional(value.code, (value) => typeof value === "string");
  if (value.type === "snapshot") valid = integer(value.rev) && view(value.view);
  if (value.type === "waiting" || value.type === "waiting_fair") {
    valid = positive(value.players) && value.players >= 2 && value.players <= 6 && integer(value.joined) && value.joined <= value.players && mode(value.mode);
    if (value.type === "waiting_fair") valid = valid && integer(value.rev) && deal(value.deal);
  }
  if (!valid) throw new Error("Invalid server message");
  return value as ServerMessage;
}

export function authenticationError(message: Extract<ServerMessage, { type: "error" }>) {
  return message.code === "auth" || /^(unknown token|authentication required|authentication failed|invalid authentication|authentication timeout)$/.test(message.message);
}
