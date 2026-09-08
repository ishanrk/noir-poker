import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const base = process.env.BASE_URL ?? 'http://127.0.0.1:3140';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw Error('Local checks only');
const out = process.env.POLISH_OUT ?? '../../.local/polish/presentation';
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const results = [];
async function fonts(label) {
  await page.evaluate(() => document.fonts.ready);
  const values = await page.locator('.site-header nav a').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).fontFamily));
  assert.ok(values.length && values.every(value => value.startsWith('"Block Blueprint"')));
  assert.ok(await page.evaluate(() => document.fonts.check('16px "Block Blueprint"')));
  results.push({ kind: 'navigation-font', label, values });
}
try {
  await page.goto(base, { waitUntil: 'networkidle' });
  await fonts('cold homepage');
  await page.screenshot({ path: `${out}/home-desktop.png`, fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${out}/home-narrow.png`, fullPage: true, animations: 'disabled' });
  await page.getByRole('link', { name: 'Crypto Papers', exact: true }).click();
  await page.waitForURL('**/papers'); await fonts('papers navigation');
  await page.getByRole('link', { name: 'Play', exact: true }).first().click();
  await page.waitForURL(base + '/'); await fonts('homepage after navigation');
  await page.setViewportSize({ width: 1440, height: 1000 });
  const audit = JSON.parse(await readFile('../../.local/polish/reliability/completed-2.json', 'utf8'));
  await page.goto(`${base}/audit/${audit.room}/${audit.hand_no}`);
  await page.getByRole('heading', { name: 'Deck verified', exact: true }).waitFor({ timeout: 120000 });
  await fonts('receipt');
  const headingFont = await page.locator('.audit-transcript h2').evaluate(node => getComputedStyle(node).fontFamily);
  const hashFont = await page.locator('.audit-record-hash strong').evaluate(node => getComputedStyle(node).fontFamily);
  assert.match(headingFont, /Block Blueprint/); assert.match(hashFont, /monospace/);
  assert.doesNotMatch(await page.locator('main').innerText(), /boundary/i);
  await page.locator('.audit-transcript').screenshot({ path: `${out}/hand-record.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${out}/receipt-narrow.png`, fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  assert.equal(overflow, false, 'Receipt fits narrow viewport');
  await page.getByRole('button', { name: 'Download Proof Transcript', exact: true }).focus();
  assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'BUTTON');
  results.push({ kind: 'receipt', verifiedInBrowser: true, headingFont, hashFont, narrowOverflow: overflow });
} finally {
  await writeFile(`${out}/results.json`, JSON.stringify(results, null, 2));
  await browser.close();
}
