import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.vtt': 'text/vtt' };
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  const file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!file.startsWith(root)) { response.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    const headers = { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Accept-Ranges': 'bytes' };
    const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    if (range) {
      const start = Number(range[1]);
      const end = Math.min(range[2] ? Number(range[2]) : body.length - 1, body.length - 1);
      if (start > end) { response.writeHead(416, { 'Content-Range': `bytes */${body.length}` }).end(); return; }
      response.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${body.length}`, 'Content-Length': end - start + 1 }).end(body.subarray(start, end + 1));
    } else response.writeHead(200, { ...headers, 'Content-Length': body.length }).end(body);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = process.env.LANDING_URL || `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, timezoneId: 'Asia/Dhaka' });
    const mediaRequests = [];
    page.on('request', request => { if (request.resourceType() === 'media') mediaRequests.push(request.url()); });
    let release;
    const scripts = new Promise(resolve => { release = resolve; });
    await page.route('**/*', async route => {
      if (route.request().resourceType() === 'script') await scripts;
      await route.continue();
    });
    await page.addInitScript(() => {
      window.layoutShifts = [];
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.layoutShifts.push(entry.value);
      }).observe({ type: 'layout-shift', buffered: true });
    });
    const snapshot = () => page.evaluate(() => ({
      result: document.querySelector('#demo-result').innerText,
      rows: document.querySelectorAll('#demo-dates li').length,
      context: document.querySelector('#demo-context').textContent,
      font: getComputedStyle(document.querySelector('h1')).fontSize,
      cover: getComputedStyle(document.querySelector('#film-play')).display,
      positions: ['h1', '#demo-result', '#demo-context', 'video', 'footer'].map(selector => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return [rect.x, rect.y, rect.width, rect.height];
      }),
      overflow: document.documentElement.scrollWidth > innerWidth,
    }));
    try {
      await page.goto(url, { waitUntil: 'commit' });
      await page.locator('h1').waitFor({ state: 'visible' });
      const before = await snapshot();
      release();
      await page.waitForLoadState('networkidle');
      const after = await snapshot();
      assert.equal(before.rows, 3, `${width}px: render the example before JavaScript loads`);
      assert.deepEqual(after, before, `${width}px: initialization must not change visible content or geometry`);
      assert.equal(after.overflow, false);
      assert.deepEqual(mediaRequests, [], 'Video must not load before Play');
      assert.equal(await page.evaluate(() => window.layoutShifts.reduce((sum, value) => sum + value, 0)), 0, `${width}px: initial layout shift`);
      await page.locator('#demo-input').fill('tomorrow at 9am');
      await page.locator('#demo-submit').click();
      await page.waitForFunction(() => document.querySelector('#demo-result').getAttribute('aria-busy') === 'false');
      assert.equal(await page.locator('#demo-dates li').count(), 1);
      assert.match(await page.locator('#demo-context').innerText(), /Asia\/Dhaka/);
      const card = page.locator('.demo-example').first();
      const phrase = await card.getAttribute('data-phrase');
      await card.click();
      await page.waitForFunction(() => document.querySelector('#demo-result').getAttribute('aria-busy') === 'false');
      assert.equal(await page.locator('#demo-input').inputValue(), phrase, 'An example card fills the field');
      assert.equal(await page.locator('#demo-highlight').innerText(), phrase, 'The highlight layer tracks the field');
      assert((await page.locator('#demo-highlight .hl').count()) > 0, 'An example card highlights its parts');

      await page.locator('#film-play').click();
      await page.waitForFunction(() => document.querySelector('video').currentTime > 0.1);
      assert.equal(await page.locator('#film-play').isVisible(), false);
      assert(mediaRequests.length > 0, 'Play loads the video');
      assert.equal(await page.locator('video').evaluate(video => video.controls), false);
      await page.locator('#film-toggle').click();
      assert.equal(await page.locator('video').evaluate(video => video.paused), true);
      await page.locator('#film-seek').evaluate(input => { input.value = '30'; input.dispatchEvent(new Event('input', { bubbles: true })); });
      await page.waitForFunction(() => Math.abs(document.querySelector('video').currentTime - 30) < 0.2);
      await page.locator('#film-mute').click();
      assert.equal(await page.locator('video').evaluate(video => video.muted), true);
      await page.locator('#film-captions').click();
      assert.equal(await page.locator('video').evaluate(video => video.textTracks[0].mode), 'showing');
      await page.locator('#film-captions').click();
      await page.locator('#film-fullscreen').click();
      await page.waitForFunction(() => document.fullscreenElement?.id === 'film-player');
      await page.locator('#film-fullscreen').click();
      await page.waitForFunction(() => !document.fullscreenElement);
      await page.locator('video').focus();
      await page.keyboard.press('Space');
      await page.waitForFunction(() => !document.querySelector('video').paused);
      assert.equal(await page.evaluate(() => {
        const video = document.querySelector('video').getBoundingClientRect();
        return document.querySelector('.film-controls').getBoundingClientRect().top >= video.bottom;
      }), true, 'Controls must not cover the video');
      console.log(`${width}px: stable first paint; parsing and player controls work`);
    } finally { release(); await page.close(); }
  }
  const page = await browser.newPage({ javaScriptEnabled: false });
  await page.goto(url);
  assert.equal(await page.locator('#demo-dates li').count(), 3, 'The initial example also works without JavaScript');
  await page.close();

  // The demo asks for WebGPU, which turns off the library's own fallback.
  const cpuOnly = await browser.newPage({ timezoneId: 'Asia/Dhaka' });
  await cpuOnly.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'gpu', { get: () => undefined, configurable: true }); });
  await cpuOnly.goto(url);
  await cpuOnly.locator('#demo-input').fill('tomorrow at 9am');
  await cpuOnly.locator('#demo-submit').click();
  await cpuOnly.waitForFunction(() => document.querySelector('#demo-result').getAttribute('aria-busy') === 'false');
  assert.equal(await cpuOnly.locator('#demo-dates li').count(), 1, 'Parsing falls back when WebGPU is missing');
  assert.match(await cpuOnly.locator('#demo-meta').innerText(), /cpu$/, 'The fallback run reports cpu');
  await cpuOnly.close();
  console.log('no WebGPU: parsing falls back to cpu');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
