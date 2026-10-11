import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractAlpha, hitScreenPoint, makeInputMask, maskToRectangles, roundedContains } from '../src/shared/hit-test';
import type { OverlayLayout } from '../src/shared/types';

const layout: OverlayLayout = {
  window: { x: -1200, y: 24, width: 5, height: 6 },
  cat: { x: 1, y: 3, width: 3, height: 3 },
  button: { x: 0, y: 0, width: 5, height: 2 },
  buttonRadius: 1,
};
const ring = { width: 3, height: 3, alpha: Uint8Array.from([255, 255, 255, 255, 0, 255, 255, 255, 255]) };

test('alpha is read from the fourth byte, independent of RGB/BGRA order', () => {
  assert.deepEqual([...extractAlpha(Uint8Array.from([9, 8, 7, 0, 0, 0, 0, 255]), 2, 1).alpha], [0, 255]);
  assert.throws(() => extractAlpha(new Uint8Array(3), 1, 1));
});
test('opaque body blocks; a transparent hole inside the body passes clicks', () => {
  const mask = makeInputMask(ring, layout);
  assert.equal(hitScreenPoint(mask, layout.window, { x: -1199, y: 27 }), true);
  assert.equal(hitScreenPoint(mask, layout.window, { x: -1198, y: 28 }), false);
});
test('transparent gutters and the gap before the button do not become an input rectangle', () => {
  const mask = makeInputMask(ring, layout);
  assert.equal(hitScreenPoint(mask, layout.window, { x: -1200, y: 28 }), false);
  assert.equal(hitScreenPoint(mask, layout.window, { x: -1198, y: 26 }), false);
  assert.equal(hitScreenPoint(mask, layout.window, { x: -1198, y: 24 }), true);
});
test('off-monitor coordinates and right/bottom edges cannot index into a different row', () => {
  const mask = makeInputMask(ring, layout);
  for (const point of [{ x: -1201, y: 24 }, { x: -1195, y: 24 }, { x: -1198, y: 30 }, { x: Infinity, y: 24 }, { x: NaN, y: 24 }]) {
    assert.equal(hitScreenPoint(mask, layout.window, point), false);
  }
});
test('fractional screen coordinates are mapped in DIP, without multiplying by DPR', () => {
  const mask = makeInputMask(ring, layout);
  assert.equal(hitScreenPoint(mask, layout.window, { x: -1198.8, y: 27.4 }), true);
  assert.equal(hitScreenPoint(mask, layout.window, { x: -1197.8, y: 28.4 }), false);
});
test('rounded button corner passes while its center blocks', () => {
  const rect = { x: 20, y: 10, width: 188, height: 44 };
  assert.equal(roundedContains(rect, 22, { x: 20, y: 10 }), false);
  assert.equal(roundedContains(rect, 22, { x: 100, y: 32 }), true);
  assert.equal(roundedContains(rect, 22, { x: 208, y: 32 }), false);
});
test('scaled fully transparent and opaque images retain their meaning', () => {
  const big = { ...layout, window: { x: 0, y: 0, width: 20, height: 20 }, cat: { x: 0, y: 5, width: 20, height: 15 } };
  const empty = makeInputMask({ width: 1, height: 1, alpha: Uint8Array.of(0) }, big);
  const solid = makeInputMask({ width: 1, height: 1, alpha: Uint8Array.of(255) }, big);
  assert.equal(empty.pixels[19 * 20 + 19], 0);
  assert.equal(solid.pixels[19 * 20 + 19], 1);
});
test('scanline rectangles preserve every hole and every body pixel', () => {
  let seed = 783;
  for (let iteration = 0; iteration < 80; iteration++) {
    const width = 31, height = 23;
    const pixels = Uint8Array.from({ length: width * height }, () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % 3 ? 1 : 0;
    });
    const reconstructed = new Uint8Array(pixels.length);
    for (const rect of maskToRectangles({ width, height, pixels })) {
      assert.ok(rect.width > 0 && rect.height > 0);
      for (let y = rect.y; y < rect.y + rect.height; y++) {
        for (let x = rect.x; x < rect.x + rect.width; x++) {
          assert.equal(reconstructed[y * width + x], 0, 'rectangles must not overlap');
          reconstructed[y * width + x] = 1;
        }
      }
    }
    assert.deepEqual(reconstructed, pixels);
  }
});
test('full rectangle compresses into one native region', () => {
  assert.deepEqual(maskToRectangles({ width: 200, height: 300, pixels: new Uint8Array(60000).fill(1) }), [{ x: 0, y: 0, width: 200, height: 300 }]);
});
