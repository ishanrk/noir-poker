import assert from "node:assert/strict";

import { chromium } from "playwright";

const base = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const browser = await chromium.launch({ headless: true });
const errors = [];
const traces = [];

function watch(page, name) {
  const frames = [];
  const trace = { page, frames, name };
  traces.push(trace);

  page.on("pageerror", (error) => errors.push(`${name} page ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`${name} console ${message.text()}`);
  });
  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText ?? "failed";
    if (
      failure !== "net::ERR_ABORTED" &&
      ["document", "fetch", "xhr", "script", "stylesheet"].includes(request.resourceType())
    ) {
      errors.push(`${name} request ${request.url()} ${failure}`);
    }
  });
  page.on("websocket", (socket) => {
    if (!socket.url().includes("/rooms/")) return;
    const record = (direction, payload) => {
      frames.push({ direction, payload, at: Date.now() });
      if (process.env.TRACE_FRAMES === "1") {
        const message = value({ payload });
        process.stdout.write(`${name} ${direction} ${message?.type ?? "invalid"} ${message?.stage ?? message?.message ?? ""} ${message?.hand_no ?? ""}\n`);
      }
    };
    socket.on("framereceived", ({ payload }) => record("received", payload));
    socket.on("framesent", ({ payload }) => record("sent", payload));
  });

  return trace;
}

function value(frame) {
  if (typeof frame?.payload !== "string") return undefined;
  try {
    return JSON.parse(frame.payload);
  } catch {
    return undefined;
  }
}

async function until(test, message, timeout = 240_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const result = await test();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

async function frame(trace, test, after = 0, message = "message missing") {
  const found = await until(() => {
    for (let i = after; i < trace.frames.length; i += 1) {
      const message = value(trace.frames[i]);
      if (message && test(message, trace.frames[i])) return i + 1;
    }
    return undefined;
  }, `${trace.name} ${message}`);
  return found - 1;
}

function latest(trace) {
  for (let i = trace.frames.length - 1; i >= 0; i -= 1) {
    const message = value(trace.frames[i]);
    if (message?.type === "snapshot") return message;
  }
  return undefined;
}

async function setHands(page, index) {
  const input = page.locator(".hand-scale input[type='range']");
  await input.fill(String(index));
}

async function openLobby(trace, mode, seats, handsIndex) {
  await trace.page.goto(base, { waitUntil: "networkidle" });
  const selectedMode = trace.page.getByRole("radio", { name: mode });
  const selectedSeats = trace.page.getByRole("radio", { name: String(seats), exact: true });
  await selectedMode.check();
  await selectedSeats.check();
  await setHands(trace.page, handsIndex);
  assert.equal(await selectedMode.isChecked(), true, `${mode} not selected`);
  assert.equal(await selectedSeats.isChecked(), true, `${seats} seats not selected`);
}

async function setName(page, name, join = false) {
  const named = page.locator(`input[name="${join ? "player_name" : "name"}"]`).first();
  if (await named.count()) {
    await named.fill(name);
    return;
  }
  const labelled = page.getByLabel(/name/i).first();
  if (await labelled.count()) await labelled.fill(name);
}

async function enabled(page) {
  const buttons = [
    page.getByRole("button", { name: /^Call/ }),
    page.getByRole("button", { name: "Check" }),
  ];
  return until(async () => {
    for (const button of buttons) {
      if (await button.count() && await button.isEnabled()) return button;
    }
    return undefined;
  }, "player action missing");
}

async function hole(page) {
  return until(async () => {
    const cards = await page.locator('section[aria-label="You"] .card[data-filled="true"]').evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("aria-label")),
    );
    return cards.length === 2 && cards.every(Boolean) ? cards : undefined;
  }, "private cards missing");
}

function sent(trace, kind) {
  return trace.frames.filter((item) => {
    const message = value(item);
    return item.direction === "sent" && message?.type === kind;
  });
}

function actionTimes(trace, hand) {
  const found = new Map();
  for (const item of trace.frames) {
    const message = value(item);
    if (item.direction !== "received" || message?.type !== "snapshot" || message.view?.hand_no !== hand) continue;
    const action = message.view.last_action;
    if (action && !found.has(action.seq)) found.set(action.seq, item.at);
  }
  return [...found].sort(([a], [b]) => a - b);
}

function actionCount(trace) {
  return sent(trace, "call").length + sent(trace, "check").length + sent(trace, "fold").length;
}

function paced(trace, hand) {
  const times = actionTimes(trace, hand);
  assert.ok(times.length >= 3, `single hand ${hand + 1} bot sequence too short`);
  for (let i = 1; i < times.length; i += 1) {
    assert.equal(times[i][0], times[i - 1][0] + 1, `single hand ${hand + 1} action sequence gap`);
  }
  cardsBeforeActions(trace, hand);
}

function cardsBeforeActions(trace, hand) {
  let last = -1;
  let pending;
  for (const item of trace.frames) {
    const message = value(item);
    if (item.direction !== "received" || message?.type !== "snapshot" || message.view?.hand_no !== hand) continue;
    const action = message.view.last_action;
    if (!action) continue;
    if (pending && action.seq === pending.seq && message.view.board.length > pending.board) pending = undefined;
    if (action.seq <= last) continue;
    assert.equal(pending, undefined, `single hand ${hand + 1} action arrived before cards`);
    last = action.seq;
    if (message.view.round_complete && !message.view.settled) {
      pending = { seq: action.seq, board: message.view.board.length };
    }
  }
}

function validDeckKey(trace) {
  const failed = trace.frames.some((item) => {
    const message = value(item);
    return message?.type === "error" && message.message === "invalid deck key";
  });
  assert.equal(failed, false, "single next hand rejected deck key");
}

async function singleAction(trace) {
  const before = actionCount(trace);
  await (await enabled(trace.page)).click();
  await until(() => actionCount(trace) === before + 1, "single action not sent");
  const fold = trace.page.getByRole("button", { name: "Fold" });
  await until(async () => !await fold.isEnabled(), "single action stayed enabled");
  await until(async () => await fold.isEnabled(), "single bots did not return the turn");
}

async function settleSingle(trace, hand, final) {
  const before = sent(trace, "fold").length;
  const fold = trace.page.getByRole("button", { name: "Fold" });
  await until(async () => await fold.isEnabled(), `single hand ${hand + 1} fold unavailable`);
  await fold.click();
  await until(() => sent(trace, "fold").length === before + 1, `single hand ${hand + 1} fold not sent`);
  await frame(
    trace,
    (message) =>
      message.type === "snapshot" &&
      message.view?.hand_no === hand &&
      message.view?.settled &&
      message.view?.deal?.audit &&
      (!final || message.view?.game_over),
    0,
    `single hand ${hand + 1} audit missing`,
  );
  paced(trace, hand);
  await waitNotices(trace.page, `single hand ${hand + 1}`);
  await checkNoticePacing(trace, `single hand ${hand + 1}`, hand);
}

async function nextSingle(trace, hand) {
  const before = sent(trace, "ready").length;
  const ready = trace.page.getByRole("button", { name: "Ready for Next Hand" });
  await until(async () => await ready.isEnabled(), `single hand ${hand + 1} ready unavailable`);
  await ready.click();
  await until(() => sent(trace, "ready").length === before + 1, `single hand ${hand + 1} ready not sent`);
  await waitHand(trace, hand + 1);
  await trace.page.getByText(`Hand ${hand + 2} / 3`, { exact: true }).waitFor({ timeout: 240_000 });
  const cards = await hole(trace.page);
  assert.equal(cards.length, 2, `single hand ${hand + 2} cards missing`);
  assert.equal(
    await trace.page.locator(`.table-action-notice[data-hand="${hand}"]`).count(),
    0,
    "old single notice crossed hands",
  );
  validDeckKey(trace);
  return cards;
}

async function singleStress() {
  const context = await browser.newContext();
  const trace = watch(await context.newPage(), "single");

  await openLobby(trace, "Single Player", 4, 1);
  await trace.page.getByRole("button", { name: "Create Game" }).click();
  await trace.page.waitForURL(/\/table\//, { timeout: 15_000 });
  await trace.page.getByText("Bot 3", { exact: true }).waitFor({ timeout: 240_000 });
  const cards = await hole(trace.page);
  const button = await enabled(trace.page);
  const before = actionCount(trace);

  await button.evaluate((node) => {
    node.click();
    node.click();
  });
  await trace.page.waitForTimeout(150);
  await trace.page.reload({ waitUntil: "domcontentloaded" });
  await trace.page.getByText("Bot 3", { exact: true }).waitFor({ timeout: 30_000 });
  await noticeLog(trace);
  assert.deepEqual(await hole(trace.page), cards, "single hole cards changed after refresh");
  assert.equal(await trace.page.locator(".table-action-notice").count(), 0, "old notice replayed after refresh");

  const after = actionCount(trace);
  assert.equal(after - before, 1, "single double action sent twice");

  await settleSingle(trace, 0, false);
  await nextSingle(trace, 0);
  await singleAction(trace);
  await settleSingle(trace, 1, false);
  await nextSingle(trace, 1);
  await singleAction(trace);
  await settleSingle(trace, 2, true);
  await trace.page.getByText("Deck Randomness Proof", { exact: true }).waitFor();
  const verifyDeck = trace.page.getByRole("link", { name: /Verify Deck/ });
  await verifyDeck.waitFor();
  assert.equal(await verifyDeck.getAttribute("target"), "_blank", "deck proof replaced the table tab");
  await trace.page.waitForURL(`${base}/`, { timeout: 10_000 });

  await checkNoticePacing(trace, "single");
  assert.equal(sent(trace, "ready").length, 2, "single did not ready twice");
  validDeckKey(trace);
  assert.equal(sent(trace, "challenge_commit").length, 0, "single challenge assigned");
  assert.equal(sent(trace, "challenge_draw").length, 0, "single draw proof generated");
  await context.close();
}

async function waitHand(trace, hand) {
  await frame(
    trace,
    (message) => message.type === "snapshot" && message.view?.hand_no === hand && !message.view?.settled,
    0,
    `hand ${hand + 1} not playable`,
  );
  return hole(trace.page);
}

async function foldCurrent(a, b, hand) {
  const current = await until(async () => {
    for (const trace of [a, b]) {
      if (latest(trace)?.view?.hand_no !== hand) continue;
      const button = trace.page.getByRole("button", { name: "Fold" });
      if (await button.isEnabled()) return { trace, button };
    }
    return undefined;
  }, `hand ${hand + 1} turn missing`);
  const { trace, button } = current;
  const before = sent(trace, "fold").length;
  await button.evaluate((node) => {
    node.click();
    node.click();
  });
  await until(() => sent(trace, "fold").length === before + 1, "multiplayer double fold sent twice");
}

const objectives = [
  "See the flop",
  "Raise before the flop",
  "Call before the flop",
  "Check on the flop",
  "Reach showdown",
  "Finish the hand ahead",
  "Raise before the flop and finish ahead",
  "Reach showdown finish ahead and never raise before the flop",
];

async function challenge(page) {
  return until(async () => {
    for (let index = 0; index < objectives.length; index += 1) {
      const match = page.getByText(objectives[index], { exact: true }).first();
      if (await match.count() && await match.isVisible()) return { index, name: objectives[index] };
    }
    return undefined;
  }, "private challenge missing");
}

async function currentPlayer(a, b, hand) {
  return until(async () => {
    if ([a, b].some((trace) => latest(trace)?.view?.hand_no === hand && latest(trace)?.view?.settled)) {
      return "settled";
    }
    for (const trace of [a, b]) {
      const view = latest(trace)?.view;
      if (view?.hand_no !== hand || view.settled || !view.actions) continue;
      const fold = trace.page.getByRole("button", { name: "Fold" });
      if (await fold.isEnabled()) return trace;
    }
    return undefined;
  }, `hand ${hand + 1} active player missing`);
}

async function act(trace, kind) {
  const before = sent(trace, kind).length;
  if (kind === "raise_to") {
    const min = trace.page.getByRole("button", { name: "Min" });
    const raise = trace.page.getByRole("button", { name: "Raise", exact: true });
    await until(async () => await min.isEnabled() && await raise.isEnabled(), "raise unavailable");
    await min.click();
    await raise.click();
  } else {
    const name = kind === "call" ? /^Call/ : kind[0].toUpperCase() + kind.slice(1);
    const button = trace.page.getByRole("button", { name });
    await until(async () => await button.isEnabled(), `${kind} unavailable`);
    await button.click();
  }
  await until(() => sent(trace, kind).length === before + 1, `${kind} not sent`);
}

async function safe(trace) {
  const actions = latest(trace)?.view?.actions;
  if (actions?.check) await act(trace, "check");
  else if (actions?.call !== undefined) await act(trace, "call");
  else throw new Error(`${trace.name} safe action missing`);
}

async function winByFold(target, a, b, hand) {
  while (true) {
    const current = await currentPlayer(a, b, hand);
    if (current === "settled") return;
    if (current === target) await safe(current);
    else await act(current, "fold");
  }
}

async function reachFlop(a, b, hand) {
  while (latest(a)?.view?.street?.toLowerCase() === "preflop") {
    const current = await currentPlayer(a, b, hand);
    if (current === "settled") throw new Error("hand ended before flop");
    if (latest(current)?.view?.street?.toLowerCase() !== "preflop") break;
    await safe(current);
  }
}

async function showdown(a, b, hand) {
  while (true) {
    const current = await currentPlayer(a, b, hand);
    if (current === "settled") return;
    await safe(current);
  }
}

async function playObjective(target, objective, a, b, hand) {
  if (objective === 0) {
    await reachFlop(a, b, hand);
    await winByFold(target, a, b, hand);
    return;
  }
  if (objective === 1 || objective === 6) {
    while (true) {
      const current = await currentPlayer(a, b, hand);
      if (current === "settled") throw new Error("hand ended before target raise");
      if (current === target) break;
      await safe(current);
    }
    await act(target, "raise_to");
    await winByFold(target, a, b, hand);
    return;
  }
  if (objective === 2) {
    while (true) {
      const current = await currentPlayer(a, b, hand);
      if (current === "settled") throw new Error("hand ended before target call");
      const actions = latest(current)?.view?.actions;
      if (current === target && actions?.call !== undefined) {
        await act(current, "call");
        break;
      }
      if (current !== target && actions?.raise) await act(current, "raise_to");
      else await safe(current);
    }
    await winByFold(target, a, b, hand);
    return;
  }
  if (objective === 3) {
    await reachFlop(a, b, hand);
    while (true) {
      const current = await currentPlayer(a, b, hand);
      if (current === "settled") throw new Error("hand ended before target flop check");
      if (current === target) break;
      await safe(current);
    }
    await act(target, "check");
    await winByFold(target, a, b, hand);
    return;
  }
  if (objective === 4 || objective === 7) {
    await showdown(a, b, hand);
    return;
  }
  await winByFold(target, a, b, hand);
}

async function verifyPublic(viewer, owner, kind) {
  const row = viewer.page
    .getByText(owner.toUpperCase(), { exact: true })
    .locator("..")
    .locator("..");
  const item = row
    .getByText(kind, { exact: true })
    .locator("..")
    .locator("..");
  const verify = item.getByRole("link", { name: "VERIFY", exact: true });
  await verify.waitFor({ timeout: 30_000 });
  const tableUrl = viewer.page.url();
  const opened = viewer.page.waitForEvent("popup");
  await verify.click();
  const page = await opened;
  watch(page, `${viewer.name}-${kind.toLowerCase().replaceAll(" ", "-")}`);
  await page.getByText("READY TO VERIFY", { exact: true }).waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: "VERIFY", exact: true }).waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: "VERIFY", exact: true }).click();
  await page.getByText("VERIFIED LOCALLY", { exact: true }).waitFor({ timeout: 120_000 });
  assert.equal(viewer.page.url(), tableUrl, `${kind} proof replaced the table tab`);
  await page.close();
}

async function multiplayerStress() {
  const ca = await browser.newContext();
  const cb = await browser.newContext();
  const a = watch(await ca.newPage(), "a");
  const b = watch(await cb.newPage(), "b");

  await openLobby(a, "Multiplayer", 2, 1);
  await setName(a.page, "Alice");
  await a.page.getByRole("button", { name: "Create Game" }).click();
  await a.page.waitForURL(/\/table\//, { timeout: 15_000 });
  const room = new URL(a.page.url()).pathname.split("/").at(-1);
  assert.match(room, /^[0-9A-F]{8}$/);

  await b.page.goto(base, { waitUntil: "networkidle" });
  await b.page.getByRole("radio", { name: "Multiplayer" }).check();
  await setName(b.page, "Bob", true);
  await b.page.getByLabel("Room ID").fill(room);
  await b.page.getByRole("button", { name: "Join Game" }).click();
  await b.page.waitForURL(new RegExp(`/table/${room}$`), { timeout: 15_000 });

  const [aHole, bHole] = await Promise.all([waitHand(a, 0), waitHand(b, 0)]);
  await Promise.all([noticeLog(a), noticeLog(b)]);
  assert.notDeepEqual(aHole, bHole, "multiplayer seats received the same hole cards");
  assert.equal(await a.page.locator('section[aria-label="Bob"] .card-hidden').count(), 2);
  assert.equal(await b.page.locator('section[aria-label="Alice"] .card-hidden').count(), 2);

  await foldCurrent(a, b, 0);
  await Promise.all([
    a.page.getByRole("button", { name: "Draw Challenge" }).waitFor({ timeout: 240_000 }),
    b.page.getByRole("button", { name: "Draw Challenge" }).waitFor({ timeout: 240_000 }),
  ]);
  assert.equal(sent(a, "challenge_draw").length + sent(b, "challenge_draw").length, 0);

  await Promise.all([
    a.page.getByRole("button", { name: "Draw Challenge" }).click(),
    b.page.getByRole("button", { name: "Draw Challenge" }).click(),
  ]);
  await Promise.all([
    a.page.getByRole("button", { name: "Generate Fair Draw Proof" }).waitFor(),
    b.page.getByRole("button", { name: "Generate Fair Draw Proof" }).waitFor(),
  ]);
  await Promise.all([
    waitNotices(a.page, "multiplayer hand 1 a"),
    waitNotices(b.page, "multiplayer hand 1 b"),
  ]);
  await Promise.all([
    checkNoticePacing(a, "multiplayer hand 1 a", 0),
    checkNoticePacing(b, "multiplayer hand 1 b", 0),
  ]);

  const aReady = a.page.getByRole("button", { name: "Ready for Next Hand" });
  await until(async () => await aReady.isEnabled(), "ready blocked without draw proof");
  await aReady.click();
  await a.page.getByRole("button", { name: "Ready 1/2" }).waitFor({ timeout: 15_000 });
  assert.equal(sent(a, "challenge_draw").length, 0, "ready generated a draw proof");

  await b.page.getByRole("button", { name: "Generate Fair Draw Proof" }).click();
  await frame(b, (message) => message.type === "proof_accepted" && message.kind === "draw" && message.hand_no === 1, 0, "draw proof not accepted");
  await verifyPublic(a, "Bob", "FAIR DRAW");

  const bReady = b.page.getByRole("button", { name: "Ready for Next Hand" });
  await until(async () => await bReady.isEnabled(), "second ready unavailable");
  await bReady.click();
  const [aNext, bNext] = await Promise.all([waitHand(a, 1), waitHand(b, 1)]);
  assert.notDeepEqual(aNext, bNext, "next hand private cards match");

  const before = a.frames.length;
  await a.page.reload({ waitUntil: "domcontentloaded" });
  await a.page.getByText("PRIVATE CHALLENGE", { exact: true }).waitFor({ timeout: 30_000 });
  assert.deepEqual(await hole(a.page), aNext, "multiplayer hole cards changed after refresh");
  await frame(a, (message) => message.type === "snapshot" && message.view?.hand_no === 1, before, "reconnect snapshot missing");
  assert.equal(await a.page.locator(".table-action-notice").count(), 0, "multiplayer reconnect replayed a notice");
  await noticeLog(a);

  const [aChallenge, bChallenge] = await Promise.all([challenge(a.page), challenge(b.page)]);
  for (const trace of [a, b]) {
    const publicState = JSON.stringify(latest(trace));
    for (const item of objectives) {
      assert.equal(publicState.includes(item), false, `${trace.name} snapshot exposed a private objective`);
    }
  }
  await a.page.setViewportSize({ width: 1440, height: 900 });
  await a.page.screenshot({ path: "/tmp/noir-table-desktop.png", fullPage: true });
  await a.page.setViewportSize({ width: 390, height: 844 });
  await a.page.screenshot({ path: "/tmp/noir-table-mobile.png", fullPage: true });
  await a.page.setViewportSize({ width: 1280, height: 720 });

  const picked = aChallenge.index !== 7
    ? { trace: a, viewer: b, objective: aChallenge.index, owner: "Alice" }
    : bChallenge.index !== 7
      ? { trace: b, viewer: a, objective: bChallenge.index, owner: "Bob" }
      : undefined;

  if (picked) await playObjective(picked.trace, picked.objective, a, b, 1);
  else await showdown(a, b, 1);
  await Promise.all([
    frame(a, (message) => message.type === "snapshot" && message.view?.hand_no === 1 && message.view?.settled && message.view?.deal?.audit, 0, "second hand audit missing"),
    frame(b, (message) => message.type === "snapshot" && message.view?.hand_no === 1 && message.view?.settled && message.view?.deal?.audit, 0, "second hand audit missing"),
  ]);
  cardsBeforeActions(a, 1);
  cardsBeforeActions(b, 1);
  await Promise.all([
    waitNotices(a.page, "multiplayer hand 2 a"),
    waitNotices(b.page, "multiplayer hand 2 b"),
  ]);
  await Promise.all([
    checkNoticePacing(a, "multiplayer hand 2 a", 1),
    checkNoticePacing(b, "multiplayer hand 2 b", 1),
  ]);

  const completed = picked ?? await until(async () => {
    for (const choice of [
      { trace: a, viewer: b, objective: aChallenge.index, owner: "Alice" },
      { trace: b, viewer: a, objective: bChallenge.index, owner: "Bob" },
    ]) {
      const button = choice.trace.page.getByRole("button", { name: "Generate Completion Proof" });
      if (await button.count() && await button.isVisible()) return choice;
    }
    return undefined;
  }, "showdown profit challenge not completed");
  const generate = completed.trace.page.getByRole("button", { name: "Generate Completion Proof" });
  await generate.waitFor({ timeout: 30_000 });
  await generate.click();
  await frame(
    completed.trace,
    (message) => message.type === "proof_accepted" && message.kind === "completion" && message.hand_no === 1,
    0,
    "completion proof not accepted",
  );
  await verifyPublic(completed.viewer, completed.owner, "COMPLETION");

  await ca.close();
  await cb.close();
}

function revisions(trace) {
  return trace.frames.flatMap((item) => {
    const message = value(item);
    return item.direction === "received" && message?.type === "snapshot" ? [message.rev] : [];
  });
}

async function noticeLog(trace) {
  const snapshot = latest(trace);
  trace.noticeStart = trace.frames.length;
  trace.noticeBase = new Set(
    (snapshot?.view?.action_notices ?? []).map((item) => `${snapshot.view.hand_no}:${item.seq}`),
  );
  await trace.page.evaluate(() => {
    window.__noticeEvents = [];
    sessionStorage.setItem("__noticeEvents", "[]");
    const observer = new MutationObserver((records) => {
      const notices = (node) => {
        if (!(node instanceof Element)) return [];
        return node.matches(".table-action-notice")
          ? [node]
          : [...node.querySelectorAll(".table-action-notice")];
      };
      for (const record of records) {
        for (const node of record.addedNodes) {
          for (const notice of notices(node)) {
            window.__noticeEvents.push({
              id: `${notice.getAttribute("data-hand")}:${notice.getAttribute("data-seq")}`,
              added: Date.now(),
            });
          }
        }
        for (const node of record.removedNodes) {
          for (const notice of notices(node)) {
            const id = `${notice.getAttribute("data-hand")}:${notice.getAttribute("data-seq")}`;
            const event = window.__noticeEvents.findLast((item) => item.id === id && item.removed === undefined);
            if (event) event.removed = Date.now();
          }
        }
      }
      sessionStorage.setItem("__noticeEvents", JSON.stringify(window.__noticeEvents));
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

function expectedNotices(trace, hand) {
  const expected = new Set();
  for (const item of trace.frames.slice(trace.noticeStart)) {
    const message = value(item);
    if (item.direction !== "received" || message?.type !== "snapshot") continue;
    if (hand !== undefined && message.view?.hand_no !== hand) continue;
    for (const notice of message.view?.action_notices ?? []) {
      const id = `${message.view.hand_no}:${notice.seq}`;
      if (!trace.noticeBase.has(id)) expected.add(id);
    }
  }
  return [...expected].sort();
}

async function waitNotices(page, name) {
  await until(
    async () => await page.locator(".table-action-notice").count() === 0,
    `${name} action notice did not clear`,
  );
}

async function checkNoticePacing(trace, name, hand) {
  const stored = await trace.page.evaluate(() => sessionStorage.getItem("__noticeEvents") ?? "[]");
  const all = JSON.parse(stored);
  const events = all.filter((item) =>
    !trace.noticeBase.has(item.id) && (hand === undefined || item.id.startsWith(`${hand}:`))
  );
  const ids = events.map((item) => item.id);
  assert.equal(ids.length, new Set(ids).size, `${name} repeated action notice`);
  assert.deepEqual([...ids].sort(), expectedNotices(trace, hand), `${name} dropped action notice`);
  for (let i = 0; i < events.length; i += 1) {
    const event = events[i];
    assert.equal(typeof event.removed, "number", `${name} action notice ${event.id} never cleared`);
    const shown = event.removed - event.added;
    assert.ok(
      shown >= 1750,
      `${name} action notice ${event.id} only showed for ${shown}ms ${JSON.stringify(events)}`,
    );
    if (i === 0) continue;
    const gap = event.added - events[i - 1].added;
    assert.ok(gap >= 1750, `${name} action notices ${events[i - 1].id} and ${event.id} overlapped by ${gap}ms`);
  }
}

async function tableStress() {
  const tables = await Promise.all(
    Array.from({ length: 3 }, async (_, index) => {
      const ca = await browser.newContext();
      const cb = await browser.newContext();
      const a = watch(await ca.newPage(), `table-${index + 1}-a`);
      const b = watch(await cb.newPage(), `table-${index + 1}-b`);
      return { index, ca, cb, a, b };
    }),
  );

  try {
    await Promise.all(
      tables.map(async ({ index, a }) => {
        await openLobby(a, "Multiplayer", 2, 0);
        await setName(a.page, `A${index + 1}`);
        await a.page.getByRole("button", { name: "Create Game" }).click();
        await a.page.waitForURL(/\/table\//, { timeout: 15_000 });
      }),
    );

    for (const table of tables) {
      table.room = new URL(table.a.page.url()).pathname.split("/").at(-1);
      assert.match(table.room, /^[0-9A-F]{8}$/);
    }
    assert.equal(new Set(tables.map(({ room }) => room)).size, 3, "table room ids collided");

    await Promise.all(
      tables.map(async ({ index, room, b }) => {
        await b.page.goto(base, { waitUntil: "networkidle" });
        await b.page.getByRole("radio", { name: "Multiplayer" }).check();
        await setName(b.page, `B${index + 1}`, true);
        await b.page.getByLabel("Room ID").fill(room);
        await b.page.getByRole("button", { name: "Join Game" }).click();
        await b.page.waitForURL(new RegExp(`/table/${room}$`), { timeout: 15_000 });
      }),
    );

    await Promise.all(
      tables.map(async (table) => {
        table.holes = await Promise.all([waitHand(table.a, 0), waitHand(table.b, 0)]);
      }),
    );

    for (const { index, room, a, b, holes } of tables) {
      const [aSeat, bSeat] = await Promise.all([
        a.page.evaluate((id) => JSON.parse(sessionStorage.getItem(`noir-poker-room-${id}`)), room),
        b.page.evaluate((id) => JSON.parse(sessionStorage.getItem(`noir-poker-room-${id}`)), room),
      ]);
      assert.notEqual(aSeat.seat, bSeat.seat, `${room} seats collided`);
      assert.notEqual(aSeat.token, bSeat.token, `${room} tokens collided`);
      assert.notDeepEqual(holes[0], holes[1], `${room} private cards crossed seats`);
      assert.equal(latest(a).view.players.length, 2, `${room} creator saw another room`);
      assert.equal(latest(b).view.players.length, 2, `${room} joiner saw another room`);
      assert.deepEqual(
        latest(a).view.players.map((player) => player.name),
        [`A${index + 1}`, `B${index + 1}`],
        `${room} names crossed rooms`,
      );
      assert.deepEqual(
        latest(b).view.players.map((player) => player.name),
        latest(a).view.players.map((player) => player.name),
        `${room} names differ by viewer`,
      );
      await Promise.all([noticeLog(a), noticeLog(b)]);
    }

    await Promise.all(tables.map(({ a, b }) => foldCurrent(a, b, 0)));
    await Promise.all(
      tables.flatMap(({ a, b }) =>
        [a, b].map((trace) =>
          frame(
            trace,
            (message) => message.type === "snapshot" && message.view?.hand_no === 0 && message.view?.settled,
            0,
            "fold settlement missing",
          ),
        ),
      ),
    );
    await Promise.all(
      tables.flatMap(({ a, b }) => [a.page.waitForTimeout(2500), b.page.waitForTimeout(2500)]),
    );

    for (const { room, a, b } of tables) {
      const ar = revisions(a);
      const br = revisions(b);
      assert.ok(ar.length > 1 && br.length > 1, `${room} revision history missing`);
      assert.ok(ar.every((rev, index) => index === 0 || rev >= ar[index - 1]), `${room} creator revision regressed`);
      assert.ok(br.every((rev, index) => index === 0 || rev >= br[index - 1]), `${room} joiner revision regressed`);
      assert.equal(ar.at(-1), br.at(-1), `${room} final revisions differ`);
      assert.equal(latest(a).view.hand_no, 0, `${room} creator crossed rooms`);
      assert.equal(latest(b).view.hand_no, 0, `${room} joiner crossed rooms`);
      for (const page of [a.page, b.page]) {
        assert.equal(await page.locator(".table-action-notice").count(), 0, `${room} stale action notice`);
      }
      await Promise.all([
        checkNoticePacing(a, `${room} creator`, 0),
        checkNoticePacing(b, `${room} joiner`, 0),
      ]);
    }

    await Promise.all(
      tables.flatMap(({ a, b }) =>
        [a, b].map((trace) =>
          trace.page.getByRole("button", { name: "Finish Game" }).waitFor({ timeout: 240_000 }),
        ),
      ),
    );
    await Promise.all(
      tables.map(async ({ a }) => {
        await a.page.getByRole("button", { name: "Finish Game" }).click();
        await a.page.getByRole("button", { name: "Finished 1/2" }).waitFor({ timeout: 15_000 });
        assert.equal(Boolean(latest(a).view.game_over), false, "first finish ended table");
      }),
    );
    await Promise.all(
      tables.map(({ b }) => b.page.getByRole("button", { name: "Finish Game" }).click()),
    );
    await Promise.all(
      tables.flatMap(({ a, b }) =>
        [a, b].map((trace) =>
          frame(
            trace,
            (message) => message.type === "snapshot" && Boolean(message.view?.game_over),
            0,
            "final game snapshot missing",
          ),
        ),
      ),
    );

    for (const { index, room, a, b } of tables) {
      const av = latest(a);
      const bv = latest(b);
      assert.equal(av.rev, bv.rev, `${room} final finish revisions differ`);
      assert.deepEqual(av.view.game_over, bv.view.game_over, `${room} final result differs`);
      assert.ok(av.view.players.every((player) => player.challenge_bonus > 0), `${room} bonuses missing`);
      assert.deepEqual(
        av.view.players.map((player) => player.challenge_bonus),
        bv.view.players.map((player) => player.challenge_bonus),
        `${room} bonuses differ by viewer`,
      );
      assert.deepEqual(
        av.view.players.map((player) => player.name),
        [`A${index + 1}`, `B${index + 1}`],
        `${room} creator names changed`,
      );
      assert.deepEqual(
        bv.view.players.map((player) => player.name),
        av.view.players.map((player) => player.name),
        `${room} final names differ by viewer`,
      );
    }
    await Promise.all(
      tables.flatMap(({ a, b }) =>
        [a, b].map((trace) => trace.page.waitForURL(`${base}/`, { timeout: 10_000 })),
      ),
    );
  } finally {
    await Promise.all(tables.flatMap(({ ca, cb }) => [ca.close(), cb.close()]));
  }
}

try {
  const mode = process.env.STRESS_MODE;
  if (!mode || mode === "single") await singleStress();
  if (!mode || mode === "multiplayer") await multiplayerStress();
  if (!mode || mode === "tables") await tableStress();
  assert.deepEqual(errors, []);
  process.stdout.write("ui stress passed\n");
} catch (error) {
  for (const trace of traces) {
    const tail = trace.frames.slice(-12).map((item) => ({
      direction: item.direction,
      at: item.at,
      message: value(item),
    }));
    process.stderr.write(`${trace.name} ${JSON.stringify(tail, null, 2)}\n`);
  }
  process.stderr.write(`${errors.join("\n")}\n`);
  throw error;
} finally {
  await browser.close();
}
