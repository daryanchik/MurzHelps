import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { buildSync } from 'esbuild';
import { IPC } from '../src/shared/types';

// Exercise the actual main-process controller without claiming an OS GUI test.
const code = buildSync({ entryPoints: ['src/main/window.ts'], bundle: true, platform: 'node', format: 'cjs', external: ['electron'], write: false }).outputFiles[0].text;
const requireNode = createRequire(`${process.cwd()}/package.json`);

function harness(platform: 'darwin' | 'win32', shapeFails = false) {
  const timeouts = new Map<object, { callback: () => void; ms: number }>();
  const intervals = new Map<object, () => void>();
  const ipc = Object.assign(new EventEmitter(), {
    handlers: new Map<string, (event: unknown) => unknown>(),
    handle(name: string, callback: (event: unknown) => unknown) { this.handlers.set(name, callback); },
    removeHandler(name: string) { this.handlers.delete(name); },
  });
  const display = { workArea: { x: -320, y: 20, width: 320, height: 240 } };
  const cursor = { x: -1000, y: -1000 };
  const screen = Object.assign(new EventEmitter(), {
    getPrimaryDisplay: () => display,
    getCursorScreenPoint: () => cursor,
  });
  const power = new EventEmitter();
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
    setMenu() {} setAlwaysOnTop() {} setVisibleOnAllWorkspaces() {}
    setIgnoreMouseEvents(ignore: boolean) { this.ignored = ignore; }
    isDestroyed() { return false; }
    isVisible() { return this.visible; }
    hide() { this.visible = false; this.emit('hide'); }
    showInactive() { this.visible = true; }
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
    dialog: { showErrorBox() {} },
    nativeImage: { createFromPath: () => ({ isEmpty: () => false, getSize: () => ({ width: 3, height: 3 }), toBitmap: () => bitmap }) },
  };
  const module = { exports: {} as any };
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require: (name: string) => name === 'electron' ? electron : requireNode(name),
    __dirname: '/app/dist/main', process: { platform }, console: { warn() {}, error() {} },
    setTimeout: (callback: () => void, ms: number) => { const id = {}; timeouts.set(id, { callback, ms }); return id; },
    clearTimeout: (id: object) => timeouts.delete(id),
    setInterval: (callback: () => void) => { const id = {}; intervals.set(id, callback); return id; },
    clearInterval: (id: object) => intervals.delete(id),
  });
  const controller = new module.exports.MurzWindow('/app/assets');
  const window: FakeWindow = controller.window;
  const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
  const snapshot = () => ipc.handlers.get(IPC.getLayout)!(event) as any;
  const ready = () => ipc.emit(IPC.ready, event, snapshot().revision);
  const advance = (ms: number) => {
    for (const [id, timer] of [...timeouts]) if (timer.ms === ms) { timeouts.delete(id); timer.callback(); }
  };
  return { controller, window, event, ipc, snapshot, ready, screen, display, cursor, intervals, timeouts, power, advance, quit: () => quit };
}

test('actual controller blocks early display; dismissal and summon reuse the same window', t => {
  const h = harness('darwin'); t.after(() => h.controller.dispose());
  assert.equal(h.window.visible, false);
  h.ready();
  assert.equal(h.window.visible, true);
  assert.equal(h.intervals.size, 1);
  h.ready();
  assert.equal(h.intervals.size, 1, 'duplicate ready cannot create another poller');
  h.ipc.emit(IPC.dismiss, h.event);
  assert.equal(h.window.visible, false);
  assert.equal(h.intervals.size, 0);
  assert.equal(h.window.ignored, true);
  h.controller.summon();
  assert.equal(h.window.visible, false);
  h.ready();
  assert.equal(h.window.visible, true);
});
test('macOS controller switches input using real screen coordinates and the alpha mask', t => {
  const h = harness('darwin'); t.after(() => h.controller.dispose());
  h.ready();
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
    h.ready();
    assert.ok(h.window.shapes[0].length > 0);
    assert.equal(h.window.visible, true);
    assert.equal(h.intervals.size, shapeFails ? 1 : 0);
    if (!shapeFails) assert.equal(h.window.ignored, false);
  }
});
test('monitor changes reject stale layouts and do not show a dismissed cat', t => {
  const h = harness('darwin'); t.after(() => h.controller.dispose());
  h.ready();
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
test('untrusted IPC cannot dismiss the overlay or read layout', t => {
  const h = harness('darwin'); t.after(() => h.controller.dispose()); h.ready();
  const forged = { sender: {}, senderFrame: {} };
  h.ipc.emit(IPC.dismiss, forged);
  assert.equal(h.window.visible, true);
  assert.throws(() => h.ipc.handlers.get(IPC.getLayout)!(forged));
  const subframe = { sender: h.window.webContents, senderFrame: {} };
  h.ipc.emit(IPC.dismiss, subframe);
  assert.equal(h.window.visible, true);
});
test('renderer failure releases the workspace; quit cleanup removes timers and listeners', () => {
  const h = harness('darwin'); h.ready();
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
