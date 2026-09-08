import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright";

const base = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const output = process.env.SMOKE_DIR ?? "artifacts/branch-validation/browser";
const errors = [];
const frames = [];
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });

page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") {
    errors.push(message.text());
  }
});
page.on("websocket", (socket) => {
  socket.on("framereceived", ({ payload }) => frames.push({ direction: "received", payload, at: Date.now() }));
  socket.on("framesent", ({ payload }) => frames.push({ direction: "sent", payload, at: Date.now() }));
});

await mkdir(output, { recursive: true });

async function visit(route, name, expected) {
  const response = await page.goto(`${base}${route}`, { waitUntil: "networkidle" });

  assert.equal(response?.ok(), true, `${route} did not load`);

  for (const value of expected) {
    await page
      .getByText(value, { exact: false })
      .first()
      .waitFor({ state: "visible", timeout: 15_000 });
  }

  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }

  await page.screenshot({
    path: path.join(output, `${name}.png`),
    fullPage: true,
  });
}

await visit("/", "home", [
  "Poker where the server cannot cheat even if it wanted to.",
  "Written in",
  "Create a game",
]);

async function waitForFrame(match, message, after = 0) {
  for (let attempt = 0; attempt < 1200; attempt += 1) {
    const index = frames.slice(after).findIndex((frame) => {
      if (typeof frame.payload !== "string") return false;

      try {
        return match(frame.direction, JSON.parse(frame.payload));
      } catch {
        return false;
      }
    });

    if (index >= 0) return after + index;
    await page.waitForTimeout(100);
  }

  throw new Error(message);
}

async function waitForEnabled(locator, message) {
  for (let attempt = 0; attempt < 1200; attempt += 1) {
    if (await locator.isEnabled()) return;
    await page.waitForTimeout(100);
  }

  throw new Error(message);
}

