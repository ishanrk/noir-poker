import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { verifyDeck } from '../lib/deck-audit.ts';
import { disposeDeckRuntime } from '../lib/deck-runtime.ts';
const audit = JSON.parse(await readFile(process.argv[2], 'utf8'));
try {
  assert.equal((await verifyDeck(audit, () => {})).deck.length, 52);
  const cases = [
    ['unsupported', value => { value.protocol_version = 999; }, /unsupported/],
    ['incomplete', value => { delete value.records; }, /incomplete/],
    ['wrong hand', value => { value.hand_no++; }, /invalid|mismatch/],
    ['tampered chain', value => { value.transcript_hash = '00'.repeat(32); }, /invalid|mismatch/],
    ['tampered public input', value => { const bytes = Buffer.from(value.shuffles[0].public_inputs, 'base64'); bytes[31] ^= 1; value.shuffles[0].public_inputs = bytes.toString('base64'); }, /invalid|mismatch/],
    ['invalid native proof', value => { const bytes = Buffer.from(value.shuffles[0].proof, 'base64'); bytes[bytes.length - 1] ^= 1; value.shuffles[0].proof = bytes.toString('base64'); }, /invalid|mismatch/],
  ];
  for (const [label, change, expected] of cases) {
    const value = structuredClone(audit); change(value);
    await assert.rejects(verifyDeck(value, () => {}), expected);
    console.log(`${label}: rejected`);
  }
} finally { await disposeDeckRuntime(); }
process.exit(0);
