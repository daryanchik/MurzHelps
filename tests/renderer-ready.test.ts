import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildSync } from 'esbuild';
import { idleSnapshot } from '../src/shared/timer-state';
import { calculateLayout } from '../src/shared/layout';

const code = buildSync({ entryPoints: ['src/renderer/renderer.ts'], bundle: true, platform: 'browser', format: 'iife', write: false }).outputFiles[0].text;
const layout = calculateLayout({ x: 0, y: 0, width: 1000, height: 800 }, { width: 600, height: 700 }, true);
const snapshot = (revision = 1) => ({ revision, intervalId: revision, layout, presentation: { asset: 'mb', message: 'Мурз' } });

function harness() {
  const ready: number[] = [], failures: unknown[][] = [], frames: unknown[] = [];
  let onLayout!: (value: ReturnType<typeof snapshot>) => void;
  const decoding: { resolve(): void; reject(error: Error): void }[] = [];
  const nodes = new Map<string, any>();
  for (const id of ['murz', 'dismiss', 'snooze', 'visit-info', 'remaining', 'status', 'pause-status', 'message']) {
    nodes.set('#' + id, {
      style: {}, classList: { toggle() {} }, setAttribute() {}, addEventListener() {},
      naturalWidth: 600, naturalHeight: 700,
      getBoundingClientRect() { return { width: parseFloat(this.style.width), height: parseFloat(this.style.height) }; },
      decode: () => new Promise<void>((resolve, reject) => decoding.push({ resolve, reject })),
    });
  }
  vm.runInNewContext(code, {
    URL, location: { href: 'file:///app/dist/renderer/index.html' },
    requestAnimationFrame: (callback: unknown) => { frames.push(callback); return frames.length; },
    document: { querySelector: (id: string) => nodes.get(id), addEventListener() {} },
    window: { addEventListener() {}, murz: {
      onLayout: (callback: typeof onLayout) => { onLayout = callback; }, getLayout: async () => snapshot(),
      getTimer: async () => idleSnapshot(), onTimer() {},
      ready: (revision: number) => ready.push(revision), diagnostic() {},
      reportError: (...details: unknown[]) => failures.push(details),
    } },
  });
  return { ready, failures, frames, decoding, nodes, layout: (revision: number) => onLayout(snapshot(revision)) };
}
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

test('hidden renderer acknowledges decoded and positioned content without receiving animation frames', async () => {
  const h = harness(); await flush();
  assert.equal(h.ready.length, 0);
  h.decoding[0].resolve(); await flush();
  assert.deepEqual(h.ready, [1]);
  assert.equal(h.frames.length, 0);
  assert.equal(h.nodes.get('#murz').style.width, `${layout.cat.width}px`);
  assert.equal(h.nodes.get('#dismiss').style.top, `${layout.button.y}px`);
});

test('a superseded image decode can neither acknowledge nor fail the newer layout', async () => {
  const h = harness(); await flush(); h.layout(2);
  h.decoding[0].reject(new Error('superseded')); await flush();
  assert.equal(h.failures.length, 0); assert.equal(h.ready.length, 0);
  h.decoding[1].resolve(); await flush(); assert.deepEqual(h.ready, [2]);
});

test('failed image decoding reports the current revision without sending ready', async () => {
  const h = harness(); await flush(); h.decoding[0].reject(new Error('bad image')); await flush();
  assert.deepEqual(h.failures, [['image-decode', 1]]); assert.equal(h.ready.length, 0);
});

test('warning and reward compositions acknowledge a decoded layout without a hidden rendering frame', async () => {
  const passiveCode = buildSync({ entryPoints: ['src/renderer/warning.ts'], bundle: true, platform: 'browser', format: 'iife', write: false }).outputFiles[0].text;
  for (const mode of ['warning', 'reward']) {
    const ready: number[][] = [];
    let resolve!: () => void, frames = 0;
    const image = { style: {}, naturalWidth: 400, naturalHeight: 600, classList: { toggle() {} },
      decode: () => new Promise<void>(done => { resolve = done; }), addEventListener() {} };
    vm.runInNewContext(passiveCode, {
      URLSearchParams, location: { search: `?mode=${mode}&asset=${mode === 'reward' ? 'shirt' : 'mw'}` },
      innerWidth: 380, innerHeight: 700,
      requestAnimationFrame: () => { frames++; },
      document: { body: { classList: { add() {} } }, addEventListener() {},
        querySelector: (id: string) => id === '#murz' ? image : id === '#message'
          ? { style: {}, offsetHeight: 50 } : { getBoundingClientRect: () => ({ width: 210, height: 260 }) } },
      window: { addEventListener() {}, murzPassive: { ready: (...size: number[]) => ready.push(size), failed: () => assert.fail('unexpected passive failure') } },
    });
    assert.equal(ready.length, 0); resolve(); await flush();
    assert.deepEqual(ready, [[218, 268]]); assert.equal(frames, 0);
  }
});
