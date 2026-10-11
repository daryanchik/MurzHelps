import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateLayout } from '../src/shared/layout';

const photo = { width: 1024, height: 1536 };
const displays = [
  { x: 0, y: 24, width: 1440, height: 820 },
  { x: 0, y: 0, width: 1920, height: 1040 },
  { x: -2560, y: -180, width: 2560, height: 1400 },
  { x: 1920, y: 0, width: 1080, height: 1880 },
  { x: 0, y: 0, width: 5120, height: 1400 },
  { x: 0, y: 0, width: 800, height: 560 },
];
for (const area of displays) {
  test(`original photo fits ${area.width}x${area.height} at (${area.x},${area.y})`, () => {
    const { window, cat, button } = calculateLayout(area, photo);
    assert.ok(window.x >= area.x && window.y >= area.y);
    assert.ok(window.x + window.width <= area.x + area.width);
    assert.ok(window.y + window.height <= area.y + area.height);
    assert.ok(Math.abs(cat.width - cat.height * photo.width / photo.height) <= 1);
    assert.ok(cat.height > cat.width, 'never rotates the portrait');
    assert.ok(button.y + button.height < cat.y, 'button must not overlap the photo');
    assert.ok(window.y + cat.y + cat.height / 2 > area.y + area.height / 2);
    assert.ok(Math.abs(window.x + window.width / 2 - area.x - area.width / 2) <= 1);
  });
}
test('DIP layout is independent of physical monitor scaling', () => {
  const area = displays[0];
  // A 2880x1800 Retina panel and a 1440x900 panel expose the same DIP area.
  assert.deepEqual(calculateLayout(area, photo), calculateLayout({ ...area }, photo));
  assert.equal(calculateLayout(area, photo).window.width, 481);
});
test('height constraint takes precedence over width target for the user portrait', () => {
  const layout = calculateLayout(displays[1], photo);
  assert.ok(layout.cat.width < 1920 * 0.65);
  assert.ok(layout.cat.height >= 1040 * 0.85);
});
test('landscape replacement reaches the width target when physically possible', () => {
  const area = { x: 0, y: 0, width: 1440, height: 900 };
  const { cat } = calculateLayout(area, { width: 1600, height: 900 });
  assert.ok(cat.width / area.width >= 0.65 && cat.width / area.width <= 0.8);
});
test('invalid geometry fails instead of creating an unusable overlay', () => {
  assert.throws(() => calculateLayout({ x: 0, y: 0, width: 0, height: 900 }, photo));
  assert.throws(() => calculateLayout(displays[0], { width: 0, height: 100 }));
  assert.throws(() => calculateLayout({ ...displays[0], x: NaN }, photo));
});

for (const area of [...displays, { x: -100, y: 0, width: 240, height: 200 }]) {
  test(`visit card and both buttons fit without overlapping cat on ${area.width}x${area.height}`, () => {
    const layout = calculateLayout(area, photo, true);
    const { window, cat, button, snooze, info } = layout;
    assert.ok(info); assert.ok(snooze);
    assert.ok(window.x >= area.x && window.y >= area.y);
    assert.ok(window.x + window.width <= area.x + area.width);
    assert.ok(window.y + window.height <= area.y + area.height);
    assert.ok(Math.abs(cat.width - cat.height * photo.width / photo.height) <= 1);
    const overlap = (a: typeof cat, b: typeof cat) => a.x < b.x + b.width && a.x + a.width > b.x
      && a.y < b.y + b.height && a.y + a.height > b.y;
    assert.equal(overlap(cat, info), false);
    assert.equal(overlap(button, snooze), false);
    assert.equal(overlap(cat, snooze), false);
    for (const control of [button, snooze]) {
      assert.ok(control.x >= info.x && control.y >= info.y);
      assert.ok(control.x + control.width <= info.x + info.width && control.y + control.height <= info.y + info.height);
    }
    assert.equal(overlap(cat, button), false);
    for (const rect of [cat, button, snooze, info]) {
      assert.ok(rect.x >= 0 && rect.y >= 0);
      assert.ok(rect.x + rect.width <= window.width && rect.y + rect.height <= window.height);
    }
  });
}
test('portrait uses nearly full available height and landscape picks the better orientation', () => {
  const area = { x: 0, y: 24, width: 1440, height: 876 };
  const portrait = calculateLayout(area, photo, true);
  assert.ok(portrait.cat.height >= area.height - 22);
  const landscape = calculateLayout(area, { width: 2000, height: 600 }, true);
  assert.ok(landscape.cat.width >= area.width - 22);
  assert.ok(landscape.info!.y + landscape.info!.height < landscape.cat.y);
});
