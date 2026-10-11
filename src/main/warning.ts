import { BrowserWindow, Notification, screen } from 'electron';
import path from 'node:path';
import { formatRemaining, type TimerSnapshot } from '../shared/timer-state';
import type { BreakTimer } from './timer';

/** Silent native notification, with a small nonmodal fallback for unsigned apps. */
export class BreakWarning {
  private notification?: Notification;
  private fallback?: BrowserWindow;
  private timeout?: ReturnType<typeof setTimeout>;
  private activeId?: number;
  private disposed = false;
  private readonly unsubscribe: (() => void)[];

  constructor(private readonly timer: BreakTimer) {
    this.unsubscribe = [timer.onWarning(snapshot => this.show(snapshot)), timer.subscribe(snapshot => {
      if (snapshot.phase !== 'WARNING' || snapshot.intervalId !== this.activeId || snapshot.paused) this.clear();
    })];
  }

  dispose(): void {
    this.disposed = true;
    for (const unsubscribe of this.unsubscribe) unsubscribe();
    this.clear();
  }

  private show(snapshot: TimerSnapshot): void {
    this.clear();
    this.activeId = snapshot.intervalId;
    const body = `До перерыва ${formatRemaining(snapshot.remainingMs)}. Скоро придёт Мурз.`;
    if (!Notification.isSupported()) { this.showFallback(snapshot.intervalId, body); return; }
    try {
      const notification = new Notification({ title: 'MurzHelps — скоро перерыв', body, silent: true });
      this.notification = notification;
      notification.once('failed', () => this.showFallback(snapshot.intervalId, body));
      notification.show();
    } catch { this.showFallback(snapshot.intervalId, body); }
  }

  private isCurrent(id: number): boolean {
    const snapshot = this.timer.snapshot();
    return !this.disposed && this.activeId === id && snapshot.intervalId === id
      && snapshot.phase === 'WARNING' && !snapshot.paused;
  }

  private showFallback(id: number, body: string): void {
    if (!this.isCurrent(id) || this.fallback) return;
    const area = screen.getPrimaryDisplay().workArea;
    const width = Math.min(350, area.width - 24), height = 120;
    const win = new BrowserWindow({
      title: 'MurzHelps — скоро перерыв', width, height,
      x: area.x + area.width - width - 12, y: area.y + 12,
      show: false, frame: false, resizable: false, movable: false,
      focusable: false, skipTaskbar: true, alwaysOnTop: true,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false },
    });
    this.fallback = win;
    win.setMenu(null);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.once('closed', () => {
      if (this.fallback === win) { this.fallback = undefined; clearTimeout(this.timeout); }
    });
    void win.loadFile(path.join(__dirname, '../renderer/warning.html'), { query: { message: body } }).then(() => {
      if (win.isDestroyed()) return;
      if (!this.isCurrent(id)) { win.destroy(); return; }
      win.showInactive();
      this.timeout = setTimeout(() => { if (!win.isDestroyed()) win.destroy(); }, 10_000);
    }).catch(error => {
      console.error('Warning window failed:', error);
      if (!win.isDestroyed()) win.destroy();
    });
  }

  private clear(): void {
    this.activeId = undefined;
    this.notification?.removeAllListeners();
    this.notification?.close();
    this.notification = undefined;
    clearTimeout(this.timeout);
    this.timeout = undefined;
    if (this.fallback && !this.fallback.isDestroyed()) this.fallback.destroy();
    this.fallback = undefined;
  }
}
