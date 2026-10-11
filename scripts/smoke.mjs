/** Run on a regular logged-in desktop account, after npm run build. */
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
if (process.platform === 'linux' && process.getuid?.() === 0) {
  throw new Error('Run smoke tests from an ordinary desktop account. Chromium sandbox is required; this script does not disable it.');
}
await mkdir('test-results', { recursive: true });
const app = await electron.launch({ args: [root, `--user-data-dir=${path.join(root, 'test-results/profile')}`] });
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
  assert.equal((await page.evaluate(() => window.murz.getTimer())).phase, 'IDLE');
  await app.evaluate(({ app: mainApp }) => mainApp.emit('second-instance', {}, [], process.cwd()));
  await waitVisible(true);
  assert.equal((await page.evaluate(() => window.murz.getTimer())).phase, 'BREAK');
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
  const image = await page.locator('#murz').boundingBox();
  const button = await page.locator('#dismiss').boundingBox();
  assert.ok(button.y + button.height < image.y);
  // CSSOM / preload / input behavior smoke checks, not native OS hit-test proof.
  await page.locator('#murz').dispatchEvent('click');
  await waitVisible(true);
  await page.locator('#murz').dispatchEvent('dragstart');
  assert.deepEqual(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds()), properties.bounds);
  for (let i = 0; i < 3; i++) {
    await page.locator('#dismiss').dispatchEvent('click');
    await waitVisible(false);
    assert.equal((await page.evaluate(() => window.murz.getTimer())).phase, 'WORKING');
    await app.evaluate(({ app: mainApp }) => mainApp.emit('second-instance', {}, [], process.cwd()));
    await waitVisible(true);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
  }
  await app.evaluate(({ powerMonitor }) => powerMonitor.emit('suspend'));
  const frozen = await page.evaluate(() => window.murz.getTimer());
  assert.equal(frozen.paused, true);
  await new Promise(resolve => setTimeout(resolve, 1200));
  assert.equal((await page.evaluate(() => window.murz.getTimer())).remainingMs, frozen.remainingMs);
  await waitVisible(true);
  await app.evaluate(({ powerMonitor }) => powerMonitor.emit('resume'));
  assert.equal((await page.evaluate(() => window.murz.getTimer())).paused, false);
  const oldRevision = await page.evaluate(async () => (await window.murz.getLayout()).revision);
  await app.evaluate(({ screen }) => screen.emit('display-metrics-changed', {}, screen.getPrimaryDisplay(), ['scaleFactor']));
  await page.waitForFunction(async revision => (await window.murz.getLayout()).revision > revision, oldRevision);
  await waitVisible(true);
  await page.screenshot({ path: 'test-results/overlay.png', omitBackground: true });
  assert.deepEqual(errors, []);
  console.log(`Electron smoke passed on ${process.platform}/${process.arch}. Native clicks, monitor hotplug and compositor behavior still require manual checks.`);
} finally {
  await app.close();
}
