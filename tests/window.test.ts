import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { buildSync } from 'esbuild';
import { IPC } from '../src/shared/types';
import { BreakTimer } from '../src/main/timer';
import { bindTimerView } from '../src/main/timer-view';
import type { ShortMurzAssetId } from '../src/shared/murz-assets';

// Exercise the actual main-process controller without claiming an OS GUI test.
const code = buildSync({ entryPoints: ['src/main/window.ts'], bundle: true, platform: 'node', format: 'cjs', external: ['electron'], write: false }).outputFiles[0].text;
const requireNode = createRequire(`${process.cwd()}/package.json`);

function harness(platform: 'darwin' | 'win32', shapeFails = false, available: ShortMurzAssetId[] = []) {
  const timeouts = new Map<object, { callback: () => void; ms: number }>();
  const intervals = new Map<object, () => void>();
  const ipc = Object.assign(new EventEmitter(), {
    handlers: new Map<string, (event: unknown) => unknown>(),
    handle(name: string, callback: (event: unknown) => unknown) { this.handlers.set(name, callback); },
    removeHandler(name: string) { this.handlers.delete(name); },
  });
  const display = { id: 2, scaleFactor: 2, workArea: { x: -320, y: 20, width: 320, height: 240 } };
  const primary = { id: 1, scaleFactor: 1, workArea: { x: 0, y: 0, width: 1440, height: 900 } };
  const cursor = { x: -1000, y: -1000 };
  const screen = Object.assign(new EventEmitter(), {
    getPrimaryDisplay: () => primary,
    getAllDisplays: () => [primary, display],
    getDisplayNearestPoint: () => display,
    getCursorScreenPoint: () => cursor,
  });
  const power = new EventEmitter();
  const diagnostics: Record<string, any>[] = [];
  const errors: string[] = [];
  let quit = 0;
  class FakeWindow extends EventEmitter {
    visible = false;
    ignored = true;
    bounds = { x: 0, y: 0, width: 1, height: 1 };
    shapes: unknown[][] = [];
    sent: { channel: string; payload: any }[] = [];
    webContents = Object.assign(new EventEmitter(), {
      mainFrame: {},
      setZoomFactor() {}, setVisualZoomLevelLimits: async () => {}, setWindowOpenHandler() {},
      session: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} },
      send: (channel: string, payload: any) => this.sent.push({ channel, payload }),
    });
    constructor(readonly options: any) { super(); }
    level: unknown[] = []; workspaces: unknown[] = [];
    setMenu() {} moveTop() {}
    setAlwaysOnTop(...args: unknown[]) { this.level = args; }
    setVisibleOnAllWorkspaces(...args: unknown[]) { this.workspaces = args; }
    setIgnoreMouseEvents(ignore: boolean) { this.ignored = ignore; }
    isDestroyed() { return false; }
    isVisible() { return this.visible; }
    hide() { this.visible = false; this.emit('hide'); }
    showInactive() { this.visible = true; this.emit('show'); }
    setBounds(bounds: typeof this.bounds) { this.bounds = { ...bounds }; }
    getBounds() { return this.bounds; }
    setShape(rects: unknown[]) {
      this.shapes.push(rects);
      if (shapeFails && rects.length) throw new Error('Simulated unsupported shape');
    }
    async loadFile() {}
  }
  const bitmap = Buffer.alloc(3 * 3 * 4);
  bitmap[4 * 4 + 3] = 255;
  const electron = {
    app: { quit: () => quit++ }, BrowserWindow: FakeWindow, ipcMain: ipc, screen, powerMonitor: power,
    dialog: { showErrorBox(_title: string, message: string) { errors.push(message); } },
    nativeImage: { createFromPath: (file: string) => ({ isEmpty: () => false, getSize: () => ({ width: 3, height: 3 }), toBitmap: () => {
      if (!/ms[12]\.png$/.test(file)) return bitmap;
      const variant = Buffer.alloc(3 * 3 * 4);
      variant[(file.endsWith('ms1.png') ? 3 : 5) * 4 + 3] = 255;
      return variant;
    } }) },
  };
  const module = { exports: {} as any };
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require: (name: string) => name === 'electron' ? electron : requireNode(name),
    __dirname: '/app/dist/main', process: { platform },
    console: { warn() {}, error() {}, info(line: string) { diagnostics.push(JSON.parse(line)); } },
    setTimeout: (callback: () => void, ms: number) => { const id = {}; timeouts.set(id, { callback, ms }); return id; },
    clearTimeout: (id: object) => timeouts.delete(id),
    setInterval: (callback: () => void) => { const id = {}; intervals.set(id, callback); return id; },
    clearInterval: (id: object) => intervals.delete(id),
  });
  let now = 0;
  const timer = new BreakTimer(undefined, () => now);
  const controller = new module.exports.MurzWindow('/app/assets', (id: number) => timer.dismissBreak(id), (id: number) => timer.snooze(id), available);
  bindTimerView(timer, controller);
  const window: FakeWindow = controller.window;
  const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
  const snapshot = () => ipc.handlers.get(IPC.getLayout)!(event) as any;
  const ready = () => ipc.emit(IPC.ready, event, snapshot().revision);
  const summon = () => { timer.startBreakNow(); ready(); };
  const advance = (ms: number) => {
    for (const [id, timer] of [...timeouts]) if (timer.ms === ms) { timeouts.delete(id); timer.callback(); }
  };
  return { elapse: (ms: number) => { now += ms; timer.tick(); }, controller, timer, summon, window, event, ipc, snapshot, ready, screen, display, cursor, intervals, timeouts, power, advance, diagnostics, errors, quit: () => quit };
}

