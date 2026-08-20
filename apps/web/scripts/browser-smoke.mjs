import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright";

const base = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const output = process.env.SMOKE_DIR ?? "artifacts/branch-validation/browser";
const errors = [];
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });

page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") {
    errors.push(message.text());
  }
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
  "Challenge missed. No proof can be generated.",
  "+0 proof points",
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
