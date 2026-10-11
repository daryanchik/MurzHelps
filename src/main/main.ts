import { app, dialog, Menu, type Tray } from 'electron';
import path from 'node:path';
import squirrelStartup from 'electron-squirrel-startup';
import { configureApplication } from './platform';
import { createTray } from './tray';
import { MurzWindow } from './window';

let overlay: MurzWindow | undefined;
let tray: Tray | undefined;

if (squirrelStartup) {
  app.quit();
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setName('MurzHelps');
  app.on('second-instance', () => overlay?.summon());
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => {
    overlay?.dispose();
    tray?.destroy();
    tray = undefined;
  });

  void app.whenReady().then(async () => {
    configureApplication();
    Menu.setApplicationMenu(process.platform === 'darwin'
      ? Menu.buildFromTemplate([{ label: 'MurzHelps', submenu: [{ role: 'quit', label: 'Quit MurzHelps' }] }])
      : null);
    const assets = path.join(app.getAppPath(), 'assets');
    overlay = new MurzWindow(assets);
    // Keep the Tray strongly referenced while the window is hidden.
    tray = createTray(assets, () => overlay?.summon(), () => app.quit());
    await overlay.load();
  }).catch(error => {
    console.error(error);
    overlay?.dispose();
    dialog.showErrorBox('MurzHelps — ошибка запуска', String(error));
    app.quit();
  });
}