test('actual controller blocks early display; dismissal and summon reuse the same window', t => {
  const h = harness('darwin'); t.after(() => h.controller.dispose());
  assert.equal(h.window.visible, false);
  h.ready();
  assert.equal(h.window.visible, false, 'readiness alone never starts a timer');
  h.summon();
  assert.equal(h.window.visible, true);
  assert.equal(h.intervals.size, 1);
  h.ready();
  assert.equal(h.intervals.size, 1, 'duplicate ready cannot create another poller');
  h.ipc.emit(IPC.dismiss, h.event, h.timer.snapshot().intervalId);
  assert.equal(h.window.visible, false);
  assert.equal(h.intervals.size, 0);
  assert.equal(h.window.ignored, true);
  h.timer.startBreakNow();
  assert.equal(h.window.visible, false);
  h.ready();
  assert.equal(h.window.visible, true);
});
test('macOS controller switches input using real screen coordinates and the alpha mask', t => {
  const h = harness('darwin'); t.after(() => h.controller.dispose());
  h.summon();
  assert.equal(h.window.ignored, true);
  const { cat } = h.snapshot().layout;
  h.cursor.x = h.window.bounds.x + cat.x + cat.width / 2;
  h.cursor.y = h.window.bounds.y + cat.y + cat.height / 2;
  for (const poll of h.intervals.values()) poll();
  assert.equal(h.window.ignored, false);
  h.cursor.x = -1000;
  h.ipc.emit(IPC.pointer, h.event);
  assert.equal(h.window.ignored, true);
  assert.equal(h.window.shapes.length, 0, 'macOS must not call setShape');
});
test('Windows uses a native input region; fallback remains functional if the API fails', t => {
  for (const shapeFails of [false, true]) {
    const h = harness('win32', shapeFails); t.after(() => h.controller.dispose());
    h.summon();
    assert.ok(h.window.shapes[0].length > 0);
    assert.equal(h.window.visible, true);
    assert.equal(h.intervals.size, shapeFails ? 1 : 0);
    if (!shapeFails) assert.equal(h.window.ignored, false);
  }
});
test('monitor changes reject stale layouts and do not show a dismissed cat', t => {
  const h = harness('darwin'); t.after(() => h.controller.dispose());
  h.summon();
  const oldRevision = h.snapshot().revision;
  h.display.workArea.x = 400;
  h.screen.emit('display-removed');
  assert.equal(h.window.visible, false);
  h.ipc.emit(IPC.ready, h.event, oldRevision);
  assert.equal(h.window.visible, false);
  h.advance(100); h.ready();
  assert.ok(h.window.bounds.x >= 400);
  assert.equal(h.window.visible, true);
  h.controller.dismiss();
  h.screen.emit('display-added'); h.advance(100);
  assert.equal(h.window.visible, false);
});
test('untrusted IPC cannot dismiss the overlay or read layout/timer', t => {
  const h = harness('darwin'); t.after(() => h.controller.dispose()); h.summon();
  const forged = { sender: {}, senderFrame: {} };
  h.ipc.emit(IPC.dismiss, forged, h.timer.snapshot().intervalId);
  assert.equal(h.window.visible, true);
  assert.throws(() => h.ipc.handlers.get(IPC.getLayout)!(forged));
  assert.throws(() => h.ipc.handlers.get(IPC.getTimer)!(forged));
  const subframe = { sender: h.window.webContents, senderFrame: {} };
  h.ipc.emit(IPC.dismiss, subframe, h.timer.snapshot().intervalId);
  assert.equal(h.window.visible, true);
});
test('renderer failure releases the workspace; quit cleanup removes timers and listeners', () => {
  const h = harness('darwin'); h.summon();
  h.window.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
  assert.equal(h.window.visible, false);
  assert.equal(h.window.ignored, true);
  assert.equal(h.quit(), 1);
  h.controller.dispose();
  assert.equal(h.intervals.size, 0);
  assert.equal(h.timeouts.size, 0);
  assert.equal(h.ipc.handlers.size, 0);
  assert.equal(h.screen.listenerCount('display-removed'), 0);
});

