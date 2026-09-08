// Local presentation checks. No wallet calls or production game traffic.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import sharp from 'sharp';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:3140';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), 'Local browser checks only');
const out = process.env.POLISH_OUT ?? '../../.local/polish/visual-refresh';
await mkdir(out, { recursive: true });
const audit = JSON.parse(await readFile(process.env.COMPLETED_TRANSCRIPT ?? '../../.local/polish/reliability/completed-2.json', 'utf8'));
const routes = [
  ['papers', '/papers'], ['motivation', '/motivation'], ['chips', '/chips'],
  ['hands', `/room/${audit.room}/hands`], ['proofs', `/room/${audit.room}/proofs`],
  ['receipt', `/audit/${audit.room}/${audit.hand_no}`],
];
const browser = await chromium.launch();
const page = await browser.newPage({ reducedMotion: 'reduce' });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const results = [];
try {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    for (const [name, path] of routes) {
      await page.goto(base + path, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      if (name === 'receipt') await page.getByRole('heading', { name: 'Deck verified', exact: true }).waitFor({ timeout: 120000 });
      if (name === 'hands') await page.getByRole('link', { name: 'Check this deal', exact: true }).first().waitFor();
      const text = await page.locator('main h1, main h2, main p, main nav a').evaluateAll(nodes => nodes.filter(node => node.getClientRects().length).map(node => ({ text: node.textContent?.slice(0, 40), family: getComputedStyle(node).fontFamily })));
      assert.ok(text.length && text.every(node => node.family.includes('Block Blueprint')), `${name}: consistent prose font`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name} at ${width}: page overflow`);
      if (name === 'papers') {
        const description = await page.locator('.brief-description').evaluate(node => ({ size: parseFloat(getComputedStyle(node).fontSize), transform: getComputedStyle(node).textTransform }));
        assert.ok(description.size >= 16);
        assert.equal(description.transform, 'none', 'Body copy must not inherit the kicker style');
        const disclosure = page.getByText('What a deck proof does and does not show', { exact: true });
        await disclosure.focus(); await page.keyboard.press('Enter');
        await page.getByText(/The completed deck opening reveals all cards afterward/).waitFor({ state: 'visible' });
        await page.keyboard.press('Enter');
      }
      if (name === 'receipt') {
        const family = await page.locator('.audit-record-hash strong').evaluate(node => getComputedStyle(node).fontFamily);
        assert.match(family, /monospace/);
      }
      await page.screenshot({ path: `${out}/${name}-${width}.png`, fullPage: true, animations: 'disabled' });
      results.push({ page: name, width, proseFont: 'Block Blueprint', pageOverflow: false });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${out}/home.png`, fullPage: true, animations: 'disabled' });
  if (process.env.BASELINE_HOME) {
    const [before, after] = await Promise.all([
    sharp(process.env.BASELINE_HOME).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(`${out}/home.png`).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  assert.deepEqual(after.info, before.info, 'Homepage geometry unchanged');
  let changed = 0;
  for (let i = 0; i < before.data.length; i += 4) if (!before.data.subarray(i, i + 4).equals(after.data.subarray(i, i + 4))) changed++;
  results.push({ page: 'home', changedPixels: changed, totalPixels: before.info.width * before.info.height });
  assert.equal(changed, 0, 'No homepage visual changes');
  } else results.push({ page: 'home', pixelComparison: 'Not run. Set BASELINE_HOME to a matching pre-edit capture.' });
  const icon = await page.locator('link[rel="icon"]').getAttribute('href');
  assert.equal(icon, '/favicon.svg');
  const response = await page.request.get(base + icon);
  assert.equal(response.status(), 200);
  assert.match(response.headers()['content-type'], /image\/svg\+xml/);
  assert.match(await response.text(), /<title>Noir Poker<\/title>/);
  results.push({ favicon: icon, status: 200, errors });
  assert.deepEqual(errors, []);
} finally {
  await writeFile(`${out}/results.json`, JSON.stringify(results, null, 2));
  await browser.close();
}
console.log('Supporting page fonts, responsive layout, keyboard disclosure, receipt and favicon passed. See results.json for the optional homepage comparison.');
