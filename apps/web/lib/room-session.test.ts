import assert from "node:assert/strict";
import { ProofSession } from "./proof-session.ts";
import { authenticationError, parseServerMessage } from "./room-protocol.ts";

const hash = "12".repeat(32);
const deal = {
  protocol_version: 2, hand_no: 0, commitment: hash, dealer: 0,
  config: { players: 2, stack: 1000, small_blind: 5, big_blind: 10 },
  contributors: 0, required: 2, mine: false, state: "collecting", audit: false,
};
const waiting = { type: "waiting_fair", rev: 0, players: 2, joined: 2, mode: "multiplayer", deal };
const view = {
  mode: "multiplayer", players: [{ stack: 995, bet: 5, folded: false }, { stack: 990, bet: 10, folded: false }],
  hand_no: 0, dealer: 0, turn: 0, hole: [{ value: "10♣" }, { value: "A♠" }], board: [], pot: 15,
  street: "preflop", round_complete: false, settled: false,
  actions: { fold: true, check: false, call: 5, raise: { min_to: 20, max_to: 1000 } },
  challenge: { hand_no: 0, hand_tag: hash, assigned: true, draw_verified: false, commitment: hash, nonce: hash, catalog_root: hash },
};
const snapshot = { type: "snapshot", rev: 4, view };
const parse = (value: unknown) => parseServerMessage(JSON.stringify(value));
assert.deepEqual(parse(waiting), waiting);
assert.deepEqual(parse(snapshot), snapshot);
for (const value of [null, [], { type: "unknown" }, { ...snapshot, rev: Number.MAX_SAFE_INTEGER + 1 },
  { ...snapshot, view: { ...view, hand_no: -1 } }, { ...snapshot, view: { ...view, hole: [{ value: "11♣" }, { value: "A♠" }] } },
  { ...snapshot, view: { ...view, actions: { fold: true, check: false, raise: { min_to: 20, max_to: 10 } } } },
  { ...snapshot, view: { ...view, challenge: { ...view.challenge, commitment: undefined } } },
  { ...waiting, deal: { ...deal, config: { ...deal.config, players: 7 } } },
  { ...waiting, deal: { ...deal, commitment: "not a hash" } }, { ...waiting, rev: undefined }]) {
  assert.throws(() => parse(value));
}
assert.throws(() => parseServerMessage("{"));
assert.throws(() => parseServerMessage(" ".repeat(262145)));
assert.equal(authenticationError({ type: "error", message: "unknown token" }), true);
assert.equal(authenticationError({ type: "error", message: "seat expired", code: "auth" }), true);
assert.equal(authenticationError({ type: "error", message: "verifier busy", code: "busy" }), false);

const session = new ProofSession();
const submitted = session.start("room a", 0, "draw");
session.reconcile({ hand_no: 0, draw_verified: false }, undefined);
assert.equal(session.current(submitted), true);
session.reset();
assert.equal(session.operation, undefined);
assert.equal(session.current(submitted), false);
session.reconcile({ hand_no: 0, draw_verified: true }, undefined);
assert.equal(session.operation, undefined);
const replacement = session.start("room b", 1, "claim");
assert.equal(session.current(submitted), false);
assert.equal(session.current(replacement), true);
session.reconcile({ hand_no: 2, draw_verified: false }, { hand_no: 1, status: "claimable" });
assert.equal(session.current(replacement), true);
session.reconcile({ hand_no: 2, draw_verified: false }, { hand_no: 1, status: "claimed" });
assert.equal(session.operation, undefined);
const obsolete = session.start("room b", 2, "draw");
session.reconcile({ hand_no: 3, draw_verified: false }, undefined);
assert.equal(session.current(obsolete), false);

process.stdout.write("room protocol and proof session regressions ok\n");