test('dismissal token prevents late IPC from dismissing a newer break', t => {
  const h = harness('darwin'); t.after(() => h.controller.dispose()); h.summon();
  const oldId = h.timer.snapshot().intervalId;
  h.ipc.emit(IPC.dismiss, h.event, oldId);
  assert.equal(h.timer.snapshot().phase, 'WORKING');
  h.summon();
  for (const invalid of [oldId, undefined, '3', NaN, Infinity]) h.ipc.emit(IPC.dismiss, h.event, invalid);
  assert.equal(h.window.visible, true);
  assert.equal(h.timer.snapshot().phase, 'SHORT_VISIT');
  h.timer.pause(); assert.equal(h.window.visible, true);
  h.timer.stop(); assert.equal(h.window.visible, false);
});

test('snooze IPC validates sender and token, hides once, and rejects old commands after return', t => {
  const h = harness('darwin', false, ['ms1', 'ms2']); t.after(() => h.controller.dispose()); h.summon();
  const old = h.timer.snapshot().intervalId;
  const presentation = h.snapshot().presentation;
  h.ipc.emit(IPC.snooze, { sender: {}, senderFrame: {} }, old);
  h.ipc.emit(IPC.snooze, { sender: h.window.webContents, senderFrame: {} }, old);
  assert.equal(h.window.visible, true);
  h.ipc.emit(IPC.snooze, h.event, old); h.ipc.emit(IPC.snooze, h.event, old);
  assert.equal(h.window.visible, false); assert.equal(h.timer.snapshot().phase, 'SNOOZED');
  h.elapse(5 * 60_000); h.ready();
  assert.deepEqual(h.snapshot().presentation, presentation);
  assert.equal(h.window.visible, true);
  h.ipc.emit(IPC.dismiss, h.event, old); h.ipc.emit(IPC.snooze, h.event, old);
  h.ipc.emit(IPC.snooze, h.event, h.timer.snapshot().intervalId);
  assert.equal(h.window.visible, true); assert.equal(h.timer.snapshot().phase, 'SHORT_VISIT');
  h.ipc.emit(IPC.dismiss, h.event, h.timer.snapshot().intervalId);
  assert.equal(h.window.visible, false);
});

test('switching photos rebuilds both the displayed asset and the native alpha input region', t => {
  const h = harness('win32', false, ['ms1', 'ms2']); t.after(() => h.controller.dispose()); h.summon();
  const before = h.snapshot(); const shape = h.window.shapes.at(-1);
  assert.equal(before.layout.outline, 1);
  h.ipc.emit(IPC.dismiss, h.event, h.timer.snapshot().intervalId); h.summon();
  const after = h.snapshot();
  assert.notEqual(after.presentation.asset, before.presentation.asset);
  assert.ok(after.revision > before.revision);
  assert.notDeepEqual(h.window.shapes.at(-1), shape);
  const { button, snooze } = after.layout;
  assert.ok(snooze.y > button.y);
});

