import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildSync } from 'esbuild';
import { idleSnapshot } from '../src/shared/timer-state';
import { calculateLayout } from '../src/shared/layout';
import type { ImageReadiness } from '../src/shared/types';

const bundle = (file: string) => buildSync({ entryPoints: [`src/renderer/${file}.ts`], bundle: true,
  platform: 'browser', format: 'iife', write: false }).outputFiles[0].text;
const code = bundle('renderer'), passiveCode = bundle('warning');
const layout = calculateLayout({ x: 0, y: 0, width: 1000, height: 800 }, { width: 600, height: 700 }, true);
const snapshot = (revision = 1) => ({ revision, intervalId: revision, layout,
  presentation: { asset: revision % 2 ? 'mb' : 'ms5', message: 'Мурз' } });

class FakeImage {
  style: Record<string, string> = {};
  classList = { toggle() {} };
  complete = false; currentSrc = ''; naturalWidth = 0; naturalHeight = 0;
  decoding = 'auto'; loading = 'auto';
  private source = '';
  private readonly listeners = new Map<string, Set<() => void>>();
  readonly decodes: { resolve(): void; reject(error: Error): void }[] = [];
  constructor(private readonly autoLoad: boolean) {}
  get src() { return this.source; }
  set src(value: string) {
    this.source = value; this.complete = false; this.naturalWidth = this.naturalHeight = 0;
    if (this.autoLoad) queueMicrotask(() => { if (this.source === value) this.loaded(); });
  }
  loaded() {
    this.complete = true; this.currentSrc = this.src;
    this.naturalWidth = 600; this.naturalHeight = 700; this.emit('load');
  }
  broken() { this.complete = true; this.naturalWidth = this.naturalHeight = 0; this.emit('error'); }
  emit(name: string) { for (const listener of [...this.listeners.get(name) ?? []]) listener(); }
  addEventListener(name: string, callback: () => void) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name)!.add(callback);
  }
  removeEventListener(name: string, callback: () => void) { this.listeners.get(name)?.delete(callback); }
  listenerCount() { return [...this.listeners.values()].reduce((count, set) => count + set.size, 0); }
  // Stays pending forever unless the test explicitly resolves/rejects it.
  decode() { return new Promise<void>((resolve, reject) => this.decodes.push({ resolve, reject })); }
  getBoundingClientRect() { return { width: parseFloat(this.style.width), height: parseFloat(this.style.height) }; }
}
function environment() {
  const timeouts = new Map<object, () => void>();
  const events = new Map<string, () => void>();
  const frames: unknown[] = [];
  return { timeouts, events, frames,
    context: {
      URL, URLSearchParams, AbortController, DOMException, queueMicrotask,
      setTimeout: (callback: () => void) => { const id = {}; timeouts.set(id, callback); return id; },
      clearTimeout: (id: object) => timeouts.delete(id),
      requestAnimationFrame: (callback: unknown) => { frames.push(callback); return frames.length; },
    },
    addEventListener: (name: string, callback: () => void) => events.set(name, callback),
    expire: () => { for (const [id, callback] of [...timeouts]) { timeouts.delete(id); callback(); } },
  };
}
function harness(mode: ImageReadiness = 'decode', autoLoad = true) {
  const env = environment(), image = new FakeImage(autoLoad);
  const ready: number[] = [], failures: unknown[][] = [], stages: unknown[][] = [];
  let onLayout!: (value: ReturnType<typeof snapshot>) => void;
  const nodes = new Map<string, any>([['#murz', image]]);
  for (const id of ['dismiss', 'snooze', 'visit-info', 'remaining', 'status', 'pause-status', 'message']) {
    nodes.set('#' + id, { style: {}, classList: { toggle() {} }, setAttribute() {}, addEventListener() {} });
  }
  vm.runInNewContext(code, {
    ...env.context, location: { href: 'file:///app/dist/renderer/index.html' },
    document: { querySelector: (id: string) => nodes.get(id), addEventListener() {} },
    window: { addEventListener: env.addEventListener, murz: {
      imageReadiness: mode,
      onLayout: (callback: typeof onLayout) => { onLayout = callback; }, getLayout: async () => snapshot(),
      getTimer: async () => idleSnapshot(), onTimer() {},
      ready: (revision: number) => ready.push(revision), diagnostic: (...values: unknown[]) => stages.push(values),
      reportError: (...details: unknown[]) => failures.push(details),
    } },
  });
  return { ...env, image, ready, failures, stages, nodes, layout: (revision: number) => onLayout(snapshot(revision)) };
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

test('macOS still waits for successful decoding and layout, without requiring rendering frames', async () => {
  const h = harness(); await flush();
  assert.equal(h.ready.length, 0); assert.equal(h.image.decoding, 'auto');
  h.image.decodes[0].resolve(); await flush();
  assert.deepEqual(h.ready, [1]); assert.equal(h.frames.length, 0);
  assert.equal(h.image.style.width, `${layout.cat.width}px`);
  assert.equal(h.nodes.get('#dismiss').style.top, `${layout.button.y}px`);
  assert.equal(h.timeouts.size, 0); assert.equal(h.image.listenerCount(), 0);
});

test('Windows readiness succeeds with a decode() stub that never resolves, without calling it', async () => {
  const h = harness('load', false); await flush();
  assert.deepEqual(h.ready, []); assert.equal(h.nodes.get('#dismiss').disabled, true);
  assert.deepEqual(h.stages, [[1, 'layout-applied'], [1, 'image-loading']]);
  h.image.loaded(); await flush();
  assert.deepEqual(h.ready, [1]); assert.equal(h.image.decodes.length, 0);
  assert.equal(h.image.decoding, 'sync'); assert.equal(h.frames.length, 0);
  assert.deepEqual(h.failures, []); assert.equal(h.timeouts.size, 0);
  assert.deepEqual(h.stages.slice(-2), [[1, 'image-loaded'], [1, 'ready-sent']]);
});

test('a superseded macOS decode cannot acknowledge or fail a newer layout', async () => {
  const h = harness(); await flush(); h.layout(2); await flush();
  h.image.decodes[0].reject(new Error('superseded')); await flush();
  assert.equal(h.failures.length, 0); assert.equal(h.ready.length, 0);
  h.image.decodes[1].resolve(); await flush(); assert.deepEqual(h.ready, [2]);
});

test('macOS decode failure and a stalled decode report distinct errors and release their timeout', async () => {
  const h = harness(); await flush(); h.image.decodes[0].reject(new Error('bad image')); await flush();
  assert.deepEqual(h.failures, [['image-decode', 1]]); assert.equal(h.ready.length, 0); assert.equal(h.timeouts.size, 0);
  const stalled = harness(); await flush(); stalled.expire(); await flush();
  assert.deepEqual(stalled.failures, [['image-timeout', 1]]); assert.deepEqual(stalled.ready, []);
  stalled.image.decodes[0].resolve(); await flush(); assert.deepEqual(stalled.ready, []);
});

test('Windows load failure or timeout never sends ready; late events cannot revive failed preparation', async () => {
  for (const reason of ['image-load', 'image-timeout']) {
    const h = harness('load', false); await flush();
    if (reason === 'image-load') h.image.broken(); else h.expire();
    await flush();
    assert.deepEqual(h.failures, [[reason, 1]]); assert.deepEqual(h.ready, []);
    h.image.loaded(); await flush(); assert.deepEqual(h.ready, []);
    assert.equal(h.timeouts.size, 0); assert.equal(h.image.listenerCount(), 0);
  }
});

test('cached PNG, source replacement, cancelled timeout and pagehide cannot acknowledge stale revisions', async () => {
  const h = harness('load', false); await flush(); const oldTimeout = [...h.timeouts.values()][0];
  h.layout(2); oldTimeout(); await flush();
  h.image.emit('load'); await flush(); assert.deepEqual(h.ready, []);
  h.image.loaded(); await flush(); assert.deepEqual(h.ready, [2]);
  h.layout(4); await flush(); assert.deepEqual(h.ready, [2, 4]);
  h.layout(5); h.events.get('pagehide')!(); h.image.loaded(); await flush();
  assert.deepEqual(h.ready, [2, 4]); assert.deepEqual(h.failures, []);
  assert.equal(h.image.listenerCount(), 0); assert.equal(h.timeouts.size, 0);
});

function passiveHarness(mode: 'warning' | 'reward', readiness: ImageReadiness) {
  const env = environment(), image = new FakeImage(false), ready: number[][] = [], failures: string[] = [];
  vm.runInNewContext(passiveCode, {
    ...env.context, location: { href: 'file:///app/dist/renderer/warning.html', search: `?mode=${mode}&asset=${mode === 'reward' ? 'shirt' : 'mw'}` },
    innerWidth: 380, innerHeight: 700,
    document: { body: { classList: { add() {} } }, addEventListener() {},
      querySelector: (id: string) => id === '#murz' ? image : id === '#message'
        ? { style: {}, offsetHeight: 50 } : { getBoundingClientRect: () => ({ width: 210, height: 260 }) } },
    window: { addEventListener: env.addEventListener, murzPassive: {
      imageReadiness: readiness, diagnostic() {}, ready: (...size: number[]) => ready.push(size), failed: (reason: string) => failures.push(reason),
    } },
  });
  return { ...env, image, ready, failures };
}
test('warnings and rewards load on Windows with a forever-pending decode stub, while macOS still decodes', async () => {
  for (const mode of ['warning', 'reward'] as const) for (const readiness of ['load', 'decode'] as const) {
    const h = passiveHarness(mode, readiness);
    assert.equal(h.ready.length, 0); h.image.loaded(); await flush();
    if (readiness === 'decode') {
      assert.equal(h.ready.length, 0); h.image.decodes[0].resolve(); await flush();
    } else assert.equal(h.image.decodes.length, 0);
    assert.deepEqual(h.ready, [[218, 268]]); assert.equal(h.frames.length, 0);
    assert.equal(h.timeouts.size, 0); assert.deepEqual(h.failures, []);
  }
});
test('passive image loading has a bounded error path and releases listeners on closing', async () => {
  for (const action of ['error', 'timeout', 'close']) {
    const h = passiveHarness('warning', 'load');
    if (action === 'error') h.image.broken();
    else if (action === 'timeout') h.expire();
    else h.events.get('pagehide')!();
    await flush(); h.image.loaded(); await flush();
    assert.deepEqual(h.ready, []);
    assert.deepEqual(h.failures, action === 'close' ? [] : [action === 'error' ? 'image-load' : 'image-timeout']);
    assert.equal(h.timeouts.size, 0); assert.equal(h.image.listenerCount(), 0);
  }
});
