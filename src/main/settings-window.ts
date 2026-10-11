import { BrowserWindow, ipcMain, screen, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import { murzCopy } from '../shared/murz-copy';
import { IPC } from '../shared/types';
import { validateSettings, type SettingsSaveResult, type TimerSettings } from '../shared/timer-state';
import type { SettingsStore } from './settings';

export class SettingsWindow {
  private window?: BrowserWindow;
  private disposed = false;
  constructor(private readonly store: SettingsStore, private readonly apply: (settings: TimerSettings) => void) {
    ipcMain.handle(IPC.getSettings, event => {
      if (!this.authorized(event)) throw new Error('Unexpected IPC sender');
      return { settings: store.get(), loadWarning: store.loadWarning };
    });
    ipcMain.handle(IPC.saveSettings, async (event, input: unknown): Promise<SettingsSaveResult> => {
      if (!this.authorized(event)) throw new Error('Unexpected IPC sender');
      const checked = validateSettings(input);
      if (!checked.ok) return { ...checked, error: murzCopy.errors.checkFields };
      try {
        const saved = await store.save(checked.settings);
        if (!this.disposed) this.apply(saved);
        return { ok: true, settings: saved };
      } catch (error) {
        console.error('Could not save settings:', error);
        return { ok: false, error: murzCopy.errors.saveSettings };
      }
    });
    ipcMain.on(IPC.closeSettings, this.onClose);
  }

  show(): void {
    if (this.disposed) return;
    if (this.window && !this.window.isDestroyed()) { this.window.show(); this.window.focus(); return; }
    const area = screen.getPrimaryDisplay().workArea;
    const win = new BrowserWindow({
      title: murzCopy.settings.title, width: Math.min(560, area.width), height: Math.min(760, area.height), show: false,
      backgroundColor: '#F6F4ED',
      resizable: false, maximizable: false, fullscreenable: false, autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, '../preload/settings-preload.cjs'),
        sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false, spellcheck: false,
      },
    });
    this.window = win;
    win.setMenu(null);
    win.setAlwaysOnTop(true, 'floating');
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.on('will-attach-webview', event => event.preventDefault());
    win.once('ready-to-show', () => { if (!win.isDestroyed()) { win.show(); win.focus(); } });
    win.once('closed', () => { if (this.window === win) this.window = undefined; });
    void win.loadFile(path.join(__dirname, '../renderer/settings.html')).catch(error => {
      console.error('Could not open settings:', error);
      if (!win.isDestroyed()) win.close();
    });
  }

  dispose(): void {
    this.disposed = true;
    ipcMain.removeHandler(IPC.getSettings);
    ipcMain.removeHandler(IPC.saveSettings);
    ipcMain.off(IPC.closeSettings, this.onClose);
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = undefined;
  }

  private authorized(event: IpcMainInvokeEvent | IpcMainEvent): boolean {
    return !this.disposed && !!this.window && !this.window.isDestroyed()
      && event.sender === this.window.webContents && event.senderFrame === this.window.webContents.mainFrame;
  }
  private onClose = (event: IpcMainEvent): void => { if (this.authorized(event)) this.window?.close(); };
}