test('missing short photos use murz.png without adding a second outline', t => {
  const h = harness('darwin'); t.after(() => h.controller.dispose()); h.summon();
  assert.equal(h.snapshot().presentation.asset, 'mb'); assert.equal(h.snapshot().layout.outline, 0);
});

test('repeated dismissals always finish the visit and expose no refusal IPC or punishment state', t => {
  const h = harness('darwin', false, ['ms1', 'ms2']); t.after(() => h.controller.dispose());
  for (let i = 0; i < 16; i++) {
    h.summon();
    const id = h.timer.snapshot().intervalId;
    assert.equal(h.window.visible, true);
    h.ipc.emit(IPC.dismiss, h.event, id);
    const next = h.timer.snapshot();
    assert.equal(next.phase, 'WORKING');
    assert.equal(h.window.visible, false);
    assert.equal('visitSuppressed' in next, false);
    assert.equal('punishment' in next, false);
    h.ipc.emit(IPC.dismiss, h.event, id);
    assert.deepEqual(h.timer.snapshot(), next);
    assert.equal(h.timeouts.size, 0);
  }
  assert.equal(h.ipc.listenerCount('murz:protest'), 0);
  assert.equal(h.ipc.listenerCount('murz:reject-punishment-snooze'), 0);
  assert.equal(h.ipc.listenerCount('murz:passive-motion-done'), 0);
});

test('main overlay retains nonactivating fullscreen flags and the secondary display in DIP', t => {
  const h = harness('darwin'); t.after(() => h.controller.dispose()); h.summon();
  assert.deepEqual(h.window.level, [true, 'pop-up-menu']);
  assert.equal(h.window.workspaces[0], true);
  assert.equal((h.window.workspaces[1] as any).visibleOnFullScreen, true);
  assert.equal((h.window.workspaces[1] as any).skipTransformProcessType, true);
  assert.equal(h.window.options.focusable, false);
  assert.equal(h.window.options.type, 'panel');
  assert.equal(h.window.options.webPreferences.sandbox, true);
  assert.equal(h.window.options.webPreferences.contextIsolation, true);
  assert.equal(h.window.options.webPreferences.nodeIntegration, false);
  assert.ok(h.window.bounds.x >= h.display.workArea.x && h.window.bounds.x < 0);
  assert.ok(h.window.bounds.width <= h.display.workArea.width);
});

test('dismissal cancels a queued display reflow and its obsolete readiness watchdog', t => {
  const h = harness('win32'); t.after(() => h.controller.dispose()); h.summon();
  h.screen.emit('display-metrics-changed');
  const staleReflow = [...h.timeouts.values()].find(timer => timer.ms === 100)!.callback;
  h.timer.stop();
  staleReflow(); h.advance(15000);
  assert.equal(h.quit(), 0);
  assert.equal(h.window.visible, false); assert.equal(h.window.ignored, true);
  assert.equal(h.timeouts.size, 0);
});

test('only an outstanding wanted revision can time out; old callbacks cannot cancel a newer visit', t => {
  const h = harness('win32'); t.after(() => h.controller.dispose());
  assert.equal(h.timeouts.size, 0, 'an intentionally hidden window has no ready watchdog');
  h.screen.emit('display-metrics-changed'); h.advance(100); h.advance(15000);
  assert.equal(h.quit(), 0);
  h.timer.startBreakNow();
  const oldTimeout = [...h.timeouts.values()].find(timer => timer.ms === 15000)!.callback;
  h.timer.stop(); h.timer.startBreakNow();
  oldTimeout();
  assert.equal(h.quit(), 0);
  h.ready(); h.advance(15000);
  assert.equal(h.window.visible, true); assert.equal(h.quit(), 0);
  h.timer.stop(); h.timer.startBreakNow(); h.advance(15000);
  assert.equal(h.quit(), 1); assert.equal(h.window.visible, false); assert.equal(h.window.ignored, true);
  const failure = h.diagnostics.find(entry => entry.event === 'failed');
  assert.equal(failure?.reason, 'renderer-timeout');
  assert.equal(failure?.revision, h.diagnostics.filter(entry => entry.event === 'layout-sent').at(-1)?.revision);
  assert.equal(failure?.stage, 'awaiting-layout');
  assert.match(h.errors[0], /renderer-timeout/);
});

