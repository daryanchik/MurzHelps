import { BrowserWindow, nativeImage, screen } from 'electron';
import path from 'node:path';
import { murzAssets } from '../shared/murz-assets';
import { murzCopy } from '../shared/murz-copy';
import { ShuffleBag } from '../shared/shuffle-bag';
import type { TimerSnapshot } from '../shared/timer-state';
import { configureOverlay } from './platform';
import type { BreakTimer } from './timer';

/** A passive cat, never a system notification or a second work timer. */
export class BreakWarning {
  private window?: BrowserWindow;
  private timeout?: ReturnType<typeof setTimeout>;
  private activeId?: number;
  private disposed = false;
  private readonly unsubscribe: (() => void)[];
  private readonly messages = new ShuffleBag(murzCopy.warning);

  constructor(private readonly timer: BreakTimer, private readonly assetDirectory: string) {
    this.unsubscribe = [timer.onWarning(snapshot => this.show(snapshot)), timer.subscribe(snapshot => {
      if (snapshot.phase !== 'WARNING' || snapshot.intervalId !== this.activeId || snapshot.paused) this.clear();
    })];
    screen.on('display-added', this.reposition);
    screen.on('display-removed', this.reposition);
    screen.on('display-metrics-changed', this.reposition);
  }

  dispose(): void {
    this.disposed = true;
    for (const unsubscribe of this.unsubscribe) unsubscribe();
    screen.off('display-added', this.reposition);
    screen.off('display-removed', this.reposition);
    screen.off('display-metrics-changed', this.reposition);
    this.clear();
  }

  private bounds() {
    const area = screen.getPrimaryDisplay().workArea;
    const width = Math.min(340, area.width - 24), height = Math.min(280, area.height - 24);
    return { width, height, x: area.x + area.width - width - 12, y: area.y + area.height - height - 12 };
  }

  private reposition = (): void => {
    if (this.window && !this.window.isDestroyed()) this.window.setBounds(this.bounds(), false);
  };

  private show(snapshot: TimerSnapshot): void {
    if (this.disposed) return;
    this.clear();
    const id = snapshot.intervalId;
    this.activeId = id;
    const asset = nativeImage.createFromPath(path.join(this.assetDirectory, murzAssets.mw.file)).isEmpty() ? 'mb' : 'mw';
    const message = this.messages.next() ?? murzCopy.states.WARNING;
    const win = new BrowserWindow({
      ...this.bounds(), title: murzCopy.states.WARNING,
      show: false, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
      resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
      focusable: false, skipTaskbar: true, alwaysOnTop: true,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false, backgroundThrottling: false, spellcheck: false },
    });
    this.window = win;
    win.setMenu(null);
    win.setIgnoreMouseEvents(true, { forward: true });
    configureOverlay(win);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.on('will-attach-webview', event => event.preventDefault());
    win.once('closed', () => {
      if (this.window === win) { this.window = undefined; clearTimeout(this.timeout); }
    });
    void win.loadFile(path.join(__dirname, '../renderer/warning.html'), { query: { message, asset } }).then(() => {
      const current = this.timer.snapshot();
      if (win.isDestroyed()) return;
      if (this.disposed || this.activeId !== id || current.intervalId !== id || current.phase !== 'WARNING' || current.paused) {
        win.destroy(); return;
      }
      win.showInactive();
      this.timeout = setTimeout(() => { if (!win.isDestroyed()) win.destroy(); }, 10_000);
    }).catch(error => {
      console.error('Warning window failed:', error);
      if (!win.isDestroyed()) win.destroy();
    });
  }

  private clear(): void {
    this.activeId = undefined;
    clearTimeout(this.timeout);
    this.timeout = undefined;
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = undefined;
  }
}
