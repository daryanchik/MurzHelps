import { BrowserWindow, ipcMain, screen, type IpcMainEvent, type IpcMainInvokeEvent, type Rectangle } from 'electron';
import path from 'node:path';
import { IPC, type WorkTimerGeometry } from '../shared/types';
import type { TimerSnapshot } from '../shared/timer-state';
import type { BreakTimer } from './timer';
import type { SettingsStore } from './settings';
import { cursorDisplay, fitBounds } from './displays';
import { configureOverlay, showOverlay, hideOverlay } from './platform';

export class FloatingWorkTimer {
  private window?: BrowserWindow;
  private ready = false;
  private failed = false;
  private disposed = false;
  private geometry?: WorkTimerGeometry;
  private pendingSave?: ReturnType<typeof setTimeout>;
  private resizing?: ReturnType<typeof setInterval>;
  private resizeTimeout?: ReturnType<typeof setTimeout>;
  private readonly unsubscribe: () => void;

  constructor(private readonly timer: BreakTimer, private readonly store: SettingsStore, geometry?: WorkTimerGeometry) {
    this.geometry = geometry;
    ipcMain.handle(IPC.workTimerGet, event => {
      if (!this.authorized(event)) throw new Error('Unexpected IPC sender');
      return timer.snapshot();
    });
    ipcMain.on(IPC.workTimerResizeStart, this.resizeStart);
    ipcMain.on(IPC.workTimerResizeEnd, this.resizeEnd);
    screen.on('display-added', this.reposition);
    screen.on('display-removed', this.reposition);
    screen.on('display-metrics-changed', this.reposition);
    this.unsubscribe = timer.subscribe(snapshot => this.sync(snapshot));
    this.sync(timer.snapshot());
  }

  private bounds(): WorkTimerGeometry {
    const saved = this.geometry;
    const displays = screen.getAllDisplays();
    let display = saved ? displays.find(item => item.id === saved.displayId) : undefined;
    if (!display && saved) {
      display = displays.find(item => saved.x < item.workArea.x + item.workArea.width && saved.x + saved.width > item.workArea.x
        && saved.y < item.workArea.y + item.workArea.height && saved.y + saved.height > item.workArea.y);
    }
    display ??= cursorDisplay();
    const area = display.workArea;
    const width = Math.min(area.width, Math.max(150, Math.min(420, saved?.width ?? 220)));
    const height = Math.min(area.height, Math.max(65, Math.min(180, saved?.height ?? 92)));
    return { ...fitBounds({ x: saved?.x ?? area.x + area.width - width - 20, y: saved?.y ?? area.y + 20, width, height }, area), displayId: display.id };
  }

  private create(): void {
    if (this.window || this.failed || this.disposed) return;
    try {
      const win = new BrowserWindow({
        ...this.bounds(), title: 'MurzHelps', ...(process.platform === 'darwin' ? { type: 'panel' as const } : {}),
        frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, show: false,
        focusable: false, skipTaskbar: true, alwaysOnTop: true, movable: true,
        // Custom edge handles also work with transparent windows on Windows.
        resizable: false, minimizable: false, maximizable: false, fullscreenable: false, closable: false,
        acceptFirstMouse: true, autoHideMenuBar: true,
        webPreferences: { preload: path.join(__dirname, '../preload/work-timer-preload.cjs'),
          contextIsolation: true, sandbox: true, nodeIntegration: false, devTools: false,
          backgroundThrottling: false, spellcheck: false },
      });
      this.window = win;
      configureOverlay(win, 7); win.setMenu(null);
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      win.webContents.on('will-navigate', event => event.preventDefault());
      win.webContents.on('will-attach-webview', event => event.preventDefault());
      win.webContents.on('render-process-gone', () => this.fail());
      win.webContents.on('unresponsive', () => this.fail());
      win.on('move', this.queueSave); win.on('resize', this.queueSave);
      win.on('close', event => { if (!this.disposed) event.preventDefault(); });
      win.once('closed', () => { if (this.window === win) { this.window = undefined; this.ready = false; } });
      void win.loadFile(path.join(__dirname, '../renderer/work-timer.html')).then(() => {
        if (win.isDestroyed() || this.disposed) return;
        this.ready = true; this.sync(this.timer.snapshot());
      }).catch(error => { console.warn('Floating timer unavailable:', error); this.fail(); });
    } catch (error) { console.warn('Floating timer unavailable:', error); this.fail(); }
  }

