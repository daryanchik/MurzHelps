import { app, dialog, Menu, powerMonitor } from 'electron';
import path from 'node:path';
import squirrelStartup from 'electron-squirrel-startup';
import { configureApplication } from './platform';
import { createTray } from './tray';
import { MurzWindow } from './window';
import { BreakTimer } from './timer';
import { TimerRuntime } from './timer-runtime';
import { bindPowerEvents } from './power-events';
import { bindTimerView } from './timer-view';
import { SettingsStore } from './settings';
import { SettingsWindow } from './settings-window';
import { BreakWarning } from './warning';

let overlay: MurzWindow | undefined;
let tray: ReturnType<typeof createTray> | undefined;
let timer: BreakTimer | undefined;
let runtime: TimerRuntime | undefined;
let settingsWindow: SettingsWindow | undefined;
let warning: BreakWarning | undefined;
let quitting = false;
const subscriptions: (() => void)[] = [];

if (squirrelStartup) {
  app.quit();
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setName('MurzHelps');
  // The old manual summon is a full, timed break in v0.2.
  app.on('second-instance', () => timer?.startBreakNow());
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => {
    if (quitting) return;
    quitting = true;
    runtime?.dispose();
    for (const unsubscribe of subscriptions) unsubscribe();
    warning?.dispose();
    settingsWindow?.dispose();
    overlay?.dispose();
    tray?.dispose();
    tray = undefined;
  });

  void app.whenReady().then(async () => {
    configureApplication();
    Menu.setApplicationMenu(process.platform === 'darwin'
      ? Menu.buildFromTemplate([{ label: 'MurzHelps', submenu: [{ role: 'quit', label: 'Quit MurzHelps' }] }])
      : null);
    const assets = path.join(app.getAppPath(), 'assets');
    const store = new SettingsStore(app.getPath('userData'));
    const settings = await store.load();
    if (quitting) return;
    timer = new BreakTimer(settings);
    overlay = new MurzWindow(assets, id => timer?.dismissBreak(id));
    subscriptions.push(bindTimerView(timer, overlay), bindPowerEvents(powerMonitor, timer));
    settingsWindow = new SettingsWindow(store, settings => timer?.configure(settings));
    warning = new BreakWarning(timer);
    runtime = new TimerRuntime(timer);
    runtime.start();
    // Keep the Tray strongly referenced while the window is hidden.
    tray = createTray(assets, timer, () => settingsWindow?.show(), () => app.quit());
    await overlay.load();
  }).catch(error => {
    console.error(error);
    overlay?.dispose();
    dialog.showErrorBox('MurzHelps — ошибка запуска', String(error));
    app.quit();
  });
}
