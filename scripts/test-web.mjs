/** Real browser checks at the GitHub project-site prefix, including MP4 playback. */
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const engines = { chromium, firefox, webkit };
const selected = process.argv[2] ? [process.argv[2]] : Object.keys(engines);
assert.ok(selected.every(name => name in engines), 'Pass chromium, firefox or webkit, or omit for all three.');
await mkdir(path.join(root, 'test-results'), { recursive: true });
const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (!pathname.startsWith('/MurzHelps/')) { res.writeHead(404).end(); return; }
    const relative = decodeURIComponent(pathname.slice('/MurzHelps/'.length)) || 'index.html';
    const file = path.resolve(root, 'web', relative);
    if (!file.startsWith(path.join(root, 'web') + path.sep)) { res.writeHead(403).end(); return; }
    const data = await readFile(file);
    const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.mp4': 'video/mp4' }[path.extname(file)];
    res.setHeader('Content-Type', type || 'application/octet-stream');
    res.setHeader('Accept-Ranges', 'bytes');
    const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    if (range) {
      const start = Number(range[1]), end = Math.min(range[2] ? Number(range[2]) : data.length - 1, data.length - 1);
      if (start > end) { res.writeHead(416).end(); return; }
      res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${data.length}`, 'Content-Length': end - start + 1 });
      res.end(data.subarray(start, end + 1));
    } else { res.setHeader('Content-Length', data.length); res.end(data); }
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/MurzHelps/`;
try {
  for (const name of selected) {
    // The approved MP4 is H.264. Branded Chrome includes the codec; bundled
    // Playwright Chromium on Linux does not. Never replace the user's video.
    const browser = await engines[name].launch(name === 'chromium'
      ? (process.env.MURZ_CHROME_PATH ? { executablePath: process.env.MURZ_CHROME_PATH } : { channel: 'chrome' })
      : {});
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'no-preference' });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()}: ${response.url()}`); });
      await page.goto(url);
      await page.waitForFunction(() => document.querySelector('#murz-photo').naturalWidth > 0);
      for (const width of [1440, 768, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.waitForTimeout(800);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: overflow at ${width}px`);
        assert.equal(await page.locator('body').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(246, 244, 237)');
        await page.screenshot({ path: path.join(root, `test-results/web-${name}-${width}.png`), fullPage: true });
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      assert.equal(await page.locator('link[rel="icon"]').getAttribute('href'), './assets/murz-icon.png');
      assert.equal(
        await page.locator('[data-release-link]').getAttribute('href'),
        'https://github.com/daryanchik/MurzHelps/releases'
      );

      assert.equal(
        await page.locator('[data-download-link]').getAttribute('href'),
        'https://github.com/daryanchik/MurzHelps/releases/download/v0.3.0/MurzHelps.dmg'
      );
      assert.equal(await page.locator('[data-repo-link]').getAttribute('href'), 'https://github.com/daryanchik/MurzHelps');
      const transform = await page.locator('.murz-video').evaluate(el => {
        const matrix = new DOMMatrixReadOnly(getComputedStyle(el).transform);
        return { scale: matrix.a, y: matrix.f, position: getComputedStyle(el).objectPosition };
      });
      assert.equal(transform.scale, 1.065);
      assert.equal(transform.y, 20);
      assert.equal(transform.position, '50% 100%');
      await page.locator('#murz-hover-video').evaluate(video => {
        window.playCount = 0;
        video.addEventListener('playing', () => window.playCount++);
      });
      await page.locator('#cat-stage').hover();
      await page.waitForFunction(() => document.querySelector('#cat-stage').classList.contains('is-hovering'), null, { timeout: 8000 }).catch(async error => {
        console.error(await page.locator('#murz-hover-video').evaluate(video => ({ readyState: video.readyState, networkState: video.networkState, error: video.error?.message, paused: video.paused, muted: video.muted, currentTime: video.currentTime, supported: video.canPlayType('video/mp4; codecs="avc1.640020"') })));
        throw error;
      });
      await page.waitForFunction(() => document.querySelector('#murz-hover-video').currentTime > 0.2);
      await page.waitForFunction(() => ['.murz-photo', '.portrait-disc'].every(selector => getComputedStyle(document.querySelector(selector)).opacity === '0'));
      await page.waitForFunction(() => !document.querySelector('#cat-stage').classList.contains('is-hovering'), null, { timeout: 12000 });
      await page.waitForFunction(() => ['.murz-photo', '.portrait-disc'].every(selector => getComputedStyle(document.querySelector(selector)).opacity === '1'));
      await page.waitForTimeout(500);
      assert.equal(await page.evaluate(() => window.playCount), 1, 'pointer retained: no replay after ending');
      await page.mouse.move(0, 0);
      await page.locator('#cat-stage').hover();
      await page.waitForFunction(() => window.playCount === 2);
      await page.mouse.move(0, 0);
      await page.waitForFunction(() => {
        const video = document.querySelector('#murz-hover-video');
        return !document.querySelector('#cat-stage').classList.contains('is-hovering') && video.paused && video.currentTime === 0;
      });
      await page.locator('#murz-hover-video').evaluate(video => { video.play = () => Promise.reject(new Error('test playback denial')); });
      await page.locator('#cat-stage').hover();
      await page.waitForTimeout(100);
      assert.equal(await page.locator('#cat-stage').evaluate(el => el.classList.contains('is-hovering')), false);
      assert.deepEqual(errors, []);
      const reduced = await browser.newPage({ reducedMotion: 'reduce' });
      await reduced.goto(url);
      await reduced.locator('#cat-stage').hover();
      assert.equal(await reduced.locator('#murz-hover-video').evaluate(video => video.paused), true);
      const noScript = await browser.newPage({ javaScriptEnabled: false });
      await noScript.goto(url);
      assert.ok(await noScript.locator('#murz-photo').evaluate(img => img.naturalWidth > 0 && !img.hidden));
      assert.equal(await noScript.locator('[data-repo-link]').getAttribute('href'), 'https://github.com/daryanchik/MurzHelps');
      console.log(`${name}: passed resources, 4 viewport sizes, links, original transform, actual MP4, one-shot hover/re-entry/early exit, rejected playback, reduced motion and no-JS fallback.`);
    } finally { await browser.close(); }
  }
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
