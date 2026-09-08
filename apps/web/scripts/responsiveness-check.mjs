import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
const base = process.env.BASE_URL ?? 'http://127.0.0.1:3140';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw Error('Local traces only');
const out = process.env.POLISH_OUT ?? '../../.local/polish/trace-after';
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    window.probe = { tasks: [], frames: [], workers: 0 };
    new PerformanceObserver(list => { for (const e of list.getEntries()) window.probe.tasks.push(e.duration); }).observe({ type: 'longtask', buffered: true });
    let prior = performance.now();
    const frame = now => { window.probe.frames.push(now - prior); prior = now; requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
  });
  let workers = 0, ready = false;
  page.on('worker', () => workers++);
  page.on('websocket', socket => socket.on('framereceived', ({ payload }) => {
    const value = JSON.parse(String(payload));
    if (value.type === 'snapshot' && value.view.actions) ready = true;
  }));
  const cdp = await page.context().newCDPSession(page);
  const events = [];
  cdp.on('Tracing.dataCollected', ({ value }) => {
    // Persist timing and numeric thread identities only. Never export trace args or payloads.
    for (const e of value) if (['RunTask', 'EvaluateScript', 'FunctionCall', 'V8.Execute'].includes(e.name) && e.dur) events.push({ name: e.name, tid: e.tid, ts: e.ts, dur: e.dur });
  });
  await page.goto(base, { waitUntil: 'networkidle' });
  await cdp.send('Tracing.start', { categories: 'devtools.timeline,v8.execute,disabled-by-default-devtools.timeline', transferMode: 'ReportEvents' });
  const at = performance.now();
  await page.getByRole('button', { name: 'Create Game', exact: true }).click();
  const end = Date.now() + 150000;
  while (!ready) { if (Date.now() > end) throw Error('First legal action timeout'); await page.waitForTimeout(100); }
  const ms = performance.now() - at;
  const stopped = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve));
  await cdp.send('Tracing.end'); await stopped;
  const probe = await page.evaluate(() => window.probe);
  await writeFile(`${out}/samples.json`, JSON.stringify({ browser: browser.version(), firstActionMs: ms, workers, ...probe, events }, null, 2));
  console.log(JSON.stringify({ ms, workers, longTasks: probe.tasks, maxFrameGap: Math.max(...probe.frames) }));
} finally { await browser.close(); }
