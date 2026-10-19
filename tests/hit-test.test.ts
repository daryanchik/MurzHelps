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
test('fragmented masks stop at the native region budget instead of returning a lossy shape', () => {
  const fragmented = { width: 6, height: 2, pixels: Uint8Array.from([1, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1]) };
  assert.throws(() => maskToRectangles(fragmented, 5), RangeError);
  assert.equal(maskToRectangles(fragmented, 6).length, 6);
  const solid = { width: 100, height: 100, pixels: new Uint8Array(10000).fill(1) };
  assert.equal(maskToRectangles(solid, 1).length, 1, 'vertical merging does not consume more budget');
});
test('visible timer panel receives input but its transparent gap still passes clicks', () => {
  const withInfo = { ...layout, window: { ...layout.window, width: 10 },
    info: { x: 7, y: 0, width: 3, height: 6 } };
  const mask = makeInputMask(ring, withInfo);
  assert.equal(hitScreenPoint(mask, withInfo.window, { x: -1192, y: 27 }), true);
  assert.equal(hitScreenPoint(mask, withInfo.window, { x: -1194, y: 27 }), false);
  assert.equal(hitScreenPoint(mask, withInfo.window, { x: -1198, y: 28 }), false);
});

test('silhouette outline adds only a one-DIP rim and updates when the source changes', () => {
  const geometry: OverlayLayout = {
    window: { x: 0, y: 0, width: 12, height: 10 },
    cat: { x: 2, y: 2, width: 5, height: 5 },
    button: { x: 9, y: 0, width: 3, height: 2 }, buttonRadius: 1,
    snooze: { x: 9, y: 7, width: 3, height: 3 }, outline: 1,
  };
  const alpha = new Uint8Array(25); alpha[12] = 255;
  const outlined = makeInputMask({ width: 5, height: 5, alpha }, geometry);
  assert.equal(hitScreenPoint(outlined, geometry.window, { x: 3, y: 4 }), true);
  assert.equal(hitScreenPoint(outlined, geometry.window, { x: 2, y: 4 }), false);
  assert.equal(hitScreenPoint(outlined, geometry.window, { x: 10, y: 8 }), true);
  const plain = makeInputMask({ width: 5, height: 5, alpha }, { ...geometry, outline: 0 });
  assert.equal(hitScreenPoint(plain, geometry.window, { x: 3, y: 4 }), false);
  const changed = new Uint8Array(25); changed[24] = 255;
  const next = makeInputMask({ width: 5, height: 5, alpha: changed }, geometry);
  assert.equal(hitScreenPoint(next, geometry.window, { x: 3, y: 4 }), false);
  assert.equal(hitScreenPoint(next, geometry.window, { x: 6, y: 6 }), true);
});

test('rounded card corners remain transparent while both controls receive clicks', () => {
  const geometry: OverlayLayout = { ...layout, window: { x: 0, y: 0, width: 30, height: 20 },
    info: { x: 10, y: 0, width: 20, height: 20 }, infoRadius: 6,
    button: { x: 13, y: 3, width: 14, height: 5 }, snooze: { x: 13, y: 11, width: 14, height: 5 } };
  const mask = makeInputMask(ring, geometry);
  assert.equal(hitScreenPoint(mask, geometry.window, { x: 10, y: 0 }), false);
  assert.equal(hitScreenPoint(mask, geometry.window, { x: 20, y: 5 }), true);
  assert.equal(hitScreenPoint(mask, geometry.window, { x: 20, y: 13 }), true);
  assert.equal(hitScreenPoint(mask, geometry.window, { x: 8, y: 10 }), false);
});
