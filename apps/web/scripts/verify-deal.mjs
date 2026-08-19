import { readFile } from "node:fs/promises";

import { verifyDealAudit } from "../lib/deal.ts";

const input = process.argv[2];
if (!input) throw new Error("usage npm run deal:verify -- audit.json-or-url");

const audit = /^https?:\/\//.test(input)
  ? await fetch(input).then(async (response) => {
      if (!response.ok) throw new Error(`audit request failed ${response.status}`);
      return response.json();
    })
  : JSON.parse(await readFile(input, "utf8"));

const result = verifyDealAudit(audit);
process.stdout.write(
  `verified room=${audit.room} hand=${audit.hand_no} cards=${result.deck.length}\n`,
);