if (process.env.SINGLE_PLAYER_SMOKE === "1") {
  await page.getByRole("radio", { name: "Multiplayer" }).check();
  assert.equal(await page.getByRole("radio", { name: "Multiplayer" }).isChecked(), true);
  assert.equal(await page.getByText("One human plus", { exact: false }).count(), 0);
  await page.getByRole("heading", { name: "Join Game" }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Create Game" }).waitFor({ state: "visible" });

  await page.getByRole("radio", { name: "Single Player" }).check();
  assert.equal(await page.getByRole("radio", { name: "Single Player" }).isChecked(), true);
  assert.equal(await page.getByRole("heading", { name: "Join Game" }).count(), 0);
  await page.getByRole("radio", { name: "2", exact: true }).check();
  assert.equal(await page.getByRole("button", { name: "Connect Aztec" }).count(), 0);
  await page.getByRole("button", { name: "Create Game" }).click();
  await page.waitForURL(/\/table\//, { timeout: 15_000 });
  assert.equal(await page.getByText("Waiting for every player to join.", { exact: true }).count(), 0);

  const commitment = await waitForFrame(
    (direction, message) =>
      direction === "received" &&
      message.type === "waiting_fair" &&
      message.mode === "single" &&
      message.deal.mine === false,
    "single commitment missing",
  );
  const entropy = await waitForFrame(
    (direction, message) => direction === "sent" && message.type === "deal_entropy",
    "single entropy missing",
  );

  assert.ok(commitment < entropy, "entropy preceded commitment");
  await page.getByText("Bot 1", { exact: true }).waitFor({ state: "visible", timeout: 120_000 });
  const snapshot = await waitForFrame(
    (direction, message) => direction === "received" && message.type === "snapshot",
    "single snapshot missing",
  );
  const rev = JSON.parse(frames[snapshot].payload).rev;
  const call = page.getByRole("button", { name: /^Call/ });
  await waitForEnabled(call, "call unavailable");
  const afterCall = frames.length;
  await call.click();
  const callSnapshot = await waitForFrame(
    (direction, message) => direction === "received" && message.type === "snapshot" && message.rev >= rev + 1,
    "player action missing",
    afterCall,
  );
  const botSnapshot = await waitForFrame(
    (direction, message) => direction === "received" && message.type === "snapshot" && message.rev >= rev + 2,
    "bot action missing",
    afterCall,
  );
  assert.ok(frames[botSnapshot].at - frames[callSnapshot].at >= 1800, "bot action skipped pause");
  const actionNotices = JSON.parse(frames[botSnapshot].payload).view.action_notices;
  assert.deepEqual(actionNotices.slice(-2).map(({ player }) => player), [0, 1]);
  const fold = page.getByRole("button", { name: "Fold" });
  await waitForEnabled(fold, "bot did not return action");
  const afterFold = frames.length;
  await fold.click();
  const foldSnapshot = await waitForFrame(
    (direction, message) => direction === "received" && message.type === "snapshot" && message.view?.last_action?.action === "fold",
    "fold notice missing",
    afterFold,
  );
  const deckOpen = await waitForFrame(
    (direction, message) => direction === "received" && message.type === "deck_open",
    "final deck opening missing",
    foldSnapshot + 1,
  );
  assert.ok(frames[deckOpen].at - frames[foldSnapshot].at >= 1800, "fold notice skipped pause");
  await page.getByText("Hand complete", { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
  assert.equal(await page.getByText("PRIVATE CHALLENGE", { exact: true }).count(), 0);
  assert.equal(await page.getByText("CHALLENGE PROOFS", { exact: true }).count(), 0);
  await page.waitForTimeout(1200);
  assert.equal(frames.some((frame) => {
    if (frame.direction !== "sent" || typeof frame.payload !== "string") return false;
    const message = JSON.parse(frame.payload);
    return message.type === "challenge_draw" || message.type === "challenge_claim";
  }), false);
  const ready = page.getByRole("button", { name: "Ready for Next Hand" });
  await ready.waitFor({ state: "visible", timeout: 30_000 });
  await waitForEnabled(ready, "next hand unavailable");
  const afterReady = frames.length;
  await ready.click();
  const nextHand = await waitForFrame(
    (direction, message) =>
      direction === "received" &&
      message.type === "snapshot" &&
      message.view?.hand_no === 1,
    "next hand missing",
    afterReady,
  );
  const nextKeys = frames.slice(afterReady, nextHand + 1).filter((frame) => {
    if (frame.direction !== "sent" || typeof frame.payload !== "string") return false;
    const message = JSON.parse(frame.payload);
    return message.type === "deck_key" && message.hand_no === 1;
  });
  assert.equal(nextKeys.length, 1, "next hand deck key repeated");
  assert.equal(frames.slice(afterReady, nextHand + 1).some((frame) => {
    if (frame.direction !== "received" || typeof frame.payload !== "string") return false;
    const message = JSON.parse(frame.payload);
    return message.type === "error" && message.message === "invalid deck key";
  }), false, "next hand deck key rejected");
  await page.getByText("Deck Randomness Proof — Hand 1", { exact: true }).waitFor({ state: "visible", timeout: 120_000 });
  assert.equal(await page.getByText("Deck Randomness Proof — Hand 1", { exact: true }).count(), 1);
  await visit("/", "home-after-single", ["Create a game"]);
}

if (process.env.SINGLE_PLAYER_SMOKE !== "1") {
  await page.getByRole("radio", { name: /Aztec/ }).check();
  // wait for lazy wallet ui
  await page
    .getByRole("button", { name: "Connect Aztec" })
    .waitFor({ state: "visible", timeout: 15_000 });
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
  assert.equal(
    await page.getByRole("button", { name: "Connect Aztec" }).isVisible(),
    true,
    "Aztec controls did not load",
  );
  await visit("/chips", "chips", [
    "Aztec testnet",
    "Private test credits on Aztec",
  ]);
}

await browser.close();

if (errors.length > 0) {
  throw new Error(errors.join("\n"));
}
