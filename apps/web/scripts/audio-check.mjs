import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const base = process.env.BASE_URL ?? 'http://127.0.0.1:3140';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw Error('Local checks only');
const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
const instrument = () => {
  window.audioSamples = [];
  let at = 0;
  document.addEventListener('click', () => { at = performance.now(); }, true);
  document.addEventListener('input', () => { at = performance.now(); }, true);
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    const activation = at;
    const sample = { error: this.src.includes('error'), ms: performance.now() - activation, readyState: this.readyState };
    window.audioSamples.push(sample);
    this.addEventListener('playing', () => { sample.playingEventMs = performance.now() - activation; }, { once: true });
    this.addEventListener('ended', () => { sample.endedMs = performance.now() - activation; }, { once: true });
    this.addEventListener('pause', () => { sample.pausedMs = performance.now() - activation; }, { once: true });
    return play.call(this);
  };
};
await page.addInitScript(instrument);
const samples = () => page.evaluate(() => window.audioSamples);
try {
  await page.goto(base);
  const hero = page.locator('.home-actions a').first();
  await hero.focus(); await page.keyboard.press('Enter');
  await hero.click();
  const initial = await samples();
  assert.equal(initial.length, 2); assert.ok(initial.every(s => !s.error && s.ms < 50));
  // Locally invalid blinds must produce only the error voice for the submission.
  const sliders = page.locator('.lobby-create input[type=range]');
  await sliders.nth(2).fill('5');
  const before = (await samples()).length;
  await page.getByRole('button', { name: 'Create Game', exact: true }).click();
  const invalid = (await samples()).slice(before);
  assert.equal(invalid.length, 1); assert.equal(invalid[0].error, true);
  await sliders.nth(2).fill('2');
  await page.route('**/rooms', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    await new Promise(resolve => setTimeout(resolve, 1500));
    await route.fulfill({ status: 503, contentType: 'text/plain', body: 'Local slow response fixture' });
  });
  const at = (await samples()).length;
  const create = page.getByRole('button', { name: 'Create Game', exact: true });
  await create.focus(); await page.keyboard.press('Enter');
  assert.equal((await samples()).slice(at).filter(s => !s.error).length, 1);
  await page.getByText('Local slow response fixture', { exact: true }).waitFor();
  const delayed = (await samples()).slice(at);
  assert.equal(delayed.length, 2); assert.equal(delayed[1].error, true);
  const live = await page.context().newPage();
  await live.addInitScript(instrument);
  await live.goto(base);
  await live.getByRole('button', { name: 'Create Game', exact: true }).click();
  await live.waitForURL('**/table/**');
  await live.waitForFunction(() => window.audioSamples[0]?.endedMs !== undefined, undefined, { timeout: 5000 });
  const navigation = await live.evaluate(() => window.audioSamples[0]);
  assert.ok(navigation.playingEventMs < 100);
  assert.ok(navigation.endedMs > 400, 'Preserve the original clip across navigation');
  assert.ok(navigation.pausedMs === undefined || navigation.pausedMs > 400);
  await live.close();
  await mkdir('../../.local/polish/audio', { recursive: true });
  await writeFile('../../.local/polish/audio/results.json', JSON.stringify({ browser: browser.version(), acousticCapture: false, coldAndRepeated: initial, localRejection: invalid, slowNetwork: delayed, navigation, allEvents: await samples() }, null, 2));
} finally { await browser.close(); }
