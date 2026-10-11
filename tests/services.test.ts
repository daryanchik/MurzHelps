import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { buildSync } from 'esbuild';
import { BreakTimer } from '../src/main/timer';
import { IPC } from '../src/shared/types';
import { DEFAULT_SETTINGS } from '../src/shared/timer-state';

// Run the real service code with a small Electron substitute. These are not GUI tests.
const requireNode = createRequire(`${process.cwd()}/package.json`);
const sources = Object.fromEntries(['settings-window', 'tray', 'warning'].map(name => [name,
  buildSync({ entryPoints: [`src/main/${name}.ts`], bundle: true, platform: 'node', format: 'cjs',
    external: ['electron'], write: false }).outputFiles[0].text]));

function harness() {
  const windows: FakeWindow[] = [], notifications: FakeNotification[] = [], menus: any[] = [];
  const timeouts = new Map<object, () => void>();
  const ipc = Object.assign(new EventEmitter(), {
    handlers: new Map<string, (...args: any[]) => any>(),
    handle(name: string, callback: (...args: any[]) => any) { this.handlers.set(name, callback); },
    removeHandler(name: string) { this.handlers.delete(name); },
  });
  class FakeWindow extends EventEmitter {
    destroyed = false; visible = false; query: any;
    webContents = Object.assign(new EventEmitter(), { mainFrame: {}, setWindowOpenHandler() {} });
    constructor(readonly options: any) { super(); windows.push(this); }
    setMenu() {} setAlwaysOnTop() {} focus() {}
    show() { this.visible = true; } showInactive() { this.visible = true; }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this.visible = false; this.emit('closed'); }
    close() { this.destroy(); }
    async loadFile(_file: string, options?: any) { this.query = options?.query; this.emit('ready-to-show'); }
  }
  class FakeNotification extends EventEmitter {
    closed = false; shown = false;
    static isSupported() { return true; }
    constructor(readonly options: any) { super(); notifications.push(this); }
    show() { this.shown = true; }
    close() { this.closed = true; }
  }
  class FakeTray extends EventEmitter {
    destroyed = false; tooltip = ''; menu: any;
    setToolTip(value: string) { this.tooltip = value; }
    setContextMenu(menu: any) { this.menu = menu; }
    popUpContextMenu() {}
    destroy() { this.destroyed = true; }
  }
  const electron = { BrowserWindow: FakeWindow, Notification: FakeNotification, ipcMain: ipc, Tray: FakeTray,
    Menu: { buildFromTemplate: (items: any[]) => {
      const menu = { items, getMenuItemById: (id: string) => items.find(item => item.id === id) };
      menus.push(menu); return menu;
    } },
    nativeImage: { createFromPath: () => ({ isEmpty: () => false, setTemplateImage() {} }) },
    screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 24, width: 1440, height: 876 } }) },
  };
  const load = (name: string) => {
    const module = { exports: {} as any };
    vm.runInNewContext(sources[name], { module, exports: module.exports,
      require: (id: string) => id === 'electron' ? electron : requireNode(id),
      __dirname: '/app/dist/main', process: { platform: 'darwin' }, console: { error() {} },
      setTimeout: (callback: () => void) => { const handle = {}; timeouts.set(handle, callback); return handle; },
      clearTimeout: (handle: object) => timeouts.delete(handle),
    });
    return module.exports;
  };
  return { load, ipc, windows, notifications, menus, timeouts, FakeNotification };
}

test('tray commands and status remain consistent through the full timer lifecycle', () => {
  const h = harness(); let now = 0, settingsOpened = 0, quit = 0;
  const timer = new BreakTimer(undefined, () => now);
  const controller = h.load('tray').createTray('/assets', timer, () => settingsOpened++, () => quit++);
  const menu = h.menus[0];
  const item = (id: string) => menu.getMenuItemById(id);
  const click = (label: string) => menu.items.find((entry: any) => entry.label === label).click();
  assert.equal(item('status').label, 'Status: Idle');
  assert.equal(item('start').enabled, true); assert.equal(item('pause').enabled, false);
  click('Start Timer'); now = 1000; timer.tick();
  assert.equal(item('remaining').label, 'Remaining: 59:59');
  assert.equal(item('start').enabled, false);
  click('Pause'); assert.equal(item('pause').label, 'Resume');
  assert.equal(item('status').label, 'Status: Working (Paused)');
  click('Resume'); click('Start Break Now');
  assert.equal(item('status').label, 'Status: Break');
  click('Restart Work Timer'); assert.equal(item('remaining').label, 'Remaining: 01:00:00');
  click('Stop Timer'); assert.equal(timer.snapshot().phase, 'IDLE');
  click('Settings'); click('Quit MurzHelps');
  assert.equal(settingsOpened, 1); assert.equal(quit, 1);
  assert.equal(h.menus.length, 1, 'countdown must not rebuild the menu');
  controller.dispose(); assert.equal(controller.tray.destroyed, true);
});

