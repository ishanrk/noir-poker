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
  socket.on("framereceived", ({ payload }) => frames.push({ direction: "received", payload }));
  socket.on("framesent", ({ payload }) => frames.push({ direction: "sent", payload }));
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
  "The game server cannot cheat even if it wanted to.",
  "Rust backend, Next.js and TypeScript frontend, Noir zero knowledge circuits.",
  "Create a game",
]);

async function waitForFrame(match, message, after = 0) {
  for (let attempt = 0; attempt < 150; attempt += 1) {
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
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (await locator.isEnabled()) return;
    await page.waitForTimeout(100);
  }

  throw new Error(message);
}

if (process.env.SINGLE_PLAYER_SMOKE === "1") {
  await page.getByRole("radio", { name: "Multiplayer" }).check();
  assert.equal(await page.getByRole("radio", { name: "Multiplayer" }).isChecked(), true);
  assert.equal(await page.getByText("One human plus", { exact: false }).count(), 0);
  await page.getByRole("heading", { name: "Join game" }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Create game" }).waitFor({ state: "visible" });

  await page.getByRole("radio", { name: "Single Player" }).check();
  assert.equal(await page.getByRole("radio", { name: "Single Player" }).isChecked(), true);
  assert.equal(await page.getByRole("heading", { name: "Join game" }).count(), 0);
  await page.getByRole("radio", { name: "2" }).check();
  assert.equal(await page.getByRole("button", { name: "Connect Aztec" }).count(), 0);
  await page.getByRole("button", { name: "Create game" }).click();
  await page.waitForURL(/\/table\//, { timeout: 15_000 });

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
  await page.getByText("Bot 1", { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
  const snapshot = await waitForFrame(
    (direction, message) => direction === "received" && message.type === "snapshot",
    "single snapshot missing",
  );
  const rev = JSON.parse(frames[snapshot].payload).rev;
  const call = page.getByRole("button", { name: /^Call/ });
  await waitForEnabled(call, "call unavailable");
  const afterCall = frames.length;
  await call.click();
  await waitForFrame(
    (direction, message) => direction === "received" && message.type === "snapshot" && message.rev >= rev + 2,
    "bot action missing",
    afterCall,
  );
  const fold = page.getByRole("button", { name: "Fold" });
  await waitForEnabled(fold, "bot did not return action");
  await fold.click();
  await page.getByText("Hand complete", { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
  await page.getByRole("button", { name: "Draw challenge" }).waitFor({ state: "visible", timeout: 15_000 });
  await visit("/", "home-after-single", ["Create a game"]);
}

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
await visit("/rules", "rules", [
  "Bluff and win with seven-deuce",
  "These are the same challenge controls shown at the poker table.",
  "Challenge missed",
  "No completion proof +0",
  "+20 proof points",
  "Export JSON",
]);
await visit("/motivation", "motivation", [
  "At a physical table you can see a dealer shuffle",
  "UltimateBet and Absolute Poker",
  "crypto.getRandomValues",
  "Private challenges are an extra rule in this game",
  "Limitations",
]);
await visit("/protocol", "protocol", [
  "How verification works",
  "There are two checks",
  "/audit/<room>/<hand>",
  "/proof/<nullifier>",
  "UltraHonk",
  "Where the poker program fits",
  "Limitations",
]);
await visit("/chips", "chips", [
  "Aztec testnet",
  "Private chips for Aztec tables.",
]);

await browser.close();

if (errors.length > 0) {
  throw new Error(errors.join("\n"));
}
