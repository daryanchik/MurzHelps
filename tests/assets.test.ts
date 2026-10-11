import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

test('cutout preserves all original decoded RGB bytes and the portrait orientation', async () => {
  const original = await sharp('assets/source/murz-original.jpeg').removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const cutout = await sharp('assets/murz.png').raw().toBuffer({ resolveWithObject: true });
  assert.equal(cutout.info.width, original.info.width);
  assert.equal(cutout.info.height, original.info.height);
  assert.equal(cutout.info.channels, 4);
  const count = original.info.width * original.info.height;
  let transparent = 0, solid = 0;
  for (let i = 0; i < count; i++) {
    for (let c = 0; c < 3; c++) {
      if (cutout.data[i * 4 + c] !== original.data[i * 3 + c]) assert.fail(`Photo changed at pixel ${i}, channel ${c}`);
    }
    transparent += Number(cutout.data[i * 4 + 3] === 0);
    solid += Number(cutout.data[i * 4 + 3] === 255);
  }
  assert.ok(transparent > count * 0.3 && transparent < count * 0.5);
  assert.ok(solid > count * 0.5);
  assert.equal(cutout.data[3], 0, 'top-left background must be transparent');
  assert.equal(cutout.data[(768 * 1024 + 400) * 4 + 3], 255, 'body remains opaque');
});
test('platform icons have valid containers and HiDPI tray sizes', async () => {
  const ico = await readFile('assets/icon.ico');
  const icns = await readFile('assets/icon.icns');
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(icns.subarray(0, 4).toString(), 'icns');
  assert.equal(icns.readUInt32BE(4), icns.length);
  assert.equal((await sharp('assets/trayTemplate.png').metadata()).width, 20);
  assert.equal((await sharp('assets/trayTemplate@2x.png').metadata()).width, 40);
});
