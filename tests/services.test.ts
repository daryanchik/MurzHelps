import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { buildSync } from 'esbuild';
import { BreakTimer } from '../src/main/timer';
import { IPC } from '../src/shared/types';
import { DEFAULT_SETTINGS } from '../src/shared/timer-state';
import { murzCopy } from '../src/shared/murz-copy';

// Run the real service code with a small Electron substitute. These are not GUI tests.
const requireNode = createRequire(`${process.cwd()}/package.json`);
const sources = Object.fromEntries(['settings-window', 'tray', 'warning'].map(name => [name,
  buildSync({ entryPoints: [`src/main/${name}.ts`], bundle: true, platform: 'node', format: 'cjs',
    external: ['electron'], write: false }).outputFiles[0].text]));

function harness() {
  const windows: FakeWindow[] = [], notifications: FakeNotification[] = [], menus: any[] = [];
  const timeouts = new Map<object, { callback: () => void; ms: number }>();
  const ipc = Object.assign(new EventEmitter(), {
    handlers: new Map<string, (...args: any[]) => any>(),
    handle(name: string, callback: (...args: any[]) => any) { this.handlers.set(name, callback); },
    removeHandler(name: string) { this.handlers.delete(name); },
  });
  class FakeWindow extends EventEmitter {
    destroyed = false; visible = false; query: any;
    webContents = Object.assign(new EventEmitter(), { mainFrame: {}, setWindowOpenHandler() {} });
    constructor(readonly options: any) { super(); windows.push(this); }
    setMenu() {} setAlwaysOnTop() {} setVisibleOnAllWorkspaces() {} focus() {}
    ignored = false;
    setIgnoreMouseEvents(value: boolean) { this.ignored = value; }
    setBounds(bounds: object) { Object.assign(this.options, bounds); }
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
    screen: Object.assign(new EventEmitter(), { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 24, width: 1440, height: 876 } }) }),
  };
  const load = (name: string) => {
    const module = { exports: {} as any };
    vm.runInNewContext(sources[name], { module, exports: module.exports,
      require: (id: string) => id === 'electron' ? electron : requireNode(id),
      __dirname: '/app/dist/main', process: { platform: 'darwin' }, console: { error() {} },
      setTimeout: (callback: () => void, ms: number) => { const handle = {}; timeouts.set(handle, { callback, ms }); return handle; },
      clearTimeout: (handle: object) => timeouts.delete(handle),
    });
    return module.exports;
  };
  return { load, ipc, windows, notifications, menus, timeouts, electron };
}

