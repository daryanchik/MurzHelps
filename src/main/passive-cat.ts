import { BrowserWindow, ipcMain, nativeImage, screen, type IpcMainEvent } from 'electron';
import path from 'node:path';
import { murzAsset, type MurzAssetId } from '../shared/murz-assets';
import { IPC } from '../shared/types';
import { cursorDisplay, retainedDisplay } from './displays';
import { configureOverlay, desktopIsAvailable, showOverlay } from './platform';
import { logOverlay } from './overlay-diagnostics';

export type PassiveMode = 'warning' | 'reward';
interface PassiveOptions {
  mode: PassiveMode;
  asset: MurzAssetId;
  message: string;
  duration?: number;
}

/** One passive composition. Image and layout readiness are acknowledged before showing. */
export class PassiveCat {
  private window?: BrowserWindow;
  private options?: PassiveOptions;
  private displayId?: number;
  private timeout?: ReturnType<typeof setTimeout>;
  private loading?: ReturnType<typeof setTimeout>;
  private resolve?: (shown: boolean) => void;
  private phase?: 'loading' | 'visible';
  private disposed = false;
  private readonly reportedStages = new Set<string>();

  constructor(private readonly assets: string) {
    ipcMain.on(IPC.passiveReady, this.ready);
    ipcMain.on(IPC.passiveFailed, this.failed);
    ipcMain.on(IPC.passiveDiagnostic, this.diagnostic);
    screen.on('display-added', this.reposition);
    screen.on('display-removed', this.reposition);
    screen.on('display-metrics-changed', this.reposition);
  }

  get visible(): boolean { return !!this.window && !this.window.isDestroyed(); }

  async show(options: PassiveOptions): Promise<boolean> {
    this.clear();
    if (this.disposed || !desktopIsAvailable()) return false;
    const asset = murzAsset(options.asset);
    const image = nativeImage.createFromPath(path.join(this.assets, asset.file));
    if (image.isEmpty()) return false;
    this.options = options;
    this.phase = 'loading';
    const display = cursorDisplay();
    this.displayId = display.id;
    const area = display.workArea;
    const width = Math.max(1, Math.min(options.mode === 'reward' ? 460 : 380, area.width - 24));
    const height = Math.max(1, area.height - 24);
    const bounds = { width, height, x: area.x + area.width - width - 12, y: area.y + 12 };
    const win = new BrowserWindow({
      ...bounds, title: 'MurzHelps', ...(process.platform === 'darwin' ? { type: 'panel' as const } : {}),
      show: false, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
      resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
      focusable: false, skipTaskbar: true, alwaysOnTop: true, roundedCorners: false,
      enableLargerThanScreen: false,
      webPreferences: {
        preload: path.join(__dirname, '../preload/passive-preload.cjs'),
        sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false,
        backgroundThrottling: false, spellcheck: false,
      },
    });
    this.window = win;
    win.setMenu(null);
    win.setIgnoreMouseEvents(true, { forward: true });
    configureOverlay(win, options.mode === 'reward' ? 5 : 6);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.on('will-attach-webview', event => event.preventDefault());
    win.webContents.on('render-process-gone', () => { if (this.window === win) this.fail(); });
    win.webContents.on('unresponsive', () => { if (this.window === win) this.fail(); });
    win.once('closed', () => { if (this.window === win) this.fail(); });
    const result = new Promise<boolean>(resolve => { this.resolve = resolve; });
    this.loading = setTimeout(() => { if (this.window === win) this.fail('renderer-timeout'); }, 8000);
    void win.loadFile(path.join(__dirname, '../renderer/warning.html'), { query: {
      mode: options.mode, asset: options.asset, message: options.message,
      imageHeight: String(Math.min(options.mode === 'reward' ? 330 : 195, area.height * .45)),
      availableHeight: String(height),
      availableWidth: String(width), scaleFactor: String(display.scaleFactor),
    } }).catch(() => { if (this.window === win) this.fail('html-load'); });
    return result;
  }

  clear(): void {
    clearTimeout(this.timeout); clearTimeout(this.loading);
    this.timeout = this.loading = undefined;
    this.resolve?.(false); this.resolve = undefined;
    const win = this.window;
    this.window = undefined; this.options = undefined; this.phase = undefined;
    this.reportedStages.clear();
    if (win && !win.isDestroyed()) win.destroy();
  }

  dispose(): void {
    this.disposed = true;
    this.clear();
    ipcMain.off(IPC.passiveReady, this.ready);
    ipcMain.off(IPC.passiveFailed, this.failed);
    ipcMain.off(IPC.passiveDiagnostic, this.diagnostic);
    screen.off('display-added', this.reposition);
    screen.off('display-removed', this.reposition);
    screen.off('display-metrics-changed', this.reposition);
  }

  private authorized(event: IpcMainEvent): boolean {
    return !!this.window && !this.window.isDestroyed() && event.sender === this.window.webContents
      && event.senderFrame === this.window.webContents.mainFrame;
  }

  private ready = (event: IpcMainEvent, width: unknown, height: unknown): void => {
    if (!this.authorized(event) || !this.options || this.phase !== 'loading' || typeof width !== 'number' || typeof height !== 'number'
      || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0
      || width > 32768 || height > 32768) return;
    if (!desktopIsAvailable()) { this.clear(); return; }
    clearTimeout(this.loading);
    const win = this.window!;
    const area = retainedDisplay(this.displayId).workArea;
    const w = Math.min(Math.ceil(width), Math.max(1, area.width - 24)), h = Math.min(Math.ceil(height), Math.max(1, area.height - 24));
    win.setBounds({ width: w, height: h, x: area.x + area.width - w - 12, y: area.y + area.height - h - 12 }, false);
    showOverlay(win);
    this.entered();
  };

  private entered(): void {
    this.phase = 'visible';
    this.resolve?.(true); this.resolve = undefined;
    if (this.options?.duration) this.timeout = setTimeout(() => this.clear(), this.options!.duration);
  }

  private diagnostic = (event: IpcMainEvent, stage: unknown): void => {
    if (!this.authorized(event) || typeof stage !== 'string' || this.reportedStages.has(stage)
      || !['image-loading', 'image-loaded', 'decoding', 'layout-applied', 'ready-sent'].includes(stage)) return;
    this.reportedStages.add(stage);
    logOverlay('passive-progress', { stage, asset: this.options!.asset, phase: this.phase ?? 'loading' });
  };
  private failed = (event: IpcMainEvent, reason: unknown): void => {
    if (this.authorized(event) && typeof reason === 'string'
      && ['image-load', 'image-timeout', 'image-decode', 'layout'].includes(reason)) this.fail(reason);
  };
  private fail(reason = 'passive-window'): void {
    if (this.options) logOverlay('passive-failed', { reason, asset: this.options.asset, phase: this.phase ?? 'loading' });
    this.clear();
  }
  private reposition = (): void => {
    if (!this.window || this.window.isDestroyed() || !this.options) return;
    const display = retainedDisplay(this.displayId);
    this.displayId = display.id;
    const area = display.workArea;
    const old = this.window.getBounds();
    const width = Math.min(old.width, Math.max(1, area.width - 24));
    const height = Math.min(old.height, Math.max(1, area.height - 24));
    this.window.setBounds({ width, height, x: area.x + area.width - width - 12, y: area.y + area.height - height - 12 }, false);
  };
}