  private sync(snapshot: TimerSnapshot): void {
    if (this.disposed) return;
    const visible = snapshot.settings.showWorkTimer === true
      && (snapshot.phase === 'WORKING' || snapshot.phase === 'WARNING' || snapshot.phase === 'SNOOZED')
      && !snapshot.pauseReasons.some(reason => reason === 'lock' || reason === 'sleep');
    if (!snapshot.settings.showWorkTimer) this.failed = false;
    if (!visible) {
      this.endResize();
      if (this.window && !this.window.isDestroyed()) hideOverlay(this.window);
      return;
    }
    this.create();
    if (!this.ready || !this.window || this.window.isDestroyed()) return;
    this.window.webContents.send(IPC.workTimerUpdate, snapshot);
    if (!this.window.isVisible()) showOverlay(this.window);
  }

  private authorized(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
    return !this.disposed && !!this.window && !this.window.isDestroyed()
      && event.sender === this.window.webContents && event.senderFrame === this.window.webContents.mainFrame;
  }
  private resizeStart = (event: IpcMainEvent, edge: unknown): void => {
    if (!this.authorized(event) || typeof edge !== 'string' || !/^(n|s|e|w|ne|nw|se|sw)$/.test(edge)
      || !this.window?.isVisible()) return;
    this.endResize();
    const origin = screen.getCursorScreenPoint();
    const bounds = this.window.getBounds();
    this.resizing = setInterval(() => {
      if (!this.window || this.window.isDestroyed()) { this.endResize(); return; }
      const point = screen.getCursorScreenPoint();
      const dx = point.x - origin.x, dy = point.y - origin.y;
      const next: Rectangle = { ...bounds };
      if (edge.includes('e') || edge.includes('w')) next.width = Math.max(150, Math.min(420, bounds.width + (edge.includes('w') ? -dx : dx)));
      if (edge.includes('s') || edge.includes('n')) next.height = Math.max(65, Math.min(180, bounds.height + (edge.includes('n') ? -dy : dy)));
      if (edge.includes('w')) next.x = bounds.x + bounds.width - next.width;
      if (edge.includes('n')) next.y = bounds.y + bounds.height - next.height;
      this.window.setBounds(next, false);
    }, 16);
    this.resizeTimeout = setTimeout(() => this.endResize(), 30_000);
  };
  private resizeEnd = (event: IpcMainEvent): void => { if (this.authorized(event)) this.endResize(); };
  private endResize(): void {
    if (!this.resizing) return;
    clearInterval(this.resizing); clearTimeout(this.resizeTimeout);
    this.resizing = undefined;
    this.queueSave();
  }
  private queueSave = (): void => {
    clearTimeout(this.pendingSave);
    if (!this.resizing) this.pendingSave = setTimeout(() => { void this.persist(); }, 350);
  };
  private async persist(): Promise<void> {
    if (!this.window || this.window.isDestroyed()) return;
    const bounds = this.window.getBounds();
    const display = screen.getDisplayMatching(bounds);
    const safe = fitBounds(bounds, display.workArea);
    this.geometry = { ...safe, displayId: display.id };
    try { await this.store.saveGeometry(this.geometry); }
    catch (error) { console.warn('Could not save floating timer geometry:', error); }
  }
  private reposition = (): void => {
    this.endResize();
    if (!this.window || this.window.isDestroyed()) return;
    const bounds = this.window.getBounds();
    this.geometry = { ...bounds, displayId: screen.getDisplayMatching(bounds).id };
    const next = this.bounds();
    this.geometry = next;
    this.window.setBounds(next, false);
    this.queueSave();
  };
  private fail(): void {
    this.failed = true; this.ready = false; this.endResize();
    const win = this.window; this.window = undefined;
    if (win && !win.isDestroyed()) win.destroy();
  }
  dispose(): void {
    this.disposed = true;
    this.endResize(); clearTimeout(this.pendingSave);
    void this.persist();
    this.unsubscribe();
    ipcMain.removeHandler(IPC.workTimerGet);
    ipcMain.off(IPC.workTimerResizeStart, this.resizeStart); ipcMain.off(IPC.workTimerResizeEnd, this.resizeEnd);
    screen.off('display-added', this.reposition); screen.off('display-removed', this.reposition); screen.off('display-metrics-changed', this.reposition);
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = undefined;
  }
}
