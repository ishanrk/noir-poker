import { readFile } from "node:fs/promises";

import { verifyDeck } from "../lib/deck-audit.ts";
import { verifyDealAudit } from "../lib/deal.ts";
import { disposeDeckRuntime } from "../lib/deck-runtime.ts";

const input = process.argv[2];
if (!input) throw new Error("usage npm run deal:verify -- audit.json-or-url");

try {
const audit = /^https?:\/\//.test(input)
  ? await fetch(input).then(async (response) => {
      if (!response.ok) throw new Error(`audit request failed ${response.status}`);
      return response.json();
    })
  : JSON.parse(await readFile(input, "utf8"));

  if (!audit || typeof audit !== "object") throw new Error("invalid receipt object");
  const result = Array.isArray(audit.shuffles)
    ? await verifyDeck(audit, (value) => process.stderr.write(`${value}\n`))
    : verifyDealAudit(audit);
  process.stdout.write(`verified room=${audit.room} hand=${audit.hand_no} cards=${result.deck.length}\n`);
} catch (error) {
  process.stderr.write(`verification failed: ${error instanceof Error ? error.message : "invalid receipt"}\n`);
  process.exitCode = 1;
} finally {
  await disposeDeckRuntime();
}
process.exit(process.exitCode ?? 0);