test('Russian tray commands and availability follow work, visits, snooze, pause and idle', () => {
  const h = harness(); let now = 0, settingsOpened = 0, quit = 0;
  const timer = new BreakTimer(undefined, () => now);
  const controller = h.load('tray').createTray('/assets', timer, () => settingsOpened++, () => quit++);
  const menu = h.menus[0];
  const item = (id: string) => menu.getMenuItemById(id);
  const click = (label: string) => menu.items.find((entry: any) => entry.label === label).click();
  assert.equal(item('status').label, murzCopy.states.IDLE);
  assert.equal(item('start').enabled, true); assert.equal(item('pause').enabled, false);
  click(murzCopy.tray.start); now = 1000; timer.tick();
  assert.equal(item('remaining').label, `${murzCopy.untilArrival}: 29:59`);
  assert.equal(item('start').enabled, false);
  click(murzCopy.tray.pause); assert.equal(item('pause').label, murzCopy.tray.resume);
  assert.equal(item('status').label, `${murzCopy.states.WORKING} · ${murzCopy.paused}`);
  click(murzCopy.tray.resume); click(murzCopy.tray.summon);
  assert.equal(item('status').label, murzCopy.states.SHORT_VISIT);
  assert.equal(item('summon').enabled, false);
  timer.snooze(timer.snapshot().intervalId);
  assert.equal(item('status').label, murzCopy.states.SNOOZED);
  assert.equal(item('remaining').label, `${murzCopy.untilReturn}: 05:00`);
  assert.equal(item('summon').enabled, false);
  click(murzCopy.tray.restart); assert.equal(item('remaining').label, `${murzCopy.untilArrival}: 30:00`);
  assert.equal(item('summon').enabled, true);
  click(murzCopy.tray.stop); assert.equal(timer.snapshot().phase, 'IDLE');
  click(murzCopy.tray.settings); click(murzCopy.tray.quit);
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

test('one transparent passive warning cat appears at the primary bottom right, with no notification', async () => {
  const h = harness(); let now = 0;
  const timer = new BreakTimer(undefined, () => now);
  const warning = new (h.load('warning').BreakWarning)(timer, '/assets');
  timer.start(); now = 25 * 60_000; timer.tick(); timer.tick(); await Promise.resolve();
  assert.equal(h.notifications.length, 0); assert.equal(h.windows.length, 1);
  const win = h.windows[0];
  assert.equal(win.visible, true); assert.equal(win.ignored, true);
  assert.equal(win.options.transparent, true); assert.equal(win.options.focusable, false);
  assert.equal(win.options.y + win.options.height, 900 - 12);
  assert.equal(win.query.asset, 'mw'); assert.ok(murzCopy.warning.includes(win.query.message));
  assert.equal([...h.timeouts.values()][0].ms, 10_000);
  now = 30 * 60_000; timer.tick(); assert.equal(win.destroyed, true);
  warning.dispose();
});

test('warning expires without changing work, and is not repeated after pause/resume', async () => {
  const h = harness(); let now = 0;
  const timer = new BreakTimer(undefined, () => now);
  const warning = new (h.load('warning').BreakWarning)(timer, '/assets');
  timer.start(); now = 25 * 60_000; timer.tick(); await Promise.resolve();
  [...h.timeouts.values()][0].callback(); assert.equal(h.windows[0].destroyed, true);
  assert.equal(timer.snapshot().phase, 'WARNING');
  timer.pause(); timer.resume(); timer.tick(); await Promise.resolve();
  assert.equal(h.windows.length, 1);
  timer.restartWork(); now += 25 * 60_000; timer.tick(); await Promise.resolve();
  assert.equal(h.windows.length, 2); timer.pause();
  assert.equal(h.windows[1].destroyed, true); assert.equal(h.timeouts.size, 0);
  warning.dispose(); assert.equal(h.electron.screen.listenerCount('display-added'), 0);
});

test('a stale asynchronous warning load cannot appear during a visit', async () => {
  const h = harness(); let now = 0;
  const timer = new BreakTimer(undefined, () => now);
  const warning = new (h.load('warning').BreakWarning)(timer, '/assets');
  timer.start(); now = 25 * 60_000; timer.tick(); timer.startBreakNow();
  await Promise.resolve();
  assert.equal(h.windows.length, 1); assert.equal(h.windows[0].destroyed, true);
  assert.equal(h.windows[0].visible, false); assert.equal(h.timeouts.size, 0);
  warning.dispose();
});

test('zero warning creates nothing; missing warning PNG falls back to the existing big cat', async () => {
  const h = harness();
  const timer = new BreakTimer({ ...DEFAULT_SETTINGS, warningMinutes: 0 }, () => 0);
  const warning = new (h.load('warning').BreakWarning)(timer, '/assets');
  timer.start(); assert.equal(h.windows.length, 0);
  h.electron.nativeImage.createFromPath = () => ({ isEmpty: () => true, setTemplateImage() {} });
  timer.configure({ ...DEFAULT_SETTINGS, warningMinutes: 5, workMinutes: 5 });
  timer.restartWork(); await Promise.resolve();
  assert.equal(h.windows[0].query.asset, 'mb'); warning.dispose();
  assert.equal(h.windows[0].destroyed, true); assert.equal(h.timeouts.size, 0);
});
