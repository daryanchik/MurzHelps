import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

test('fresh build regenerates missing app icons from the real photo and leaves the tray unchanged', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'murz-clean-build-'));
  try {
    for (const folder of ['assets', 'scripts', 'src']) await cp(folder, path.join(dir, folder), { recursive: true });
    await symlink(path.resolve('node_modules'), path.join(dir, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    const protectedFiles = ['murz.png', 'tray.png', 'tray@2x.png', 'trayTemplate.png', 'trayTemplate@2x.png', 'icons/murz-icon.png'];
    const before = await Promise.all(protectedFiles.map(file => readFile(path.join(dir, 'assets', file)).then(digest)));
    await Promise.all(['png', 'ico', 'icns'].map(ext => rm(path.join(dir, 'assets', `icon.${ext}`), { force: true })));
    execFileSync(process.execPath, [path.join(dir, 'scripts/build.mjs')]);
    const photo = await sharp(path.join(dir, 'assets/icons/murz-icon.png')).ensureAlpha().raw().toBuffer();
    const generated = await sharp(path.join(dir, 'assets/icon.png')).ensureAlpha().raw().toBuffer();
    assert.deepEqual(generated, photo, 'the 1024px source photograph must survive unchanged');

    const ico = await readFile(path.join(dir, 'assets/icon.ico'));
    assert.equal(ico.readUInt16LE(2), 1);
    const sizes = [16, 24, 32, 48, 64, 128, 256];
    assert.equal(ico.readUInt16LE(4), sizes.length);
    let end = 6 + sizes.length * 16;
    for (const [i, size] of sizes.entries()) {
      const at = 6 + i * 16, length = ico.readUInt32LE(at + 8), start = ico.readUInt32LE(at + 12);
      assert.equal(start, end);
      assert.equal(ico[at] || 256, size);
      assert.equal(ico[at + 1] || 256, size);
      const frame = ico.subarray(start, start + length);
      assert.deepEqual(await sharp(frame).raw().toBuffer(), await sharp(path.join(dir, 'assets/icon.png')).resize(size, size).raw().toBuffer());
      end += length;
    }
    assert.equal(end, ico.length);

    const icns = await readFile(path.join(dir, 'assets/icon.icns'));
    assert.equal(icns.subarray(0, 4).toString(), 'icns');
    assert.equal(icns.readUInt32BE(4), icns.length);
    const frames = new Map([['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024]]);
    for (let at = 8; at < icns.length;) {
      const type = icns.subarray(at, at + 4).toString(), length = icns.readUInt32BE(at + 4);
      const size = frames.get(type);
      assert.ok(size && length > 8 && at + length <= icns.length);
      assert.deepEqual(await sharp(icns.subarray(at + 8, at + length)).raw().toBuffer(), await sharp(path.join(dir, 'assets/icon.png')).resize(size, size).raw().toBuffer());
      frames.delete(type);
      at += length;
    }
    assert.equal(frames.size, 0);
    const hashes = await Promise.all(['png', 'ico', 'icns'].map(ext => readFile(path.join(dir, 'assets', `icon.${ext}`)).then(digest)));
    execFileSync(process.execPath, [path.join(dir, 'scripts/prepare-icons.mjs')]);
    assert.deepEqual(await Promise.all(['png', 'ico', 'icns'].map(ext => readFile(path.join(dir, 'assets', `icon.${ext}`)).then(digest))), hashes, 'repeat generation is deterministic');
    assert.deepEqual(await Promise.all(protectedFiles.map(file => readFile(path.join(dir, 'assets', file)).then(digest))), before);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('non-square replacement retains proportions and transparent padding', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'murz-icons-'));
  try {
    const source = path.join(dir, 'source.png');
    await writeFile(source, await sharp({ create: { width: 80, height: 40, channels: 4, background: '#c07030' } }).png().toBuffer());
    // Import via native ESM so this test exercises the same module as the CLI.
    const moduleUrl = pathToFileURL(path.resolve('scripts/prepare-icons.mjs')).href;
    execFileSync(process.execPath, ['--input-type=module', '-e', `import { generateAppIcons } from ${JSON.stringify(moduleUrl)}; await generateAppIcons(${JSON.stringify({ source, output: dir })});`]);
    const { data, info } = await sharp(path.join(dir, 'icon.png')).raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.width, 1024);
    assert.equal(info.height, 1024);
    assert.equal(data[3], 0);
    assert.equal(data[(512 * 1024 + 512) * 4 + 3], 255);
    assert.equal(data[(255 * 1024 + 512) * 4 + 3], 0);
    assert.equal(data[(768 * 1024 + 512) * 4 + 3], 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
