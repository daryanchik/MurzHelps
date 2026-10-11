import { app, BrowserWindow, dialog, ipcMain, nativeImage, powerMonitor, screen } from 'electron';
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import { calculateLayout } from '../shared/layout';
import { extractAlpha, hitScreenPoint, makeInputMask, maskToRectangles } from '../shared/hit-test';
import type { AlphaRaster, InputMask } from '../shared/hit-test';
import { IPC, type LayoutSnapshot, type OverlayLayout } from '../shared/types';
import { VisibilityState } from '../shared/visibility';
import { configureOverlay } from './platform';
import { idleSnapshot, type TimerSnapshot } from '../shared/timer-state';

export class MurzWindow {
  readonly window: BrowserWindow;
  private readonly alpha: AlphaRaster;
  private readonly state = new VisibilityState();
  private layout!: OverlayLayout;
  private mask!: InputMask;
  private nativeShape = false;
  private ignoringMouse = true;
  private polling?: ReturnType<typeof setInterval>;
  private reflowTimer?: ReturnType<typeof setTimeout>;
  private readyTimer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private failed = false;
  private timerState = idleSnapshot();

  constructor(assetDirectory: string, private readonly onDismissRequest: (intervalId: number) => void) {
    this.state.dismiss(); // v0.2 always launches hidden in IDLE.
    const image = nativeImage.createFromPath(path.join(assetDirectory, 'murz.png'));
    if (image.isEmpty()) throw new Error('assets/murz.png is missing or invalid');
    const size = image.getSize();
    this.alpha = extractAlpha(image.toBitmap({ scaleFactor: 1 }), size.width, size.height);
    if (!this.alpha.alpha.some(value => value === 0) || !this.alpha.alpha.some(value => value > 200)) {
      throw new Error('murz.png must contain both transparent background and visible cat pixels');
    }

    this.window = new BrowserWindow({
      title: 'MurzHelps',
      width: 400, height: 400,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      alwaysOnTop: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false,
      // OS close/quit remains available. There is no close-event veto.
      closable: true,
      skipTaskbar: true,
      acceptFirstMouse: true,
      autoHideMenuBar: true,
      enableLargerThanScreen: false,
      webPreferences: {
        preload: path.join(__dirname, '../preload/preload.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        devTools: false,
        backgroundThrottling: false,
        zoomFactor: 1,
        spellcheck: false,
      },
    });
    this.window.setMenu(null);
    this.window.setIgnoreMouseEvents(true, { forward: true });
    configureOverlay(this.window);
    this.window.webContents.setZoomFactor(1);
    void this.window.webContents.setVisualZoomLevelLimits(1, 1);
    this.window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.window.webContents.on('will-navigate', event => event.preventDefault());
    this.window.webContents.on('will-attach-webview', event => event.preventDefault());
    this.window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    this.window.webContents.session.setPermissionCheckHandler(() => false);
    this.window.webContents.on('render-process-gone', (_event, details) => {
      if (!this.disposed) this.fail(`Renderer stopped (${details.reason}).`);
    });
    this.window.on('will-move', event => event.preventDefault());
    this.window.on('will-resize', event => event.preventDefault());
    this.window.on('hide', () => this.stopPolling());
    this.window.on('closed', () => { this.dispose(); app.quit(); });

    ipcMain.handle(IPC.getLayout, event => {
      if (!this.authorized(event)) throw new Error('Unexpected IPC sender');
      return this.snapshot();
    });
    ipcMain.handle(IPC.getTimer, event => {
      if (!this.authorized(event)) throw new Error('Unexpected IPC sender');
      return this.timerState;
    });
    ipcMain.on(IPC.ready, this.onReady);
    ipcMain.on(IPC.dismiss, this.onDismiss);
    ipcMain.on(IPC.pointer, this.onPointer);
    ipcMain.on(IPC.error, this.onRendererError);
    screen.on('display-added', this.scheduleReflow);
    screen.on('display-removed', this.scheduleReflow);
    screen.on('display-metrics-changed', this.scheduleReflow);
    powerMonitor.on('resume', this.scheduleReflow);
    powerMonitor.on('unlock-screen', this.scheduleReflow);
    this.reflow(false);
  }

  async load(): Promise<void> {
    await this.window.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  setTimerSnapshot(snapshot: TimerSnapshot): void {
    this.timerState = snapshot;
    if (!this.disposed && !this.window.isDestroyed()) this.window.webContents.send(IPC.timer, snapshot);
  }

  summon(): void {
    if (this.disposed || this.failed) return;
    this.state.summon();
    // Re-read the primary display even if its changes happened while hidden.
    this.reflow(true);
  }

  dismiss(): void {
    this.state.dismiss();
    clearTimeout(this.readyTimer);
    this.stopPolling();
    this.setIgnoring(true);
    this.window.hide();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopPolling();
    clearTimeout(this.reflowTimer);
    clearTimeout(this.readyTimer);
    ipcMain.removeHandler(IPC.getLayout);
    ipcMain.removeHandler(IPC.getTimer);
    ipcMain.off(IPC.ready, this.onReady);
    ipcMain.off(IPC.dismiss, this.onDismiss);
    ipcMain.off(IPC.pointer, this.onPointer);
    ipcMain.off(IPC.error, this.onRendererError);
    screen.off('display-added', this.scheduleReflow);
    screen.off('display-removed', this.scheduleReflow);
    screen.off('display-metrics-changed', this.scheduleReflow);
    powerMonitor.off('resume', this.scheduleReflow);
    powerMonitor.off('unlock-screen', this.scheduleReflow);
  }

  private authorized(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
    return !this.disposed && !this.window.isDestroyed()
      && event.sender === this.window.webContents
      && event.senderFrame === this.window.webContents.mainFrame;
  }

  private snapshot(): LayoutSnapshot {
    return { revision: this.state.revision, layout: this.layout };
  }

  private onReady = (event: IpcMainEvent, revision: unknown): void => {
    if (!this.authorized(event) || typeof revision !== 'number' || !this.state.acknowledge(revision)) return;
    clearTimeout(this.readyTimer);
    if (!this.state.shouldShow) return;
    configureOverlay(this.window);
    // Resolve the hit-test BEFORE showing; no invisible rectangle on first frame.
    if (this.nativeShape) this.setIgnoring(false);
    else this.samplePointer();
    this.window.showInactive();
    if (!this.nativeShape) this.polling = setInterval(() => this.samplePointer(), 8);
  };

  private onDismiss = (event: IpcMainEvent, intervalId: unknown): void => {
    if (this.authorized(event) && typeof intervalId === 'number' && Number.isSafeInteger(intervalId)
        && this.timerState.phase === 'BREAK' && this.timerState.intervalId === intervalId) {
      this.onDismissRequest(intervalId);
    }
  };

  private onPointer = (event: IpcMainEvent): void => {
    if (this.authorized(event) && !this.nativeShape && this.window.isVisible()) this.samplePointer();
  };

  private onRendererError = (event: IpcMainEvent): void => {
    if (this.authorized(event)) this.fail('Не удалось загрузить изображение Мурза.');
  };

  private scheduleReflow = (): void => {
    if (this.disposed) return;
    clearTimeout(this.reflowTimer);
    // The next summon recalculates everything when the cat is dismissed.
    if (!this.state.wanted) return;
    clearTimeout(this.readyTimer);
    this.stopPolling();
    this.window.hide();
    this.setIgnoring(true);
    this.state.invalidate();
    this.reflowTimer = setTimeout(() => {
      try { this.reflow(true); }
      catch (error) { this.fail(String(error)); }
    }, 100);
  };

  private reflow(notify: boolean): void {
    if (this.disposed) return;
    clearTimeout(this.reflowTimer);
    this.stopPolling();
    this.window.hide();
    this.setIgnoring(true);
    this.state.invalidate();
    this.layout = calculateLayout(screen.getPrimaryDisplay().workArea, this.alpha, true);
    this.mask = makeInputMask(this.alpha, this.layout);
    this.window.setBounds(this.layout.window, false);
    this.nativeShape = false;
    // macOS has no setShape API. Never call it there.
    if (process.platform === 'win32') {
      const rectangles = maskToRectangles(this.mask);
      if (rectangles.length === 0) throw new Error('Empty interaction region');
      try {
        this.window.setShape(rectangles);
        this.nativeShape = true;
      } catch (error) {
        // Restore the default shape if the native call partially succeeded.
        this.window.setShape([]);
        console.warn('Native input region unavailable; using pointer alpha hit testing.', error);
      }
    }
    clearTimeout(this.readyTimer);
    this.readyTimer = setTimeout(() => this.fail('Окно Мурза не завершило загрузку.'), 15000);
    if (notify) this.window.webContents.send(IPC.layout, this.snapshot());
  }

  private samplePointer(): void {
    if (this.disposed || this.window.isDestroyed()) return;
    this.setIgnoring(!hitScreenPoint(this.mask, this.window.getBounds(), screen.getCursorScreenPoint()));
  }

  private setIgnoring(ignore: boolean): void {
    if (this.window.isDestroyed() || this.ignoringMouse === ignore) return;
    this.window.setIgnoreMouseEvents(ignore, { forward: true });
    this.ignoringMouse = ignore;
  }

  private stopPolling(): void {
    clearInterval(this.polling);
    this.polling = undefined;
  }

  private fail(message: string): void {
    if (this.failed || this.disposed) return;
    this.failed = true;
    this.dismiss();
    console.error(message);
    dialog.showErrorBox('MurzHelps', message);
    app.quit();
  }
}
