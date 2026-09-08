import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:3140';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Local tests only');
const output = process.env.POLISH_OUT ?? '../../.local/polish/baseline';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: process.env.ALLOW_CROSS_ORIGIN_TEST === '1' ? ['--disable-web-security'] : [],
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const samples = [];
  page.on('pageerror', error => process.stderr.write(`browser error: ${error.message}\n`));
  let latest;
  page.on('websocket', socket => {
    socket.on('framereceived', ({ payload }) => {
      try {
        const m = JSON.parse(String(payload));
        if (m.type === 'snapshot') latest = m.view;
        // Store timings and public stage identity only, never message payloads.
        samples.push({ at: performance.now(), type: m.type, hand: m.hand_no ?? m.view?.hand_no, stage: m.stage });
      } catch { /* Not a game message. */ }
    });
  });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${output}/home-desktop.png`, fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${output}/home-narrow.png`, fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  if (process.env.HOME_ONLY === '1') returnHome();
  else {
    const started = performance.now();
    await page.getByRole('button', { name: 'Create Game', exact: true }).click();
    await page.waitForURL(/\/table\//, { timeout: 30000 });
    await page.screenshot({ path: `${output}/first-load.png`, fullPage: true });
    async function until(test, label) {
      const deadline = Date.now() + 180000;
      while (!await test()) {
        if (Date.now() > deadline) {
          await page.screenshot({ path: `${output}/failure.png`, fullPage: true });
          process.stderr.write((await page.locator('main').innerText()).slice(0, 2500));
          throw new Error(`Timeout: ${label}`);
        }
        await page.waitForTimeout(100);
      }
    }
    await until(() => latest?.actions, 'first legal action');
    samples.push({ metric: 'first-action', ms: performance.now() - started });
    await page.screenshot({ path: `${output}/active.png`, fullPage: true });
    for (let hand = 0; hand < 3; hand++) {
      await until(() => latest?.hand_no === hand && latest?.actions, `hand ${hand}`);
      const fold = page.getByRole('button', { name: 'Fold', exact: true });
      await until(() => fold.isEnabled(), 'fold enabled');
      await fold.click();
      await until(() => latest?.settled && latest?.deal?.audit, 'completed opening');
      await page.screenshot({ path: `${output}/completed-${hand}.png`, fullPage: true });
      if (hand === 2) break;
      const ready = page.getByRole('button', { name: /Ready for Next Hand|Next hand/i });
      await until(() => ready.isEnabled(), 'ready enabled');
      const at = performance.now();
      await ready.click();
      await page.screenshot({ path: `${output}/preparing-${hand + 1}.png`, fullPage: true });
      await until(() => latest?.hand_no === hand + 1 && latest?.actions, 'next hand');
      samples.push({ metric: 'next-hand', hand: hand + 1, ms: performance.now() - at });
    }
    await page.context().setOffline(true);
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${output}/offline.png`, fullPage: true });
    await writeFile(`${output}/samples.json`, JSON.stringify({ conditions: {
      browser: browser.version(),
      node: process.version,
      viewport: '1440x1000',
      build: process.env.BUILD_MODE ?? 'local',
      server: process.env.SERVER_CONDITION ?? 'local',
      realCrypto: true,
    }, samples }, null, 2));
  }
  function returnHome() { assert.ok(true); }
} finally {
  await browser.close();
}
