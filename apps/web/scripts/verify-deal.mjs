import { readFile } from "node:fs/promises";

import { verifyDealAudit } from "../lib/deal.ts";

const input = process.argv[2];
if (!input) throw new Error("usage npm run deal:verify -- audit.json-or-url [participant.json]");

const audit = /^https?:\/\//.test(input)
  ? await fetch(input).then(async (response) => {
      if (!response.ok) throw new Error(`audit request failed ${response.status}`);
      return response.json();
    })
  : JSON.parse(await readFile(input, "utf8"));

const evidence = process.argv[3] ? JSON.parse(await readFile(process.argv[3], "utf8")) : undefined;
const result = verifyDealAudit(audit, evidence);
process.stdout.write(
  `${result.transcript}; ${result.participant}; room=${audit.room} hand=${audit.hand_no}\n`,
);
if (!evidence) process.stdout.write("This does not establish what a participant recorded before play\n");
