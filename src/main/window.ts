import { app, BrowserWindow, dialog, ipcMain, nativeImage, powerMonitor, screen } from 'electron';
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { discoverMurzAssets } from './assets';
import { cursorDisplay, retainedDisplay } from './displays';
import { murzAssets, murzAsset, type MurzAssetId, type MurzPresentation, type ShortMurzAssetId } from '../shared/murz-assets';
import { murzCopy } from '../shared/murz-copy';
import { VisitPresentation } from './visit-presentation';
import { calculateLayout } from '../shared/layout';
import { extractAlpha, hitScreenPoint, makeInputMask, maskToRectangles } from '../shared/hit-test';
import type { AlphaRaster, InputMask } from '../shared/hit-test';
import { IPC, type LayoutSnapshot, type OverlayLayout } from '../shared/types';
import { VisibilityState } from '../shared/visibility';
import { configureOverlay, showOverlay, hideOverlay } from './platform';
import { idleSnapshot, isVisit, type TimerSnapshot } from '../shared/timer-state';
import { diagnosticPath, logOverlay } from './overlay-diagnostics';

const READY_TIMEOUT_MS = 15_000;
const MAX_SHAPE_RECTANGLES = 4096;

export class MurzWindow {
  readonly window: BrowserWindow;
  private alpha: AlphaRaster;
  private readonly presentations: VisitPresentation;
  private presentation: MurzPresentation = { asset: 'mb', message: murzCopy.long };
  private readonly state = new VisibilityState();
  private layout!: OverlayLayout;
  private mask!: InputMask;
  private nativeShape = false;
  private inputReady = false;
  private shapeApplied = false;
  private shapeUnavailable = false;
  private ignoringMouse = true;
  private polling?: ReturnType<typeof setInterval>;
  private reflowTimer?: ReturnType<typeof setTimeout>;
  private readyTimer?: ReturnType<typeof setTimeout>;
  private loadTimer?: ReturnType<typeof setTimeout>;
  private loadState: 'not-started' | 'loading' | 'loaded' = 'not-started';
  private rendererStage = 'awaiting-layout';
  private readonly reportedStages = new Set<string>();
  private disposed = false;
  private failed = false;
  private timerState = idleSnapshot();
  private displayId?: number;
  private targetVisit?: number;

