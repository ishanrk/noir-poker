import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { chromium } from "playwright";
import { decodeHex, objectiveAt, objectiveIndex, objectiveMet } from "../lib/challenge.ts";
import { verifyDealAudit } from "../lib/deal.ts";
import { parseServerMessage } from "../lib/room-protocol.ts";

const base = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const server = process.env.SERVER_URL ?? "http://127.0.0.1:3001";
const realProof = process.env.REAL_PROOF_SMOKE === "1";
const proofTimeout = 300000;
const errors = [];
const requests = [];
const browser = await chromium.launch({ headless: true });
const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
const pages = [];

async function waitFor(read, message, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await read();
    if (value) return value;
    if (errors.length) throw new Error(errors.join("\n"));
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

async function frames(page) {
  return page.evaluate(() => window.__noirSmoke.frames);
}

async function snapshot(page, match = () => true, timeout) {
  return waitFor(async () => {
    const frame = (await frames(page)).findLast((frame) => frame.direction === "received" && frame.message.type === "snapshot");
    if (!frame) return;
    const message = parseServerMessage(JSON.stringify(frame.message));
    if (match(message, frame)) return { ...message, socket: frame.socket };
  }, "expected authoritative snapshot missing", timeout);
}

async function record(page, room, hand, seat) {
  return page.evaluate(({ room, hand, seat }) => {
    const text = localStorage.getItem(`noir-poker-participant-${room}-${hand}-${seat}`);
    return text ? JSON.parse(text) : undefined;
  }, { room, hand, seat });
}

async function clickAction(page, type) {
  const name = type === "call" ? /^Call/ : type === "raise_to" ? /^Raise →/ : type === "check" ? "Check" : "Fold";
  const button = page.getByRole("button", { name, exact: typeof name === "string" });
  await waitFor(() => button.isEnabled(), `${type} action unavailable`);
  await button.click();
}

async function checkCeremony(page, room, seat, hand) {
  const captured = await frames(page);
  const index = captured.findIndex((frame) => frame.direction === "sent" && ["deal_entropy", "ready"].includes(frame.message.type) && frame.message.hand_no === hand);
  assert.ok(index >= 0, "contribution was not sent");
  const sent = captured[index];
  const pinned = captured.slice(0, index).some((frame) => {
    const deal = frame.message.type === "waiting_fair" ? frame.message.deal : frame.message.view?.next_deal;
    return frame.direction === "received" && deal?.hand_no === hand && deal.commitment === sent.message.commitment;
  });
  assert.ok(pinned, "contribution preceded this hand commitment");
  assert.equal(sent.evidence?.room, room);
  assert.equal(sent.evidence?.seat, seat);
  assert.equal(sent.evidence?.hand_no, hand);
  assert.equal(sent.evidence?.commitment, sent.message.commitment);
  assert.equal(sent.evidence?.contribution, sent.message.entropy);
  assert.equal((await record(page, room, hand, seat)).contribution, sent.message.entropy);
}

async function audit(room, hand) {
  const response = await fetch(`${server}/audits/${room}/${hand}`);
  assert.equal(response.ok, true, "settled audit unavailable");
  const value = await response.json();
  for (const [seat, page] of pages.entries()) {
    const participant = await record(page, room, hand, seat);
    assert.equal(participant.observed.hole.length, 2);
    assert.equal(verifyDealAudit(value, participant, { room, hand_no: hand }).participant, "matches participant record");
  }
  assert.equal(verifyDealAudit(value).participant, "participant evidence unavailable");
}

try {
  for (const context of contexts) {
    await context.addInitScript(() => {
      const NativeSocket = window.WebSocket;
      const smoke = { frames: [], sockets: [], disconnectAfterProof: false };
      window.__noirSmoke = smoke;
      window.WebSocket = class extends NativeSocket {
        constructor(...args) {
          super(...args);
          if (!String(args[0]).includes("/rooms/")) return;
          this.smokeId = smoke.sockets.length;
          smoke.sockets.push(this);
          this.addEventListener("message", (event) => {
            if (this.smokeDrop) { event.stopImmediatePropagation(); return; }
            smoke.frames.push({ direction: "received", socket: this.smokeId, message: JSON.parse(event.data) });
          });
        }
        send(text) {
          if (this.smokeId === undefined) { super.send(text); return; }
          const message = JSON.parse(text);
          const frame = { direction: "sent", socket: this.smokeId, message: message.type === "auth" ? { type: "auth" } : message };
          if (message.type === "ready" || message.type === "deal_entropy") {
            const room = new URL(this.url).pathname.split("/")[2];
            const seat = JSON.parse(sessionStorage.getItem(`noir-poker-room-${room}`)).seat;
            frame.evidence = JSON.parse(localStorage.getItem(`noir-poker-participant-${room}-${message.hand_no}-${seat}`));
          }
          smoke.frames.push(frame);
          super.send(text);
          if (message.type === "challenge_draw" && smoke.disconnectAfterProof) {
            smoke.disconnectAfterProof = false;
            this.smokeDrop = true;
            this.close();
          }
        }
      };
    });
    const page = await context.newPage();
    pages.push(page);
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (request.method() === "POST" && /\/rooms(?:\/[^/]+\/join)?$/.test(new URL(request.url()).pathname)) requests.push(request.postDataJSON());
    });
    await page.goto(base, { waitUntil: "networkidle" });
    await page.getByRole("radio", { name: /Multiplayer/ }).check();
    assert.equal(await page.getByRole("button", { name: "Connect Aztec" }).count(), 0);
  }

  await pages[0].getByRole("button", { name: /^Create game/ }).click();
  await pages[0].waitForURL(/\/table\//);
  const room = new URL(pages[0].url()).pathname.split("/")[2];
  await waitFor(async () => (await frames(pages[0])).some((frame) => frame.message.type === "deal_entropy"), "first seat contribution missing");
  await pages[1].getByRole("textbox", { name: "Room id" }).fill(room);
  await pages[1].getByRole("button", { name: "Join game →" }).click();
  await pages[1].waitForURL(/\/table\//);
  await Promise.all(pages.map((page) => snapshot(page, (message) => message.view.hand_no === 0)));
  for (const [seat, page] of pages.entries()) await checkCeremony(page, room, seat, 0);
  assert.equal(requests.length, 2);
  assert.ok(requests.every((body) => !Object.hasOwn(body, "entropy")));
  console.log("two wallet free seats recorded commitments before contributions");

  const first = await snapshot(pages[0]);
  const actor = pages[first.view.turn];
  await clickAction(actor, "call");
  const afterCall = await snapshot(actor, (message) => message.rev > first.rev);
  const action = (await frames(actor)).findLast((frame) => frame.direction === "sent" && frame.message.type === "call").message;
  assert.equal(action.hand_no, 0);
  assert.equal(action.rev, first.rev);
  assert.match(action.request_id, /^[0-9a-f-]{36}$/);
  const beforeReplay = (await frames(actor)).length;
  await actor.evaluate((action) => window.__noirSmoke.sockets.at(-1).send(JSON.stringify(action)), action);
  await waitFor(async () => (await frames(actor)).slice(beforeReplay).some((frame) => frame.message.type === "error" && frame.message.message === "stale poker action"), "duplicate action was not rejected");
  const afterReplay = await snapshot(actor, (message) => message.rev === afterCall.rev);
  assert.deepEqual(afterReplay.view.players, afterCall.view.players);
  assert.equal(afterReplay.view.pot, afterCall.view.pot);
  await clickAction(pages[afterReplay.view.turn], "fold");
  await Promise.all(pages.map((page) => snapshot(page, (message) => message.view.settled)));
  await audit(room, 0);

  const saved = await record(pages[0], room, 0, 0);
  const previous = await snapshot(pages[0]);
  await pages[0].evaluate(() => window.__noirSmoke.sockets.at(-1).close());
  const restored = await snapshot(pages[0], (message, frame) => frame.socket > previous.socket && message.rev === previous.rev);
  assert.deepEqual(restored.view.hole, previous.view.hole);
  assert.deepEqual(await record(pages[0], room, 0, 0), saved);
  assert.equal(await pages[0].evaluate((room) => JSON.parse(sessionStorage.getItem(`noir-poker-room-${room}`)).seat, room), 0);
  console.log("settlement participant audit duplicate rejection and same seat reconnect passed");

  if (!realProof) {
    console.log("SKIP real draw completion next hand and receipt flow set REAL_PROOF_SMOKE=1 to opt in");
  } else {
    const objectives = [];
    for (const [seat, page] of pages.entries()) {
      await page.getByRole("button", { name: "Commit & draw →" }).click();
      const assigned = await snapshot(page, (message) => message.view.challenge?.assigned);
      const challenge = assigned.view.challenge;
      const stored = await page.evaluate(({ room, seat, hand }) => JSON.parse(sessionStorage.getItem(`noir-poker-challenge-${room}-${hand}-${seat}`)), { room, seat, hand: challenge.hand_no });
      objectives.push(objectiveIndex(decodeHex(challenge.hand_tag), seat, decodeHex(challenge.nonce), decodeHex(stored.secret)));
      if (seat === 0) await page.evaluate(() => { window.__noirSmoke.disconnectAfterProof = true; });
      await page.getByRole("button", { name: "Prove fair selection →" }).click();
      await snapshot(page, (message, frame) => message.view.challenge?.draw_verified && (seat !== 0 || frame.socket > assigned.socket), proofTimeout);
      assert.equal(await page.locator('.proof-rail li[data-active="true"]').count(), 0);
      console.log(`real draw accepted for seat ${seat}${seat === 0 ? " after submission disconnect and reconnect" : ""}`);
    }
    for (const page of pages) await page.getByRole("button", { name: "Add entropy & ready →" }).click();
    await Promise.all(pages.map((page) => snapshot(page, (message) => message.view.hand_no === 1 && !message.view.settled)));
    for (const [seat, page] of pages.entries()) await checkCeremony(page, room, seat, 1);
    const handOne = await snapshot(actor);
    const beforeStale = (await frames(actor)).length;
    await actor.evaluate((action) => window.__noirSmoke.sockets.at(-1).send(JSON.stringify(action)), action);
    await waitFor(async () => (await frames(actor)).slice(beforeStale).some((frame) => frame.message.type === "error" && frame.message.message === "stale poker action"), "previous hand action was not rejected");
    assert.deepEqual((await snapshot(actor)).view.players, handOne.view.players);

    const simple = objectives.findIndex((index) => index <= 4);
    const target = Math.max(0, simple >= 0 ? simple : objectives.findIndex((index) => index !== 7));
    const objective = objectives[target];
    const raised = [0, 0];
    for (let count = 0; count < 24; count += 1) {
      const current = await snapshot(pages[0]);
      if (current.view.settled) break;
      const seat = current.view.turn;
      const page = pages[seat];
      const own = await snapshot(page, (message) => message.rev >= current.rev);
      const actions = own.view.actions;
      let type = actions.check ? "check" : "call";
      if (own.view.street === "preflop" && actions.raise && raised[seat] === 0 &&
        ((objective === 2 && seat !== target) || ([1, 6].includes(objective) && seat === target))) {
        type = "raise_to";
        raised[seat] += 1;
      }
      if (own.view.street === "turn" && seat !== target && [5, 6].includes(objective)) type = "fold";
      await clickAction(page, type);
      await snapshot(page, (message) => message.rev > own.rev);
    }
    await Promise.all(pages.map((page) => snapshot(page, (message) => message.view.hand_no === 1 && message.view.settled)));
    await audit(room, 1);
    const claims = await Promise.all(pages.map((page) => snapshot(page)));
    const winner = claims.findIndex((message, seat) => message.view.claim && objectiveMet(objectiveAt(objectives[seat]), message.view.claim.facts));
    assert.notEqual(winner, -1, "neither random challenge was achieved in this hand no completion proof generated");
    const page = pages[winner];
    await page.getByRole("button", { name: /Prove completion/ }).click();
    const claimed = await snapshot(page, (message) => message.view.claim?.status === "claimed", proofTimeout);
    const nullifier = claimed.view.claim.nullifier;
    const receiptUrl = `${server}/proofs/${nullifier}`;
    const { stdout } = await promisify(execFile)(process.execPath, [fileURLToPath(new URL("./verify-receipt.mjs", import.meta.url)), receiptUrl], { timeout: proofTimeout });
    process.stdout.write(stdout);
    console.log("next hand participant audit and one real completion receipt passed");
  }

  await pages[0].goto(`${base}/audit/${room}/${realProof ? 1 : 0}`, { waitUntil: "networkidle" });
  await pages[0].getByText("transcript consistent — matches participant record.", { exact: true }).waitFor({ state: "visible" });
  console.log("browser audit displays participant bound verification");
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