test('HTML loading succeeds while hidden, or fails with a distinct bounded watchdog', async t => {
  const loaded = harness('win32'); t.after(() => loaded.controller.dispose());
  await loaded.controller.load();
  loaded.window.webContents.emit('did-finish-load');
  loaded.advance(15000);
  assert.equal(loaded.timeouts.size, 0); assert.equal(loaded.quit(), 0); assert.equal(loaded.window.visible, false);
  assert.ok(loaded.diagnostics.some(entry => entry.event === 'html-loaded'));

  const rejected = harness('win32'); t.after(() => rejected.controller.dispose());
  rejected.window.loadFile = async () => { throw new Error('secret path to missing HTML'); };
  await rejected.controller.load();
  assert.equal(rejected.quit(), 1); assert.match(rejected.errors[0], /html-load/);
  assert.doesNotMatch(JSON.stringify(rejected.diagnostics), /secret/);

  const stalled = harness('win32'); t.after(() => stalled.controller.dispose());
  let finish!: () => void;
  stalled.window.loadFile = () => new Promise<void>(resolve => { finish = resolve; });
  const loading = stalled.controller.load();
  stalled.advance(15000);
  assert.equal(stalled.quit(), 1); assert.match(stalled.errors[0], /html-timeout/);
  finish(); await loading;
  assert.equal(stalled.timeouts.size, 0); assert.equal(stalled.window.visible, false);
});

test('main-frame load and preload errors fail once, while a subframe error cannot close Murz', t => {
  for (const kind of ['html', 'preload']) {
    const h = harness('win32'); t.after(() => h.controller.dispose());
    h.window.webContents.emit('did-fail-load', {}, -6, 'private details', 'file:///private', false);
    assert.equal(h.quit(), 0);
    if (kind === 'html') h.window.webContents.emit('did-fail-load', {}, -6, 'private details', 'file:///private', true);
    else h.window.webContents.emit('preload-error', {}, '/private', new Error('private details'));
    h.window.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
    assert.equal(h.quit(), 1); assert.equal(h.window.ignored, true); assert.equal(h.window.visible, false);
    assert.doesNotMatch(JSON.stringify(h.diagnostics), /private/);
  }
});

test('shape is applied only after matching ready and its native duration is diagnosed', t => {
  const h = harness('win32'); t.after(() => h.controller.dispose());
  assert.equal(h.window.shapes.length, 0);
  h.timer.startBreakNow(); assert.equal(h.window.shapes.length, 0);
  h.ipc.emit(IPC.ready, h.event, h.snapshot().revision - 1);
  assert.equal(h.window.shapes.length, 0); assert.equal(h.window.ignored, true);
  h.ready();
  assert.equal(h.window.shapes.length, 1);
  const applied = h.diagnostics.find(entry => entry.event === 'shape-applied');
  assert.ok(applied && applied.count > 0 && applied.count <= 4096 && applied.elapsedMs >= 0);
});

test('Windows stays click-through until loaded image readiness, showing, and region setup finish', t => {
  for (const shapeFails of [false, true]) {
    const h = harness('win32', shapeFails); t.after(() => h.controller.dispose());
    const setShape = h.window.setShape.bind(h.window);
    h.window.setShape = rects => {
      assert.equal(h.window.visible, true);
      assert.equal(h.window.ignored, true, 'native region setup must not claim desktop input');
      setShape(rects);
    };
    h.window.on('show', () => {
      assert.equal(h.window.ignored, true);
      assert.equal(h.intervals.size, 0, 'fallback cannot start before image readiness');
    });
    h.timer.startBreakNow();
    h.ipc.emit(IPC.diagnostic, h.event, h.snapshot().revision, 'layout-applied');
    h.ipc.emit(IPC.diagnostic, h.event, h.snapshot().revision, 'image-loading');
    assert.equal(h.window.visible, false); assert.equal(h.window.ignored, true);
    const { button } = h.snapshot().layout;
    h.cursor.x = h.window.bounds.x + button.x + button.width / 2;
    h.cursor.y = h.window.bounds.y + button.y + button.height / 2;
    h.ready();
    assert.equal(h.window.visible, true); assert.equal(h.window.ignored, false);
    h.timer.stop(); assert.equal(h.window.visible, false); assert.equal(h.window.ignored, true);
  }
});

