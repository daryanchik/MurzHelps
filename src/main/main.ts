import { app, dialog, Menu, powerMonitor } from 'electron';
import path from 'node:path';
import squirrelStartup from 'electron-squirrel-startup';
import { configureApplication, disposePlatform } from './platform';
import { createTray } from './tray';
import { MurzWindow } from './window';
import { BreakTimer } from './timer';
import { TimerRuntime } from './timer-runtime';
import { bindPowerEvents } from './power-events';
import { bindTimerView } from './timer-view';
import { SettingsStore } from './settings';
import { SettingsWindow } from './settings-window';
import { BreakWarning } from './warning';
import { CycleReward } from './reward';
import { FloatingWorkTimer } from './work-timer';
import { murzCopy } from '../shared/murz-copy';

let overlay: MurzWindow | undefined;
let tray: ReturnType<typeof createTray> | undefined;
let timer: BreakTimer | undefined;
let runtime: TimerRuntime | undefined;
let settingsWindow: SettingsWindow | undefined;
let warning: BreakWarning | undefined;
let reward: CycleReward | undefined;
let workTimer: FloatingWorkTimer | undefined;
let store: SettingsStore | undefined;
let quitting = false;
let flushed = false;
const subscriptions: (() => void)[] = [];

if (squirrelStartup) {
  app.quit();
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setName(murzCopy.brand);
  app.on('second-instance', () => settingsWindow?.show());
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', event => {
    if (quitting) return;
    quitting = true;
    runtime?.dispose();
    for (const unsubscribe of subscriptions) unsubscribe();
    reward?.dispose();
    workTimer?.dispose();
    warning?.dispose();
    settingsWindow?.dispose();
    overlay?.dispose();
    tray?.dispose();
    tray = undefined;
    disposePlatform();
    if (store && !flushed) {
      event.preventDefault();
      void store.flush().finally(() => { flushed = true; app.quit(); });
    }
  });
  process.on('unhandledRejection', error => {
    console.error(error); app.quit();
  });

  void app.whenReady().then(async () => {
    configureApplication();
    Menu.setApplicationMenu(process.platform === 'darwin'
      ? Menu.buildFromTemplate([{ label: murzCopy.brand, submenu: [{ role: 'quit', label: murzCopy.tray.quit }] }])
      : null);
    const assets = path.join(app.getAppPath(), 'assets');
    store = new SettingsStore(app.getPath('userData'));
    const [settings, geometry] = await Promise.all([store.load(), store.loadGeometry()]);
    if (quitting) return;
    timer = new BreakTimer(settings);
    reward = new CycleReward(timer, assets, () => warning?.clear());
    overlay = new MurzWindow(assets, id => timer?.dismissBreak(id), id => timer?.snooze(id));
    // Hide the floating countdown before the break overlay handles a return from snooze.
    workTimer = new FloatingWorkTimer(timer, store, geometry);
    subscriptions.push(bindTimerView(timer, overlay), bindPowerEvents(powerMonitor, timer));
    settingsWindow = new SettingsWindow(store, settings => timer?.configure(settings));
    warning = new BreakWarning(timer, assets, () => reward?.visible ?? false);
    runtime = new TimerRuntime(timer);
    runtime.start();
    // Keep the Tray strongly referenced while the window is hidden.
    tray = createTray(assets, timer, () => settingsWindow?.show(), () => app.quit());
    await overlay.load();
    if (!quitting) timer.startAutomatically();
  }).catch(error => {
    console.error(error);
    overlay?.dispose();
    dialog.showErrorBox(murzCopy.errors.startup, murzCopy.errors.startupBody);
    app.quit();
  });
}
