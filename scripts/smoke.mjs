/** Run on a regular logged-in desktop account, after npm run build. */
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
if (process.platform === 'linux' && process.getuid?.() === 0) {
  throw new Error('Run smoke tests from an ordinary desktop account. Chromium sandbox is required; this script does not disable it.');
}
await mkdir('test-results', { recursive: true });
const profile = await mkdtemp(path.join(root, 'test-results/profile-'));
const app = await electron.launch({ args: [root, `--user-data-dir=${profile}`] });
const errors = [];
try {
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => {
    const cat = document.querySelector('#murz');
    return cat.complete && cat.naturalWidth > 0 && cat.style.width !== '';
  });
  const waitVisible = async expected => {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const visible = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible());
      if (visible === expected) return;
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    throw new Error(`Window visibility never became ${expected}`);
  };
  await waitVisible(false);
  await page.waitForFunction(async () => (await window.murz.getTimer()).phase === 'WORKING');
  const started = await page.evaluate(() => window.murz.getTimer());
  assert.equal(started.settings.autoStart, true);
  assert.equal(started.workIndex, 1);
  const opened = app.waitForEvent('window', { predicate: window => window !== page });
  await app.evaluate(({ app: mainApp }) => mainApp.emit('second-instance', {}, [], process.cwd()));
  const settings = await opened;
  await settings.waitForLoadState();
  await settings.locator('#save:enabled').waitFor();
  assert.equal(await settings.locator('#autoStart').isChecked(), true);
  assert.equal(await settings.locator('#shortMinutes').inputValue(), '5');
  assert.equal(await settings.locator('#longMinutes').inputValue(), '15');
  assert.equal(await settings.locator('#longEvery').inputValue(), '4');
  await app.evaluate(({ app: mainApp }) => mainApp.emit('second-instance', {}, [], process.cwd()));
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 2);
  assert.equal((await page.evaluate(() => window.murz.getTimer())).intervalId, started.intervalId);
  await waitVisible(false);
  await settings.locator('#cancel').click();
  const properties = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    return {
      top: win.isAlwaysOnTop(), resizable: win.isResizable(),
      minimizable: win.isMinimizable(), movable: win.isMovable(),
      fullScreen: win.isFullScreen(), background: win.getBackgroundColor(),
      bounds: win.getBounds(),
    };
  });
  assert.equal(properties.top, true);
  assert.equal(properties.resizable, false);
  assert.equal(properties.fullScreen, false);
  if (process.platform !== 'linux') {
    assert.equal(properties.movable, false);
    assert.equal(properties.minimizable, false);
  }
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgba(0, 0, 0, 0)');
  await app.evaluate(({ powerMonitor }) => powerMonitor.emit('suspend'));
  const frozen = await page.evaluate(() => window.murz.getTimer());
  assert.equal(frozen.paused, true);
  await new Promise(resolve => setTimeout(resolve, 1200));
  assert.equal((await page.evaluate(() => window.murz.getTimer())).remainingMs, frozen.remainingMs);
  await waitVisible(false);
  await app.evaluate(({ powerMonitor }) => powerMonitor.emit('resume'));
  assert.equal((await page.evaluate(() => window.murz.getTimer())).paused, false);
  assert.deepEqual(errors, []);
  console.log(`Electron smoke passed on ${process.platform}/${process.arch}. Native clicks, monitor hotplug and compositor behavior still require manual checks.`);
} finally {
  await app.close();
  await rm(profile, { recursive: true, force: true });
}