test('Windows fallback passes transparent pixels, retains buttons, and never leaves a hidden input rectangle', t => {
  for (const unavailable of [false, true]) {
    const h = harness('win32', !unavailable); t.after(() => h.controller.dispose());
    if (unavailable) (h.window as any).setShape = undefined;
    h.summon();
    assert.equal(h.window.visible, true); assert.equal(h.window.ignored, true);
    const { button, cat } = h.snapshot().layout;
    for (const rect of [button, cat]) {
      h.cursor.x = h.window.bounds.x + rect.x + rect.width / 2;
      h.cursor.y = h.window.bounds.y + rect.y + rect.height / 2;
      for (const poll of h.intervals.values()) poll();
      assert.equal(h.window.ignored, false);
    }
    h.cursor.x = -10000; for (const poll of h.intervals.values()) poll();
    assert.equal(h.window.ignored, true);
    h.timer.stop(); assert.equal(h.intervals.size, 0); assert.equal(h.window.visible, false);
    h.summon();
    if (!unavailable) assert.equal(h.window.shapes.length, 2, 'a rejected native shape is not retried on every visit');
  }
});

test('failure to reset a partially applied shape fails closed without throwing or blocking the desktop', t => {
  const h = harness('win32'); t.after(() => h.controller.dispose());
  h.window.setShape = () => { throw new Error('native region unavailable'); };
  assert.doesNotThrow(() => h.summon());
  assert.equal(h.quit(), 1); assert.equal(h.window.visible, false); assert.equal(h.window.ignored, true);
  assert.match(h.errors[0], /shape-reset/);
});

test('over-budget Windows shapes restore the previous region and use alpha polling', t => {
  const h = harness('win32'); t.after(() => h.controller.dispose());
  h.summon(); h.timer.stop(); h.timer.startBreakNow();
  h.controller.mask = { width: 130, height: 130,
    pixels: Uint8Array.from({ length: 130 * 130 }, (_, i) => (i + Math.floor(i / 130)) % 2) };
  h.ready();
  assert.equal(h.window.shapes.length, 2); assert.equal(h.window.shapes[1].length, 0);
  assert.equal(h.intervals.size, 1); assert.equal(h.window.visible, true); assert.equal(h.window.ignored, true);
  assert.ok(h.diagnostics.some(entry => entry.event === 'shape-fallback' && entry.reason === 'rectangle-limit'));
});

test('renderer diagnostics and failures require the current revision and trusted main frame', t => {
  const h = harness('win32'); t.after(() => h.controller.dispose());
  h.timer.startBreakNow(); const old = h.snapshot().revision;
  h.timer.stop(); h.timer.startBreakNow(); const revision = h.snapshot().revision;
  for (const event of [{ sender: {}, senderFrame: {} }, { ...h.event, senderFrame: {} }]) {
    h.ipc.emit(IPC.error, event, 'image-decode', revision);
    h.ipc.emit(IPC.diagnostic, event, revision, 'decoding');
  }
  h.ipc.emit(IPC.error, h.event, 'image-decode', old);
  h.ipc.emit(IPC.error, h.event, '/private/raw error', revision);
  h.ipc.emit(IPC.diagnostic, h.event, old, 'decoding');
  h.ipc.emit(IPC.diagnostic, h.event, revision, '/private/raw error');
  assert.equal(h.quit(), 0);
  assert.equal(h.diagnostics.filter(entry => entry.event === 'renderer-progress').length, 0);
  h.ipc.emit(IPC.diagnostic, h.event, revision, 'decoding');
  h.ipc.emit(IPC.diagnostic, h.event, revision, 'decoding');
  assert.equal(h.diagnostics.filter(entry => entry.event === 'renderer-progress').length, 1);
  h.ipc.emit(IPC.error, h.event, 'image-decode', revision);
  assert.equal(h.quit(), 1); assert.match(h.errors[0], /image-decode/);
});
