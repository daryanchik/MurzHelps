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
import { bindTimerView } from '../src/main/timer-view';
import { VisitPresentation } from '../src/main/visit-presentation';

// Run the real service code with a small Electron substitute. These are not GUI tests.
const requireNode = createRequire(`${process.cwd()}/package.json`);
const sources = Object.fromEntries(['settings-window', 'tray', 'warning', 'reward', 'work-timer'].map(name => [name,
  buildSync({ entryPoints: [`src/main/${name}.ts`], bundle: true, platform: 'node', format: 'cjs',
    external: ['electron'], write: false }).outputFiles[0].text]));

function harness(assets = ['mw.png']) {
  const windows: FakeWindow[] = [], notifications: FakeNotification[] = [], menus: any[] = [];
  const timeouts = new Map<object, { callback: () => void; ms: number }>();
  const ipc = Object.assign(new EventEmitter(), {
    handlers: new Map<string, (...args: any[]) => any>(),
    handle(name: string, callback: (...args: any[]) => any) { this.handlers.set(name, callback); },
    removeHandler(name: string) { this.handlers.delete(name); },
  });
  class FakeWindow extends EventEmitter {
    destroyed = false; visible = false; query: any;
    sent: { channel: string; payload: any }[] = [];
    webContents = Object.assign(new EventEmitter(), { mainFrame: {}, setWindowOpenHandler() {},
      send: (channel: string, payload: any) => this.sent.push({ channel, payload }) });
    constructor(readonly options: any) { super(); windows.push(this); }
    setMenu() {} setAlwaysOnTop() {} setVisibleOnAllWorkspaces() {} focus() {} moveTop() {}
    ignored = false;
    setIgnoreMouseEvents(value: boolean) { this.ignored = value; }
    setBounds(bounds: object) { Object.assign(this.options, bounds); }
    getBounds() { const { x, y, width, height } = this.options; return { x, y, width, height }; }
    isVisible() { return this.visible; }
    hide() { this.visible = false; this.emit('hide'); }
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
  const primary = { id: 1, scaleFactor: 1, workArea: { x: 0, y: 24, width: 1440, height: 876 } };
  const secondary = { id: 2, scaleFactor: 2, workArea: { x: -1920, y: -200, width: 1920, height: 1080 } };
  const electron = { BrowserWindow: FakeWindow, Notification: FakeNotification, ipcMain: ipc, Tray: FakeTray,
    Menu: { buildFromTemplate: (items: any[]) => {
      const menu = { items, getMenuItemById: (id: string) => items.find(item => item.id === id) };
      menus.push(menu); return menu;
    } },
    nativeImage: { createFromPath: () => ({ isEmpty: () => false, setTemplateImage() {} }) },
    screen: Object.assign(new EventEmitter(), {
      getPrimaryDisplay: () => primary, getAllDisplays: () => [primary, secondary],
      getCursorScreenPoint: () => ({ x: -300, y: 100 }), getDisplayNearestPoint: () => secondary,
      getDisplayMatching: (bounds: { x: number }) => bounds.x < 0 ? secondary : primary,
    }),
  };
  const load = (name: string) => {
    const module = { exports: {} as any };
    vm.runInNewContext(sources[name], { module, exports: module.exports,
      require: (id: string) => id === 'electron' ? electron : id === 'node:fs' ? {
        ...requireNode(id), readdirSync: (dir: string, options: any) => dir === '/assets'
          ? assets.map(name => ({ name, isFile: () => true })) : requireNode(id).readdirSync(dir, options),
      } : requireNode(id),
      __dirname: '/app/dist/main', process: { platform: 'darwin' }, console: { error() {}, warn() {} },
      setTimeout: (callback: () => void, ms: number) => { const handle = {}; timeouts.set(handle, { callback, ms }); return handle; },
      clearTimeout: (handle: object) => timeouts.delete(handle),
    });
    return module.exports;
  };
  const ready = (win = windows.at(-1)!) => ipc.emit(IPC.passiveReady,
    { sender: win.webContents, senderFrame: win.webContents.mainFrame }, 320, 270);
  const expire = (ms: number) => {
    for (const [handle, timeout] of [...timeouts]) if (timeout.ms === ms) {
      timeouts.delete(handle); timeout.callback();
    }
  };
  return { load, ipc, windows, notifications, menus, timeouts, electron, ready, expire, secondary };
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

test('one transparent warning appears on the cursor display only after authorized renderer readiness', async () => {
  const h = harness(); let now = 0;
  const timer = new BreakTimer(undefined, () => now);
  const warning = new (h.load('warning').BreakWarning)(timer, '/assets');
  timer.start(); now = 25 * 60_000; timer.tick(); timer.tick(); await Promise.resolve();
  assert.equal(h.notifications.length, 0); assert.equal(h.windows.length, 1);
  const win = h.windows[0];
  assert.equal(win.visible, false);
  h.ipc.emit(IPC.passiveReady, { sender: {}, senderFrame: {} }, 320, 270);
  h.ipc.emit(IPC.passiveReady, { sender: win.webContents, senderFrame: {} }, 320, 270);
  assert.equal(win.visible, false);
  h.ready(win); h.ready(win);
  assert.equal(win.visible, true); assert.equal(win.ignored, true);
  assert.equal(win.options.transparent, true); assert.equal(win.options.focusable, false);
  assert.equal(win.options.y + win.options.height, 880 - 12);
  assert.equal(win.options.x + win.options.width, -12);
  assert.equal(win.options.webPreferences.sandbox, true);
  assert.equal(win.options.webPreferences.nodeIntegration, false);
  assert.equal(win.query.asset, 'mw'); assert.ok(murzCopy.warning.includes(win.query.message));
  assert.equal(h.timeouts.size, 1);
  assert.equal([...h.timeouts.values()][0].ms, 6000);
  now = 30 * 60_000; timer.tick(); assert.equal(win.destroyed, true);
  warning.dispose();
});

test('warning expires without changing work, and is not repeated after pause/resume', async () => {
  const h = harness(); let now = 0;
  const timer = new BreakTimer(undefined, () => now);
  const warning = new (h.load('warning').BreakWarning)(timer, '/assets');
  timer.start(); now = 25 * 60_000; timer.tick(); await Promise.resolve();
  h.ready(); h.expire(6000); assert.equal(h.windows[0].destroyed, true);
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
  const h = harness([]);
  const timer = new BreakTimer({ ...DEFAULT_SETTINGS, warningMinutes: 0 }, () => 0);
  const warning = new (h.load('warning').BreakWarning)(timer, '/assets');
  timer.start(); assert.equal(h.windows.length, 0);
  h.electron.nativeImage.createFromPath = (file?: string) => ({ isEmpty: () => !file?.endsWith('/murz.png'), setTemplateImage() {} });
  timer.configure({ ...DEFAULT_SETTINGS, warningMinutes: 5, workMinutes: 5 });
  timer.restartWork(); await Promise.resolve();
  assert.equal(h.windows[0].query.asset, 'mb'); warning.dispose();
  assert.equal(h.windows[0].destroyed, true); assert.equal(h.timeouts.size, 0);
});

test('a complete natural cycle shows the shirt once for five seconds and can reward the next cycle', () => {
  const h = harness(); let now = 0, priority = 0;
  const timer = new BreakTimer(undefined, () => now);
  const reward = new (h.load('reward').CycleReward)(timer, '/assets', () => priority++);
  timer.start();
  for (let cycle = 1; cycle <= 2; cycle++) {
    for (let interval = 0; interval < 8; interval++) {
      now += timer.snapshot().remainingMs; timer.tick();
    }
    assert.equal(h.windows.length, cycle);
    const win = h.windows.at(-1)!;
    assert.equal(win.query.mode, 'reward'); assert.equal(win.query.asset, 'murz-shirt');
    assert.equal(win.query.message, murzCopy.reward);
    h.ready(win); timer.tick(); timer.tick();
    assert.equal(win.visible, true); assert.equal(priority, cycle);
    assert.equal([...h.timeouts.values()][0].ms, 5000);
    h.expire(5000); assert.equal(win.destroyed, true);
  }
  reward.dispose(); assert.equal(h.timeouts.size, 0);
});

test('one dismissal excludes only that cycle from the shirt reward; the next clean cycle is eligible', () => {
  const h = harness(); let now = 0;
  const timer = new BreakTimer(undefined, () => now);
  const reward = new (h.load('reward').CycleReward)(timer, '/assets', () => {});
  timer.start(); now += timer.snapshot().remainingMs; timer.tick();
  const oldId = timer.snapshot().intervalId;
  assert.equal(timer.dismissBreak(oldId), true); assert.equal(timer.dismissBreak(oldId), false);
  for (let i = 0; i < 6; i++) { now += timer.snapshot().remainingMs; timer.tick(); }
  assert.equal(timer.snapshot().cycleId, 2); assert.equal(h.windows.length, 0);
  for (let i = 0; i < 8; i++) { now += timer.snapshot().remainingMs; timer.tick(); }
  assert.equal(h.windows.length, 1); assert.equal(h.windows[0].query.asset, 'murz-shirt');
  reward.dispose();
});

test('shirt reward does not appear for a snoozed, skipped, stopped or stale cycle', () => {
  for (const action of ['snooze', 'skip', 'stop', 'late']) {
    const h = harness(); let now = 0;
    const timer = new BreakTimer(undefined, () => now);
    const reward = new (h.load('reward').CycleReward)(timer, '/assets', () => {});
    timer.start();
    if (action === 'skip') timer.startBreakNow();
    else { now += timer.snapshot().remainingMs; timer.tick(); }
    if (action === 'snooze') {
      timer.snooze(timer.snapshot().intervalId);
      now += timer.snapshot().remainingMs; timer.tick();
    }
    if (action === 'stop') {
      timer.stop(); now += 100 * 60_000; timer.tick();
    } else {
      for (let i = 0; i < 7; i++) {
        now += timer.snapshot().remainingMs + (action === 'late' && i === 6 ? 3000 : 0); timer.tick();
      }
    }
    assert.equal(h.windows.length, 0, action); reward.dispose();
  }
});

for (const kind of ['short', 'long'] as const) test(`floating timer preserves ${kind} snooze, pause, visibility order and saved geometry`, async () => {
  const h = harness(); let now = 0, shown = 0;
  const timer = new BreakTimer({ ...DEFAULT_SETTINGS, showWorkTimer: true, longEvery: kind === 'long' ? 1 : 4 }, () => now);
  const saved = { x: -480, y: 100, width: 240, height: 96, displayId: 2 };
  const writes: unknown[] = [];
  const controller = new (h.load('work-timer').FloatingWorkTimer)(timer, { saveGeometry: async (value: unknown) => writes.push(value) }, saved);
  const presentation = new VisitPresentation(['ms1', 'ms2'], () => 0);
  const unbind = bindTimerView(timer, {
    setTimerSnapshot() {}, dismiss() {}, summon() {
      shown++; assert.equal(h.windows[0].visible, false, 'widget hides before the break overlay appears');
    },
  });
  timer.start(); await Promise.resolve();
  const win = h.windows[0];
  assert.equal(win.visible, true); assert.deepEqual(win.getBounds(), { x: -480, y: 100, width: 240, height: 96 });
  now += timer.snapshot().remainingMs; timer.tick();
  assert.equal(timer.snapshot().visitKind, kind); assert.equal(shown, 1);
  const initial = presentation.forVisit(timer.snapshot()), visit = timer.snapshot().visitId;
  timer.snooze(timer.snapshot().intervalId);
  assert.equal(win.visible, true); assert.equal(win.sent.at(-1)!.payload.remainingMs, 300_000);
  now += 1000; timer.tick(); assert.equal(win.sent.at(-1)!.payload.remainingMs, 299_000);
  timer.pause(); now += 50_000; timer.tick();
  assert.equal(win.visible, true); assert.equal(win.sent.at(-1)!.payload.paused, true);
  assert.equal(timer.snapshot().remainingMs, 299_000);
  timer.resume(); now += 299_000; timer.tick();
  assert.equal(win.visible, false); assert.equal(shown, 2);
  assert.equal(timer.snapshot().visitId, visit); assert.deepEqual(presentation.forVisit(timer.snapshot()), initial);
  timer.dismissBreak(timer.snapshot().intervalId); assert.equal(win.visible, true);
  assert.equal(win.sent.at(-1)!.payload.phase, 'WORKING');
  timer.startBreakNow(); timer.snooze(timer.snapshot().intervalId); timer.stop();
  assert.equal(win.visible, false);
  timer.restartWork(); assert.equal(win.visible, true); assert.equal(win.sent.at(-1)!.payload.phase, 'WORKING');
  assert.equal(h.windows.length, 1); assert.deepEqual(win.getBounds(), { x: -480, y: 100, width: 240, height: 96 });
  assert.throws(() => h.ipc.handlers.get(IPC.workTimerGet)!({ sender: {}, senderFrame: {} }));
  unbind(); controller.dispose(); assert.equal(win.destroyed, true); assert.equal(writes.length, 1);
});

test('disabled floating timer remains absent during work and snooze', () => {
  const h = harness(); const timer = new BreakTimer();
  const controller = new (h.load('work-timer').FloatingWorkTimer)(timer, { saveGeometry: async () => {} });
  timer.start(); timer.startBreakNow(); timer.snooze(timer.snapshot().intervalId);
  assert.equal(h.windows.length, 0); controller.dispose();
});

test('floating renderer uses exact captions and shared remaining time, ignores stale updates and keeps pause text', async () => {
  const code = buildSync({ entryPoints: ['src/renderer/work-timer.ts'], bundle: true, platform: 'browser', format: 'iife', write: false }).outputFiles[0].text;
  const nodes = Object.fromEntries(['#time', '#label', '#pause'].map(id => [id, { textContent: '' }]));
  let render!: (snapshot: any) => void;
  const timer = new BreakTimer();
  vm.runInNewContext(code, {
    document: { querySelector: (id: string) => nodes[id], querySelectorAll: () => [], addEventListener() {} },
    window: { addEventListener() {}, murzWorkTimer: {
      onTimer: (callback: typeof render) => { render = callback; }, get: async () => timer.snapshot(),
    } },
  });
  await Promise.resolve();
  render({ ...timer.snapshot(), revision: 1, phase: 'WORKING', remainingMs: 45_000 });
  assert.equal(nodes['#label'].textContent, 'Мурз придёт через'); assert.equal(nodes['#time'].textContent, '00:45');
  render({ ...timer.snapshot(), revision: 2, phase: 'SNOOZED', remainingMs: 299_001, paused: true });
  assert.equal(nodes['#label'].textContent, 'До возвращения Мурза осталось');
  assert.equal(nodes['#time'].textContent, '05:00'); assert.equal(nodes['#pause'].textContent, 'Пауза');
  render({ ...timer.snapshot(), revision: 1, phase: 'WORKING' });
  assert.equal(nodes['#label'].textContent, 'До возвращения Мурза осталось');
  render({ ...timer.snapshot(), revision: 3, phase: 'WARNING', remainingMs: 3_661_000 });
  assert.equal(nodes['#label'].textContent, 'Мурз придёт через');
  assert.equal(nodes['#time'].textContent, '01:01:01'); assert.equal(nodes['#pause'].textContent, '');
});
