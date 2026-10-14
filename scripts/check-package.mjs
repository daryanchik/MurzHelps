/** Inspect real Forge output; does not claim native GUI verification. */
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listPackage, extractFile } from '@electron/asar';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const photos = (await readdir(path.join(root, 'assets')))
  .filter(file => /^(?:ms[1-9]\d*|mw(?:[1-9]\d*)?|murz|murz-shirt)\.png$/.test(file));
const archives = [];
async function visit(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await visit(file);
    else if (entry.name === 'app.asar') archives.push(file);
  }
}
await visit(path.resolve(root, process.argv[2] || 'out'));
assert.ok(archives.length, 'No packaged app.asar found; run npm run package or npm run make first.');
for (const archive of archives) {
  const files = listPackage(archive).map(file => file.replaceAll('\\', '/'));
  for (const required of ['dist/main/main.cjs', 'dist/preload/preload.cjs', 'dist/preload/settings-preload.cjs',
    'dist/preload/passive-preload.cjs', 'dist/preload/work-timer-preload.cjs',
    'dist/renderer/index.html', 'dist/renderer/settings.html', 'dist/renderer/warning.html', 'dist/renderer/warning.css',
    'dist/renderer/warning.js', 'dist/renderer/work-timer.html', 'dist/renderer/work-timer.css', 'dist/renderer/work-timer.js',
    ...photos.map(file => `assets/${file}`), 'assets/icon.png', 'assets/icon.ico', 'assets/icon.icns', 'assets/tray.png',
    'assets/tray@2x.png', 'assets/trayTemplate.png', 'assets/trayTemplate@2x.png']) {
    assert.ok(files.includes('/' + required), `${archive}: missing ${required}`);
  }
  assert.ok(!files.some(file => /^\/(node_modules|src|tests|scripts|web|\.git)(\/|$)|^\/assets\/(source|icons)(\/|$)/.test(file)), 'Development inputs must not ship');
  assert.ok(!files.some(file => /(?:murz-eats2?\.png|murz-cursor|cursor-macos|cursor-windows|system-cursor|cursor-easter-egg)/i.test(file)), 'Cursor punishment must not ship');
  assert.doesNotMatch(extractFile(archive, 'dist/main/main.cjs').toString(), /CursorEasterEgg|SystemCursor|visitSuppressed|murz:protest|murz:reject-punishment-snooze|CGDisplayHideCursor/);
  const nativeFiles = await readdir(path.join(path.dirname(archive), 'native'));
  assert.deepEqual(nativeFiles.sort(), archive.includes('.app' + path.sep) ? ['murz-desktop-observer'] : [], 'Only the required desktop observer may ship');
  assert.equal(JSON.parse(extractFile(archive, 'package.json').toString()).version, version);
  for (const name of [...photos, 'icon.png', 'icon.ico', 'icon.icns', 'tray.png', 'tray@2x.png', 'trayTemplate.png', 'trayTemplate@2x.png']) {
    assert.deepEqual(extractFile(archive, 'assets/' + name), await readFile(path.join(root, 'assets', name)), `Packaged asset differs: ${name}`);
  }
  if (archive.includes('.app' + path.sep)) {
    const contents = path.dirname(path.dirname(archive));
    const plist = await readFile(path.join(contents, 'Info.plist'), 'utf8');
    const icon = plist.match(/<key>CFBundleIconFile<\/key>\s*<string>([^<]+)<\/string>/)?.[1];
    assert.ok(icon, 'Missing macOS bundle icon');
    assert.deepEqual(await readFile(path.join(contents, 'Resources', icon.endsWith('.icns') ? icon : icon + '.icns')), await readFile(path.join(root, 'assets/icon.icns')));
    assert.ok(plist.includes(`<string>${version}</string>`));
  }
  console.log(`Validated ${path.relative(root, archive)}: v${version}, runtime, photo, app and tray icons; no development inputs.`);
}