test('settings IPC restricts callers, validates input, and applies only after saving succeeds', async () => {
  const h = harness(); const applied: unknown[] = []; let writes = 0, rejectWrite = false;
  const store = { get: () => DEFAULT_SETTINGS, save: async (input: unknown) => {
    writes++; if (rejectWrite) throw new Error('disk failed'); return input;
  } };
  const controller = new (h.load('settings-window').SettingsWindow)(store, (value: unknown) => applied.push(value));
  controller.show(); controller.show(); assert.equal(h.windows.length, 1);
  const win = h.windows[0];
  const event = { sender: win.webContents, senderFrame: win.webContents.mainFrame };
  const get = h.ipc.handlers.get(IPC.getSettings)!, save = h.ipc.handlers.get(IPC.saveSettings)!;
  assert.throws(() => get({ sender: {}, senderFrame: {} }));
  await assert.rejects(save({ sender: win.webContents, senderFrame: {} }, DEFAULT_SETTINGS));
  const invalid = await save(event, { ...DEFAULT_SETTINGS, workMinutes: 0 });
  assert.equal(invalid.ok, false); assert.equal(writes, 0);
  assert.equal((await save(event, DEFAULT_SETTINGS)).ok, true);
  assert.equal(applied.length, 1);
  rejectWrite = true;
  assert.equal((await save(event, DEFAULT_SETTINGS)).ok, false);
  assert.equal(applied.length, 1);
  h.ipc.emit(IPC.closeSettings, { sender: {}, senderFrame: {} }); assert.equal(win.destroyed, false);
  h.ipc.emit(IPC.closeSettings, event); assert.equal(win.destroyed, true);
  assert.throws(() => get(event));
  controller.dispose(); assert.equal(h.ipc.handlers.size, 0);
});

test('warning service sends one silent notification and closes it when work ends', () => {
  const h = harness(); let now = 0;
  const timer = new BreakTimer(undefined, () => now);
  const warning = new (h.load('warning').BreakWarning)(timer);
  timer.start(); now = 55 * 60_000; timer.tick(); timer.tick();
  assert.equal(h.notifications.length, 1);
  assert.equal(h.notifications[0].options.silent, true);
  assert.match(h.notifications[0].options.body, /05:00/);
  assert.equal(h.windows.length, 0);
  now = 60 * 60_000; timer.tick();
  assert.equal(h.notifications[0].closed, true);
  warning.dispose();
});

test('failed native warning falls back once and releases the window on pause or expiry', async () => {
  const h = harness(); let now = 0;
  const timer = new BreakTimer(undefined, () => now);
  const warning = new (h.load('warning').BreakWarning)(timer);
  timer.start(); now = 55 * 60_000; timer.tick();
  const failure = h.notifications[0].listeners('failed')[0];
  h.notifications[0].emit('failed'); h.notifications[0].emit('failed');
  await Promise.resolve();
  assert.equal(h.windows.length, 1); assert.equal(h.windows[0].visible, true);
  timer.pause(); assert.equal(h.windows[0].destroyed, true); assert.equal(h.timeouts.size, 0);
  timer.resume(); timer.startBreakNow(); failure();
  assert.equal(h.windows.length, 1, 'a stale asynchronous failure cannot show a warning during break');
  warning.dispose();
});

test('fallback automatically disappears after its timeout, and quit clears all resources', async () => {
  const h = harness(); h.FakeNotification.isSupported = () => false;
  const timer = new BreakTimer({ workMinutes: 1, breakMinutes: 1, warningMinutes: 1 }, () => 0);
  const warning = new (h.load('warning').BreakWarning)(timer);
  timer.start(); await Promise.resolve();
  assert.equal(h.windows[0].visible, true);
  [...h.timeouts.values()][0](); assert.equal(h.windows[0].destroyed, true);
  timer.restartWork(); await Promise.resolve();
  warning.dispose();
  assert.equal(h.windows[1].destroyed, true); assert.equal(h.timeouts.size, 0);
  timer.restartWork(); assert.equal(h.windows.length, 2);
});
