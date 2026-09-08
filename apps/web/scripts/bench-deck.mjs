import { performance } from 'node:perf_hooks';
import { canonicalDeck, publicKey, shuffleDeck, openCard } from '../lib/deck-crypto.ts';
import { proveShuffle, verifyShuffle } from '../lib/deck-proof.ts';
const key = await publicKey('0x' + '07'.padStart(64, '0'));
const input = await canonicalDeck();
const openingStart = performance.now();
for (let repeat = 0; repeat < 3; repeat++) for (let i = 0; i < 52; i++) {
  if (await openCard(input[i], []) !== i) throw new Error('Bad canonical opening');
}
console.log(JSON.stringify({ kind: 'open-canonical', samples: 156, ms: performance.now() - openingStart }));
for (let hand = 0; hand < 3; hand++) {
  const start = performance.now();
  const shuffled = await shuffleDeck(input, key);
  const data = { hand, seat: 0, context: '01'.repeat(32), input, key, ...shuffled };
  const stages = [];
  const proof = await proveShuffle(data, stage => stages.push({ stage, ms: performance.now() - start }));
  const proven = performance.now();
  if (!await verifyShuffle(data, proof.proof, proof.public_inputs)) throw new Error('Proof failed');
  let rejected = false;
  try { await verifyShuffle({ ...data, hand: hand + 1 }, proof.proof, proof.public_inputs); }
  catch { rejected = true; }
  if (!rejected) throw new Error('Wrong hand accepted');
  console.log(JSON.stringify({ kind: 'proof', hand, stages, proveMs: proven - start, verifyMs: performance.now() - proven, rss: process.memoryUsage().rss }));
}
process.exit(0);
