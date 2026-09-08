import assert from 'node:assert/strict';
import { ProofQueue } from '../lib/proof-queue.ts';
import { DeckInbox } from '../lib/deck-inbox.ts';
import { DeckWorkerClient } from '../lib/deck-worker-client.ts';
import { prepareSounds, playPickupSound, playErrorSound, setMuted, subscribeMute } from '../lib/ui-audio.ts';
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
let release;
const order = [];
const queue = new ProofQueue();
const first = queue.run(2, () => new Promise(resolve => { release = resolve; order.push('running'); }));
const audit = queue.run(2, async () => order.push('audit'));
const optional = queue.run(1, async () => order.push('challenge'));
const mandatory = queue.run(0, async () => order.push('deal'));
release(); await Promise.all([first, audit, optional, mandatory]);
assert.deepEqual(order, ['running', 'deal', 'challenge', 'audit']);
await assert.rejects(queue.run(0, async () => { throw Error('failed'); }), /failed/);
assert.equal(await queue.run(0, async () => 42), 42);
const held = queue.run(0, () => new Promise(resolve => { release = resolve; }));
await tick();
const waiting = Array.from({ length: 16 }, () => queue.run(1, async () => 1));
await assert.rejects(queue.run(0, async () => 0), /busy/);
release(); await held; await Promise.all(waiting);
const abort = new AbortController();
const running = queue.run(0, () => new Promise(resolve => { release = resolve; }));
let cancelledRan = false;
const cancelled = queue.run(1, async () => { cancelledRan = true; }, abort.signal);
const cancelledCheck = assert.rejects(cancelled, /ended/);
abort.abort(); await cancelledCheck;
release(); await running; await tick();
assert.equal(cancelledRan, false);

const accepted = []; let failures = 0;
let priorHandStillCurrent;
const inbox = new DeckInbox(async (message, current) => {
  accepted.push(message.hand_no);
  if (message.hand_no === 0) {
    await new Promise(resolve => { release = resolve; });
    priorHandStillCurrent = current();
  }
}, () => failures++);
inbox.push({ type: 'deck_key', hand_no: 0 });
inbox.push({ type: 'deck_shuffle', hand_no: 1 });
inbox.push({ type: 'deck_shuffle', hand_no: 1 });
release(); await tick();
assert.deepEqual(accepted, [0, 1]);
assert.equal(priorHandStillCurrent, false, 'New observed hand invalidates an in-flight old result');
inbox.push({ type: 'deck_key', hand_no: 0 });
assert.deepEqual(accepted, [0, 1]);
inbox.push({ type: 'deck_key', hand_no: 4 }); await tick();
assert.equal(failures, 1);
inbox.push({ type: 'deck_key', hand_no: 2 }); await tick();
assert.deepEqual(accepted, [0, 1]);

globalThis.requestAnimationFrame = callback => setTimeout(callback, 0);
const workers = [];
globalThis.Worker = class {
  constructor() { workers.push(this); }
  postMessage(input) { this.input = input; }
  terminate() { this.stopped = true; }
};
const client = new DeckWorkerClient();
const old = client.prove({ hand: 0 }, () => {});
const rejection = assert.rejects(old, /session ended/);
await new Promise(resolve => setTimeout(resolve, 15));
client.close(); await rejection;
assert.equal(workers[0].stopped, true);
const replacement = new DeckWorkerClient();
const next = replacement.prove({ hand: 1 }, () => {});
await new Promise(resolve => setTimeout(resolve, 15));
workers[0].onmessage?.({ data: { result: { proof: 'old' } } });
workers[1].onmessage({ data: { result: { proof: 'new' } } });
assert.equal((await next).proof, 'new');
replacement.close();

const voices = []; const plays = [];
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.Audio = class {
  constructor(src) { this.src = src; voices.push(this); }
  load() {}
  pause() { this.paused = true; }
  removeAttribute() { this.src = ''; }
  play() { plays.push({ src: this.src, at: performance.now() }); return Promise.resolve(); }
};
const dispose = prepareSounds();
const at = performance.now(); playPickupSound(); playPickupSound();
assert.equal(plays.length, 2); // Synchronous scheduling, no timer or lost activation.
assert.ok(plays[0].at - at < 20);
let muteUpdates = 0; const unsubscribe = subscribeMute(() => muteUpdates++);
setMuted(true); playPickupSound(); assert.equal(plays.length, 2);
setMuted(false); playErrorSound();
assert.equal(muteUpdates, 2); unsubscribe();
assert.ok(plays.at(-1).src.includes('error'));
dispose(); assert.ok(voices.every(voice => voice.src === ''));
console.log('State, priority, stale worker and audio scheduling checks passed. Audio was mocked.');
