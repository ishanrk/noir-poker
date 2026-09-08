import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const base = process.env.BASE_URL ?? 'http://127.0.0.1:3140';
const api = process.env.SERVER_URL ?? 'http://127.0.0.1:3141';
for (const url of [base, api]) if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw Error('Local tests only');
const output = process.env.POLISH_OUT ?? '../../.local/polish/reliability';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(test, label, ms = 150000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await test()) return; await pause(100); }
  throw Error(`Timeout: ${label}`);
}
async function client(name) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await context.addInitScript(() => {
    sessionStorage.setItem('noir-diagnostics', '1');
    window.testSamples = { sounds: [], tasks: [] };
    let activation = 0;
    document.addEventListener('click', () => { activation = performance.now(); }, true);
    document.addEventListener('input', () => { activation = performance.now(); }, true);
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      window.testSamples.sounds.push({ delay: performance.now() - activation, error: this.src.includes('error') });
      return play.call(this);
    };
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) window.testSamples.tasks.push({ start: entry.startTime, duration: entry.duration });
    }).observe({ type: 'longtask', buffered: true });
  });
  const page = await context.newPage();
  const state = { page, context, name, latest: undefined, phase: undefined, transport: undefined, hold: false, held: undefined, errors: [], tamper: false };
  page.on('pageerror', error => state.errors.push(error.message));
  await page.routeWebSocket(/\/rooms\//, socket => {
    state.transport = socket;
    const server = socket.connectToServer();
    server.onMessage(raw => {
      const message = JSON.parse(String(raw));
      if (message.type === 'snapshot') state.latest = message.view;
      if (message.type === 'deck_shuffle') state.shuffleHand = message.hand_no;
      if (state.disconnectOpening && message.type === 'deck_open') {
        state.disconnectOpening = false; state.acceptedBeforeDisconnect = true;
        socket.close({ code: 1001, reason: 'Local lost acknowledgement fixture' }); return;
      }
      if (process.env.TRACE_PUBLIC === '1') console.log(name, message.type, message.stage ?? '', message.view?.hand_no ?? message.hand_no ?? '', Boolean(message.view?.actions));
      state.phase = message.stage ?? message.type;
      socket.send(raw);
    });
    socket.onMessage(raw => {
      const message = JSON.parse(String(raw));
      if (state.tamper && message.type === 'deck_shuffle') {
        state.tamper = false;
        const bytes = Buffer.from(message.public_inputs, 'base64'); bytes[31] ^= 1;
        server.send(JSON.stringify({ ...message, public_inputs: bytes.toString('base64') }));
      } else if (state.holdShuffle && message.type === 'deck_shuffle') state.heldShuffle = true;
      else if (state.hold && ['wager', 'ready_hand'].includes(message.type)) state.held = () => server.send(raw);
      else server.send(raw);
    });
  });
  await page.goto(base, { waitUntil: 'networkidle' });
  return state;
}
async function act(c, label) {
  const button = c.page.getByRole('button', { name: label === 'Call' ? /^Call(?:\s|$)/ : label, exact: label !== 'Call' });
  await until(() => button.isEnabled(), `enabled ${label}`);
  const before = c.latest;
  await button.click();
  return before;
}
async function botGame(players, hands) {
  const c = await client(`bot-${players}`);
  const { page } = c;
  await page.locator(`input[name=players][value="${players}"]`).check();
  const slider = page.locator('.hand-scale input[type=range]');
  await slider.fill(hands === 1 ? '0' : '1');
  const at = performance.now();
  const create = page.getByRole('button', { name: 'Create Game', exact: true });
  await create.focus(); await page.keyboard.press('Enter');
  await page.waitForURL(/\/table\//);
  await page.getByRole('region', { name: 'Hand preparation' }).waitFor({ state: 'visible' });
  await page.screenshot({ path: `${output}/${c.name}-preparing.png`, fullPage: true });
  await until(() => c.latest?.actions, 'first action');
  results.push({ kind: 'first-action', players, ms: performance.now() - at });
  for (let hand = 0; hand < hands; hand++) {
    await until(() => c.latest?.hand_no === hand && c.latest?.actions, 'hand ready');
    if (hand === 0) {
      c.hold = true;
      await act(c, c.latest.actions.check ? 'Check' : 'Call');
      await until(() => c.held, 'held wager');
      await page.getByText('Sending your action', { exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Fold', exact: true }).isDisabled(), true);
      await page.screenshot({ path: `${output}/${c.name}-submitting.png`, fullPage: true });
      const pendingView = c.latest;
      c.hold = false; c.held(); c.held = undefined;
      await until(() => c.latest !== pendingView, 'released wager accepted');
    }
    while (!c.latest?.settled) {
      await until(() => c.latest?.settled || c.latest?.actions, 'bot or player turn');
      if (c.latest.settled) break;
      const before = await act(c, hand < hands - 1 ? 'Fold' : c.latest.actions.check ? 'Check' : 'Call');
      await until(() => c.latest !== before, 'accepted wager');
    }
    await until(() => c.latest?.deal?.audit, 'completed opening');
    await page.getByRole('link', { name: /Check this deal/i }).first().waitFor();
    if (hand < hands - 1) {
      const next = performance.now();
      await act(c, 'Next hand');
      await until(() => c.latest?.hand_no === hand + 1 && c.latest?.actions, 'next hand');
      results.push({ kind: 'next-hand', hand: hand + 1, players, ms: performance.now() - next });
    }
  }
  // Check a saved complete hand without exporting any live packet.
  const room = new URL(page.url()).pathname.split('/').at(-1);
  const response = await fetch(`${api}/audits/${room}/0`);
  assert.equal(response.ok, true);
  await writeFile(`${output}/completed-${players}.json`, JSON.stringify(await response.json()));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${output}/${c.name}-narrow.png`, fullPage: true });
  const sample = await page.evaluate(() => ({ ...window.testSamples, diagnostics: window.noirDiagnosticSamples?.() ?? [] }));
  assert.ok(sample.sounds.length > 0);
  assert.ok(sample.sounds.filter(s => !s.error).every(s => s.delay < 50), 'Immediate scheduling');
  results.push({ kind: 'browser', players, ...sample, errors: c.errors });
  assert.deepEqual(c.errors, []);
  await c.context.close();
}
async function friends() {
  const alice = await client('alice');
  const bob = await client('bob');
  const key = crypto.randomUUID();
  const body = { request_key: key, mode: 'multiplayer', name: 'Alice', players: 2, stack: 1000, small_blind: 5, big_blind: 10, hands: 1, entropy: '12'.repeat(32) };
  const create = () => fetch(`${api}/rooms`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
  const seat = await create();
  assert.deepEqual(await create(), seat);
  async function enter(c, auth) {
    await c.page.evaluate(auth => sessionStorage.setItem(`noir-poker-room-${auth.room}`, JSON.stringify({ seat: auth.seat, token: auth.token })), auth);
    await c.page.goto(`${base}/table/${auth.room}`);
  }
  await enter(alice, seat);
  await alice.page.getByText('Waiting for 1 of 2 players', { exact: true }).first().waitFor();
  const joined = await fetch(`${api}/rooms/${seat.room}/join`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ request_key: crypto.randomUUID(), name: 'Bob', entropy: '34'.repeat(32) }) }).then(r => r.json());
  await enter(bob, joined);
  // Disconnect while mandatory preparation is in flight, then reconcile the same seat.
  await until(() => ['deck_shuffle', 'server shuffle', 'waiting for another participant'].includes(alice.phase), 'preparation stage');
  alice.transport.close({ code: 1001, reason: 'Local test disconnect' });
  await until(() => alice.page.getByRole('button', { name: 'Reconnect', exact: true }).isVisible(), 'reconnect control');
  await alice.page.getByRole('button', { name: 'Reconnect', exact: true }).click();
  await until(() => alice.latest?.actions || bob.latest?.actions, 'friend legal action');
  const actor = alice.latest?.actions ? alice : bob;
  await act(actor, 'Fold');
  await until(() => alice.latest?.deal?.audit && bob.latest?.deal?.audit, 'friend opening');
  results.push({ kind: 'friends', independentContexts: 2, reconnectDuringPreparation: true });
  assert.deepEqual(alice.errors, []); assert.deepEqual(bob.errors, []);
  await alice.context.close(); await bob.context.close();
}
async function invalidProof() {
  const c = await client('invalid-proof');
  c.tamper = true;
  await c.page.getByRole('button', { name: 'Create Game', exact: true }).click();
  await c.page.waitForURL(/\/table\//);
  await until(() => c.page.getByRole('button', { name: 'Reconnect', exact: true }).isVisible(), 'invalid proof rejected');
  assert.equal(c.latest?.actions, undefined);
  await c.page.screenshot({ path: `${output}/invalid-proof.png`, fullPage: true });
  await c.page.getByRole('button', { name: 'Reconnect', exact: true }).click();
  await until(() => c.latest?.actions, 'valid proof after reconnect');
  const old = c.transport;
  old.close({ code: 1001, reason: 'Local active hand disconnect' });
  await c.page.getByRole('button', { name: 'Reconnect', exact: true }).waitFor();
  await c.page.getByRole('button', { name: 'Reconnect', exact: true }).click();
  await until(() => c.transport !== old && c.latest?.actions, 'active reconnect');
  await act(c, 'Fold');
  await until(() => c.latest?.deal?.audit, 'reconnected completed receipt');
  results.push({ kind: 'invalid-proof', boundValueRejected: true, freshProofAccepted: true, activeReconnect: true });
  await c.context.close();
}
async function restart() {
  const c = await client('restart');
  await c.page.getByRole('button', { name: 'Create Game', exact: true }).click();
  await c.page.waitForURL(/\/table\//);
  await until(() => c.latest?.actions, 'restart first action');
  await act(c, 'Fold');
  await until(() => c.latest?.deal?.audit, 'restart completed opening');
  const room = new URL(c.page.url()).pathname.split('/').at(-1);
  const completed = await fetch(`${api}/audits/${room}/0`).then(r => r.json());
  await act(c, 'Next hand');
  await until(() => c.shuffleHand === 1, 'restart incomplete shuffle');
  // The runner now restarts only its own local server process. No remote control endpoint.
  await writeFile(`${output}/restart-ready.json`, JSON.stringify({ room, completedHand: 0 }));
  await until(async () => {
    try { return (await fetch(`${api}/rooms/${room}/status`).then(r => r.json())).code === 'server_restart'; }
    catch { return false; }
  }, 'local server restarted');
  await c.page.getByRole('button', { name: 'Reconnect', exact: true }).click();
  await c.page.getByText(/This room ended after a server restart/).first().waitFor();
  const restored = await fetch(`${api}/audits/${room}/0`).then(r => r.json());
  assert.deepEqual(restored, completed);
  assert.equal((await fetch(`${api}/audits/${room}/1`)).ok, false);
  await c.page.screenshot({ path: `${output}/restart-interrupted.png`, fullPage: true });
  results.push({ kind: 'restart', incompleteRetired: true, completedReceiptUnchanged: true, ordinaryChips: 'room scoped, no transfer or fabricated payout' });
  await c.context.close();
}
async function slow() {
  const c = await client('slow'); c.holdShuffle = true;
  await c.page.getByRole('button', { name: 'Create Game', exact: true }).click();
  await c.page.waitForURL(/\/table\//);
  const roomURL = c.page.url();
  await until(() => c.heldShuffle, 'delayed shuffle submission');
  await c.page.getByText('Proof details', { exact: true }).first().click();
  await c.page.getByText(/Preparation is still running/).waitFor({ timeout: 30000 });
  await c.page.getByRole('button', { name: 'Mute sound', exact: true }).first().click();
  await c.page.getByRole('button', { name: 'Enable sound', exact: true }).first().waitFor();
  await c.page.screenshot({ path: `${output}/slow-preparation.png`, fullPage: true });
  await c.page.getByRole('link', { name: 'Return to lobby', exact: true }).first().click();
  await c.page.waitForURL(base + '/');
  c.holdShuffle = false;
  await c.page.goto(roomURL);
  await until(() => c.latest?.actions, 'fresh shuffle after returning');
  await act(c, 'Fold');
  await until(() => c.latest?.deal?.audit, 'slow fixture completed opening');
  results.push({ kind: 'slow', fixture: 'outgoing shuffle withheld by local browser test', controlsResponsive: true, leaveAndReturn: true, realReplacementProof: true });
  assert.deepEqual(c.errors, []); await c.context.close();
}
async function ambiguousWager() {
  const c = await client('ambiguous-wager');
  await c.page.getByRole('button', { name: 'Create Game', exact: true }).click();
  await c.page.waitForURL(/\/table\//);
  await until(() => c.latest?.actions, 'ambiguous wager first action');
  c.disconnectOpening = true;
  await act(c, 'Fold');
  await until(() => c.acceptedBeforeDisconnect, 'accepted fold with lost response');
  await c.page.getByRole('button', { name: 'Reconnect', exact: true }).click();
  await until(() => c.latest?.deal?.audit, 'reconciled opening without replaying wager');
  assert.equal(c.latest.next_action_seq, 1);
  assert.equal(c.latest.settled, true);
  results.push({ kind: 'ambiguous-wager', serverAcceptedBeforeDisconnect: true, authoritativeNextSequence: 1, replayed: false });
  assert.deepEqual(c.errors, []); await c.context.close();
}
try {
  if (!process.env.JOURNEY || process.env.JOURNEY === 'bot') await botGame(2, 3);
  if (!process.env.JOURNEY || process.env.JOURNEY === 'six') await botGame(6, 1);
  if (!process.env.JOURNEY || process.env.JOURNEY === 'friends') await friends();
  if (!process.env.JOURNEY || process.env.JOURNEY === 'invalid') await invalidProof();
  if (process.env.JOURNEY === 'restart') await restart();
  if (process.env.JOURNEY === 'slow') await slow();
  if (process.env.JOURNEY === 'ambiguous') await ambiguousWager();
} finally {
  await writeFile(`${output}/results-${process.env.JOURNEY ?? 'all'}.json`, JSON.stringify({ browser: browser.version(), realCrypto: true, audio: 'scheduling only, no acoustic capture', results }, null, 2));
  await browser.close();
}
