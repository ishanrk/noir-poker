// A guarded, sequential release check. This creates ordinary one hand games.
// It never enters Aztec mode, changes infrastructure, or records private cards.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.LIVE_URL ?? 'https://noirpoker.ishankumthekar.com';
const host = new URL(base).hostname;
assert.equal(host, 'noirpoker.ishankumthekar.com', 'Live smoke is pinned to the Noir Poker site');
assert.equal(process.env.ALLOW_LIVE_SMOKE, '1', 'Set ALLOW_LIVE_SMOKE=1 to create two ordinary test games');

const output = process.env.LIVE_SMOKE_OUT ?? '../../.local/polish/live-smoke';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const failures = [];
const results = { base, browser: browser.version(), started_at: new Date().toISOString(), checks: [] };

function watch(page, label) {
  const trace = { page, label, view: undefined, postStatuses: [], sentTypes: [] };
  page.on('pageerror', error => failures.push(`${label} page: ${error.message}`));
  page.on('requestfailed', request => {
    if (['document', 'script', 'stylesheet', 'fetch', 'xhr'].includes(request.resourceType())) {
      failures.push(`${label} request: ${request.url()} ${request.failure()?.errorText ?? 'failed'}`);
    }
  });
  page.on('response', response => {
    if (response.request().method() === 'POST' && response.url().includes('/rooms')) {
      trace.postStatuses.push(response.status());
    }
  });
  page.on('websocket', socket => {
    if (!socket.url().includes('/rooms/')) return;
    socket.on('framesent', ({ payload }) => {
      try {
        const message = JSON.parse(String(payload));
        if (message.type) trace.sentTypes.push(message.type);
      } catch { /* Ignore browser protocol frames. */ }
    });
    socket.on('framereceived', ({ payload }) => {
      try {
        const message = JSON.parse(String(payload));
        if (message.type === 'snapshot') trace.view = message.view;
      } catch { /* The game protocol only acts on valid JSON. */ }
    });
  });
  return trace;
}