  constructor(private readonly assetDirectory: string,
    private readonly onDismissRequest: (intervalId: number) => void,
    private readonly onSnoozeRequest: (intervalId: number) => void = () => {},
    available: readonly ShortMurzAssetId[] = discoverMurzAssets(assetDirectory).short) {
    this.state.dismiss();
    this.presentations = new VisitPresentation(available);
    this.alpha = this.loadAlpha('mb');

    this.window = new BrowserWindow({
      title: murzCopy.brand,
      ...(process.platform === 'darwin' ? { type: 'panel' as const } : {}),
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
    void this.window.webContents.setVisualZoomLevelLimits(1, 1)
      .catch(() => this.fail(murzCopy.errors.renderer, 'zoom-configuration'));
    this.window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.window.webContents.on('will-navigate', event => event.preventDefault());
    this.window.webContents.on('will-attach-webview', event => event.preventDefault());
    this.window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    this.window.webContents.session.setPermissionCheckHandler(() => false);
    this.window.webContents.on('did-finish-load', () => {
      this.window.webContents.setZoomFactor(1);
      this.trace('html-loaded');
    });
    this.window.webContents.on('did-fail-load', (_event, code, _description, _url, mainFrame) => {
      if (mainFrame) { this.trace('html-load-failed', { code }); this.fail(murzCopy.errors.loading, 'html-load'); }
    });
    this.window.webContents.on('preload-error', () => this.fail(murzCopy.errors.loading, 'preload'));
    this.window.webContents.on('console-message', details => {
      // Do not log Chromium messages, source URLs or stacks: they can contain local paths.
      if (details.level === 'error' && !this.reportedStages.has('console-error')) {
        this.reportedStages.add('console-error'); this.trace('renderer-console-error');
      }
    });
    this.window.webContents.on('render-process-gone', (_event, details) => {
      if (!this.disposed) { this.trace('renderer-gone', { reason: details.reason }); this.fail(murzCopy.errors.renderer, 'renderer-gone'); }
    });
    this.window.on('unresponsive', () => this.fail(murzCopy.errors.renderer, 'renderer-unresponsive'));
    this.window.on('will-move', event => event.preventDefault());
    this.window.on('will-resize', event => event.preventDefault());
    this.window.on('hide', () => this.stopPolling());
    this.window.on('show', () => this.activateInput());
    this.window.on('closed', () => { this.dispose(); app.quit(); });

    ipcMain.handle(IPC.getLayout, event => {
      if (!this.authorized(event)) throw new Error('Unexpected IPC sender');
      if (!this.reportedStages.has('get-layout')) {
        this.reportedStages.add('get-layout'); this.trace('layout-requested');
      }
      return this.snapshot();
    });
    ipcMain.handle(IPC.getTimer, event => {
      if (!this.authorized(event)) throw new Error('Unexpected IPC sender');
      return this.timerState;
    });
    ipcMain.on(IPC.ready, this.onReady);
    ipcMain.on(IPC.dismiss, this.onDismiss);
    ipcMain.on(IPC.snooze, this.onSnooze);
    ipcMain.on(IPC.pointer, this.onPointer);
    ipcMain.on(IPC.error, this.onRendererError);
    ipcMain.on(IPC.diagnostic, this.onDiagnostic);
    screen.on('display-added', this.scheduleReflow);
    screen.on('display-removed', this.scheduleReflow);
    screen.on('display-metrics-changed', this.scheduleReflow);
    powerMonitor.on('resume', this.scheduleReflow);
    powerMonitor.on('unlock-screen', this.scheduleReflow);
    this.reflow(false);
    this.trace('created', { platform: process.platform, packaged: app.isPackaged });
  }

  async load(): Promise<void> {
    if (this.disposed || this.failed || this.loadState !== 'not-started') return;
    this.loadState = 'loading';
    this.trace('html-load-start');
    this.loadTimer = setTimeout(() => {
      if (this.loadState === 'loading' && !this.disposed && !this.failed) this.fail(murzCopy.errors.loading, 'html-timeout');
    }, READY_TIMEOUT_MS);
    try {
      await this.window.loadFile(path.join(__dirname, '../renderer/index.html'));
      this.loadState = 'loaded';
    } catch {
      this.fail(murzCopy.errors.loading, 'html-load');
    } finally {
      clearTimeout(this.loadTimer); this.loadTimer = undefined;
    }
  }

  setTimerSnapshot(snapshot: TimerSnapshot): void {
    try {
      if (snapshot.visitId !== null && snapshot.visitId !== this.timerState.visitId) {
        const next = this.presentations.forVisit(snapshot);
        if (next.asset !== this.presentation.asset) {
          this.presentation = next;
          this.alpha = this.loadAlpha(next.asset);
        } else this.presentation.message = next.message;
      }
    } catch (error) {
      console.error(error); this.fail(murzCopy.errors.missingCat); return;
    }
    this.timerState = snapshot;
    if (!this.disposed && !this.window.isDestroyed()) this.window.webContents.send(IPC.timer, snapshot);
  }

  summon(): void {
    if (this.disposed || this.failed) return;
    this.state.summon();
    // Select once per appearance; reflow and wake keep the existing target.
    const visit = this.timerState.visitId ?? this.timerState.intervalId;
    if (this.targetVisit !== visit) {
      this.displayId = cursorDisplay().id;
      this.targetVisit = visit;
    }
    this.reflow(true);
  }

  dismiss(): void {
    this.state.dismiss();
    this.inputReady = false;
    clearTimeout(this.reflowTimer); this.reflowTimer = undefined;
    this.cancelReadyTimer();
    this.stopPolling();
    this.setIgnoring(true);
    hideOverlay(this.window);
    this.trace('hidden');
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.inputReady = false;
    this.stopPolling();
    clearTimeout(this.reflowTimer);
    this.cancelReadyTimer();
    clearTimeout(this.loadTimer);
    ipcMain.removeHandler(IPC.getLayout);
    ipcMain.removeHandler(IPC.getTimer);
    ipcMain.off(IPC.ready, this.onReady);
    ipcMain.off(IPC.dismiss, this.onDismiss);
    ipcMain.off(IPC.snooze, this.onSnooze);
    ipcMain.off(IPC.pointer, this.onPointer);
    ipcMain.off(IPC.error, this.onRendererError);
    ipcMain.off(IPC.diagnostic, this.onDiagnostic);
    screen.off('display-added', this.scheduleReflow);
    screen.off('display-removed', this.scheduleReflow);
    screen.off('display-metrics-changed', this.scheduleReflow);
    powerMonitor.off('resume', this.scheduleReflow);
    powerMonitor.off('unlock-screen', this.scheduleReflow);
  }

  private authorized(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
    return !this.disposed && !this.failed && !this.window.isDestroyed()
      && event.sender === this.window.webContents
      && event.senderFrame === this.window.webContents.mainFrame;
  }

  private snapshot(): LayoutSnapshot {
    return { revision: this.state.revision, layout: this.layout, presentation: { ...this.presentation }, intervalId: this.timerState.intervalId };
  }

  private onReady = (event: IpcMainEvent, revision: unknown): void => {
    if (!this.authorized(event) || typeof revision !== 'number' || !this.state.acknowledge(revision)) return;
    this.cancelReadyTimer();
    this.trace('ready-received');
    if (!this.state.shouldShow) return;
    configureOverlay(this.window);
    if (process.platform === 'win32') {
      // The PNG has loaded and layout is committed. Show without taking input,
      // then install the region; fallback polling also starts only after this gate.
      showOverlay(this.window);
      this.applyNativeShape();
      if (this.failed) return;
      this.inputReady = true;
      this.activateInput();
    } else {
      // Preserve macOS's existing pre-show alpha hit test and nonactivating panel.
      this.inputReady = true;
      this.samplePointer();
      showOverlay(this.window);
    }
    this.trace('shown');
  };

  private onDismiss = (event: IpcMainEvent, intervalId: unknown): void => {
    if (this.authorized(event) && typeof intervalId === 'number' && Number.isSafeInteger(intervalId)
        && isVisit(this.timerState.phase) && this.timerState.intervalId === intervalId) {
      this.onDismissRequest(intervalId);
    }
  };

  private onSnooze = (event: IpcMainEvent, intervalId: unknown): void => {
    if (this.authorized(event) && typeof intervalId === 'number' && Number.isSafeInteger(intervalId)
        && isVisit(this.timerState.phase) && !this.timerState.snoozeUsed && this.timerState.intervalId === intervalId) {
      this.onSnoozeRequest(intervalId);
    }
  };

  private loadAlpha(id: MurzAssetId): AlphaRaster {
    let image = nativeImage.createFromPath(path.join(this.assetDirectory, murzAsset(id).file));
    if (image.isEmpty() && id !== 'mb') {
      this.presentation.asset = 'mb';
      image = nativeImage.createFromPath(path.join(this.assetDirectory, murzAssets.mb.file));
    }
    if (image.isEmpty()) throw new Error(murzCopy.errors.missingCat);
    const size = image.getSize();
    const alpha = extractAlpha(image.toBitmap({ scaleFactor: 1 }), size.width, size.height);
    if (!alpha.alpha.some(value => value === 0) || !alpha.alpha.some(value => value > 200)) {
      throw new Error(murzCopy.errors.invalidCat);
    }
    return alpha;
  }

  private onPointer = (event: IpcMainEvent): void => {
    if (this.authorized(event) && this.inputReady && !this.nativeShape && this.window.isVisible()) this.samplePointer();
  };

  private onRendererError = (event: IpcMainEvent, reason: unknown, revision: unknown): void => {
    if (!this.authorized(event) || typeof reason !== 'string'
      || !['image-load', 'image-timeout', 'image-decode', 'layout', 'get-layout', 'get-timer', 'script'].includes(reason)) return;
    if (revision !== this.state.revision && !(revision === -1 && this.state.readyRevision === -1)) return;
    this.fail(reason.startsWith('image-') ? murzCopy.errors.missingCat : murzCopy.errors.renderer, reason);
  };

  private onDiagnostic = (event: IpcMainEvent, revision: unknown, stage: unknown): void => {
    if (!this.authorized(event) || revision !== this.state.revision || typeof stage !== 'string'
      || !['image-loading', 'image-loaded', 'decoding', 'layout-applied', 'ready-sent'].includes(stage) || this.reportedStages.has(stage)) return;
    this.reportedStages.add(stage); this.rendererStage = stage;
    this.trace('renderer-progress');
  };

  private scheduleReflow = (): void => {
    if (this.disposed || this.failed) return;
    clearTimeout(this.reflowTimer);
    // The next summon recalculates everything when the cat is dismissed.
    if (!this.state.wanted) return;
    this.cancelReadyTimer();
    this.inputReady = false;
    this.stopPolling();
    hideOverlay(this.window);
    this.setIgnoring(true);
    this.state.invalidate();
    const revision = this.state.revision;
    this.reflowTimer = setTimeout(() => {
      if (this.disposed || this.failed || !this.state.wanted || revision !== this.state.revision) return;
      this.reflowTimer = undefined;
      try { this.reflow(true); }
      catch (error) { console.error(error); this.fail(murzCopy.errors.renderer); }
    }, 100);
  };

  private reflow(notify: boolean): void {
    if (this.disposed || this.failed || (notify && !this.state.wanted)) return;
    clearTimeout(this.reflowTimer);
    this.inputReady = false;
    this.stopPolling();
    hideOverlay(this.window);
    this.setIgnoring(true);
    this.state.invalidate();
    this.rendererStage = 'awaiting-layout'; this.reportedStages.clear();
    this.cancelReadyTimer();
    const display = retainedDisplay(this.displayId);
    this.displayId = display.id;
    this.layout = { ...calculateLayout(display.workArea, this.alpha, true),
      outline: murzAsset(this.presentation.asset).outline ? 1 : 0 };
    const started = performance.now();
    this.mask = makeInputMask(this.alpha, this.layout);
    this.trace('mask-created', { elapsedMs: Math.round(performance.now() - started),
      width: this.mask.width, height: this.mask.height, scaleFactor: display.scaleFactor });
    this.window.setBounds(this.layout.window, false);
    this.nativeShape = false;
    this.watchReady();
    if (notify) { this.trace('layout-sent'); this.window.webContents.send(IPC.layout, this.snapshot()); }
  }

  private applyNativeShape(): void {
    // SetShape can clip painting as well as input. Apply only after renderer readiness.
    // macOS keeps the existing alpha polling path and never calls this API.
    if (process.platform !== 'win32') return;
    let rectangles: ReturnType<typeof maskToRectangles> | undefined;
    const started = performance.now();
    if (!this.shapeUnavailable && typeof this.window.setShape === 'function') {
      try { rectangles = maskToRectangles(this.mask, MAX_SHAPE_RECTANGLES); }
      catch { this.trace('shape-fallback', { reason: 'rectangle-limit' }); }
    } else this.trace('shape-fallback', { reason: 'api-unavailable' });
    if (rectangles?.length) {
      this.trace('shape-created', { count: rectangles.length, elapsedMs: Math.round(performance.now() - started) });
      try {
        this.window.setShape(rectangles);
        this.shapeApplied = this.nativeShape = true;
        this.trace('shape-applied', { count: rectangles.length, elapsedMs: Math.round(performance.now() - started) });
        return;
      } catch {
        this.shapeUnavailable = true;
        // A throwing native call may have applied part of the region.
        this.shapeApplied = true;
        this.trace('shape-fallback', { reason: 'native-error' });
      }
    }
    if (this.shapeApplied) {
      try { this.window.setShape([]); this.shapeApplied = false; }
      catch { this.fail(murzCopy.errors.renderer, 'shape-reset'); }
    }
  }

  private cancelReadyTimer(): void { clearTimeout(this.readyTimer); this.readyTimer = undefined; }

  private watchReady(): void {
    if (!this.state.wanted || this.state.readyRevision === this.state.revision) return;
    const revision = this.state.revision;
    const handle = setTimeout(() => {
      if (this.readyTimer !== handle || this.disposed || this.failed || !this.state.wanted
        || revision !== this.state.revision || this.state.readyRevision === revision) return;
      this.fail(murzCopy.errors.loading, 'renderer-timeout');
    }, READY_TIMEOUT_MS);
    this.readyTimer = handle;
    this.trace('ready-watchdog-started');
  }

  private trace(event: string, fields: Record<string, string | number | boolean | null> = {}): void {
    logOverlay(event, { revision: this.state.revision, readyRevision: this.state.readyRevision,
      wanted: this.state.wanted, visible: !this.window.isDestroyed() && this.window.isVisible(),
      phase: this.loadState, stage: this.rendererStage, asset: this.presentation.asset, ...fields });
  }

  private samplePointer(): void {
    if (this.disposed || this.window.isDestroyed()) return;
    this.setIgnoring(!hitScreenPoint(this.mask, this.window.getBounds(), screen.getCursorScreenPoint()));
  }

  private activateInput(): void {
    if (!this.inputReady || this.disposed || !this.window.isVisible()) return;
    if (this.nativeShape) { this.setIgnoring(false); return; }
    this.stopPolling();
    this.samplePointer();
    this.polling = setInterval(() => this.samplePointer(), 8);
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

  private fail(message: string, reason = 'overlay'): void {
    if (this.failed || this.disposed) return;
    this.trace('failed', { reason });
    this.failed = true;
    clearTimeout(this.loadTimer);
    this.dismiss();
    const file = diagnosticPath();
    dialog.showErrorBox(murzCopy.brand, `${message}\nКод: ${reason}.${file ? `\nДиагностика: ${file}` : ''}`);
    app.quit();
  }
}