async function until(test, label, timeout = 240_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await test();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out while waiting for ${label}`);
}

async function prepareLobby(page, mode, name) {
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.getByRole('radio', { name: new RegExp(mode, 'i') }).check();
  await page.locator('.hand-scale input[type="range"]').fill('0');
  if (name) await page.locator('input[name="name"]').fill(name);
}

async function createTable(trace, mode, name) {
  await prepareLobby(trace.page, mode, name);
  const started = performance.now();
  await trace.page.getByRole('button', { name: 'Create Game', exact: true }).click();
  await trace.page.waitForURL(/\/table\/[0-9A-F]{8}$/, { timeout: 30_000 });
  return { room: new URL(trace.page.url()).pathname.split('/').at(-1), started };
}

async function waitForPrivateCards(trace) {
  await until(async () => {
    const cards = trace.page.locator('section[aria-label="You"] .card[data-filled="true"]');
    return await cards.count() === 2;
  }, `${trace.label} private cards`);
}

async function clickLegalAction(trace) {
  for (const locator of [
    trace.page.getByRole('button', { name: 'Check', exact: true }),
    trace.page.getByRole('button', { name: /^Call/ }),
  ]) {
    if (await locator.count() && await locator.isEnabled({ timeout: 250 })) {
      await locator.click();
      return true;
    }
  }
  return false;
}

async function playToCompletedHand(traces) {
  await until(async () => {
    if (traces.every(trace => trace.view?.settled && trace.view?.deal?.audit)) return true;
    for (const trace of traces) {
      if (await clickLegalAction(trace)) break;
    }
    return false;
  }, `${traces.map(trace => trace.label).join(' and ')} completed hand`);
  for (const trace of traces) {
    assert.equal(await trace.page.getByText(/unknown field|Failed to deserialize/i).count(), 0);
    assert.equal(await trace.page.getByRole('link', { name: 'Check this deal', exact: true }).count(), 1);
  }
}

async function finishGame(traces) {
  if (traces.every(trace => trace.view?.game_over)) return;
  for (const trace of traces) {
    if (trace.view?.game_over) continue;
    const finish = trace.page.getByRole('button', { name: 'Finish Game', exact: true });
    await until(() => finish.isEnabled({ timeout: 250 }), `${trace.label} finish action`);
    await finish.click();
  }
  await until(() => traces.every(trace => trace.view?.game_over), 'game completion');
}

async function verifyCompletedDeal(trace) {
  const href = await trace.page.getByRole('link', { name: 'Check this deal', exact: true }).getAttribute('href');
  assert.match(href, /^\/audit\/[0-9A-F]{8}\/0$/);
  const audit = await trace.page.context().newPage();
  await audit.goto(base + href, { waitUntil: 'domcontentloaded' });
  await audit.getByRole('heading', { name: 'Deck verified', exact: true }).waitFor({ timeout: 240_000 });
  await audit.close();
}

async function singlePlayer() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    const trace = watch(await context.newPage(), 'single player');
    const { started } = await createTable(trace, 'Single Player');
    await waitForPrivateCards(trace);
    const firstActionMs = Math.round(performance.now() - started);
    await playToCompletedHand([trace]);
    await verifyCompletedDeal(trace);
    await finishGame([trace]);
    await trace.page.screenshot({ path: `${output}/single-complete.png`, fullPage: true });
    results.checks.push({ kind: 'single player', first_action_ms: firstActionMs, completed_hand: true, receipt_verified: true, post_statuses: trace.postStatuses });
  } finally {
    await context.close();
  }
}

async function multiplayer() {
  const first = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const second = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    const a = watch(await first.newPage(), 'multiplayer creator');
    const b = watch(await second.newPage(), 'multiplayer joiner');
    const suffix = String(Date.now()).slice(-5);
    const { room, started } = await createTable(a, 'Multiplayer', `Smoke A ${suffix}`);
    await b.page.goto(base, { waitUntil: 'networkidle' });
    await b.page.getByRole('radio', { name: /Multiplayer/i }).check();
    await b.page.locator('input[name="player_name"]').fill(`Smoke B ${suffix}`);
    await b.page.getByLabel('Room ID').fill(room);
    await b.page.getByRole('button', { name: 'Join Game', exact: true }).click();
    await b.page.waitForURL(new RegExp(`/table/${room}$`), { timeout: 30_000 });
    await Promise.all([waitForPrivateCards(a), waitForPrivateCards(b)]);
    const firstActionMs = Math.round(performance.now() - started);
    await playToCompletedHand([a, b]);
    await verifyCompletedDeal(a);
    await finishGame([a, b]);
    await a.page.screenshot({ path: `${output}/multiplayer-complete.png`, fullPage: true });
    results.checks.push({ kind: 'two browser multiplayer', first_action_ms: firstActionMs, completed_hand: true, receipt_verified: true, creator_post_statuses: a.postStatuses, joiner_post_statuses: b.postStatuses });
  } finally {
    await Promise.all([first.close(), second.close()]);
  }
}

async function presentation() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  try {
    const page = await context.newPage();
    await page.goto(`${base}/motivation`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const panels = page.locator('.motivation-panel');
    assert.equal(await panels.count(), 3);
    assert.match(await panels.nth(0).evaluate(node => getComputedStyle(node).backgroundColor), /31, 11, 209/);
    assert.match(await panels.nth(1).evaluate(node => getComputedStyle(node).backgroundColor), /199, 255, 50/);
    const reveal = page.locator('.scene-card-face');
    const before = Number(await reveal.evaluate(node => getComputedStyle(node).opacity));
    await page.locator('.motivation-point').first().focus();
    await page.waitForTimeout(300);
    const after = Number(await reveal.evaluate(node => getComputedStyle(node).opacity));
    assert.ok(after > before, 'Keyboard focus did not reveal the scene');
    await page.screenshot({ path: `${output}/motivation-desktop.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `${output}/motivation-narrow.png`, fullPage: true });
    results.checks.push({ kind: 'motivation presentation', cobalt_and_lime: true, keyboard_scene: true, narrow_overflow: false });
  } finally {
    await context.close();
  }
}

try {
  await singlePlayer();
  await multiplayer();
  await presentation();
  assert.deepEqual(failures, []);
  results.finished_at = new Date().toISOString();
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
  process.stdout.write('Live single player, two browser multiplayer, receipt and presentation checks passed.\n');
} finally {
  await browser.close();
}
