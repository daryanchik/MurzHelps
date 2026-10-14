import { app, powerMonitor, screen, type BrowserWindow } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { nativePath } from './native-path';

const overlays = new Map<BrowserWindow, { wanted: boolean; priority: number }>();
const blockers = new Set<string>();
const safetyListeners = new Set<() => void>();
let observer: ChildProcess | undefined;
let cleanup: (() => void)[] = [];
let spaceRefresh: ReturnType<typeof setTimeout> | undefined;

export function configureApplication(): void {
  if (process.platform === 'darwin') app.setActivationPolicy('accessory');
  else if (process.platform === 'win32') app.setAppUserModelId('com.squirrel.MurzHelps.MurzHelps');
  const block = (reason: string, active: boolean) => {
    if (active) blockers.add(reason); else blockers.delete(reason);
    if (active) for (const listener of safetyListeners) listener();
    for (const [window, state] of overlays) {
      if (window.isDestroyed()) continue;
      if (blockers.size) window.hide();
      else if (state.wanted && !window.isVisible()) { configureOverlay(window); window.showInactive(); }
    }
  };
  const suspend = () => block('sleep', true), resume = () => block('sleep', false);
  const lock = () => block('lock', true), unlock = () => block('lock', false);
  powerMonitor.on('suspend', suspend); powerMonitor.on('resume', resume);
  powerMonitor.on('lock-screen', lock); powerMonitor.on('unlock-screen', unlock);
  cleanup.push(() => {
    powerMonitor.off('suspend', suspend); powerMonitor.off('resume', resume);
    powerMonitor.off('lock-screen', lock); powerMonitor.off('unlock-screen', unlock);
  });
  if (powerMonitor.getSystemIdleState(1) === 'locked') block('lock', true);
  const refresh = () => refreshOverlayOrder();
  app.on('browser-window-focus', refresh);
  screen.on('display-metrics-changed', refresh);
  cleanup.push(() => { app.off('browser-window-focus', refresh); screen.off('display-metrics-changed', refresh); });
  if (process.platform === 'darwin') {
    observer = spawn(nativePath('murz-desktop-observer'), [String(process.pid)], { stdio: ['pipe', 'pipe', 'ignore'] });
    let buffer = '';
    observer.stdin?.on('error', () => {});
    observer.stdout?.on('error', () => {});
    observer.stdout?.setEncoding('utf8');
    observer.stdout?.on('data', (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split('\n'); buffer = lines.pop() ?? '';
      if (buffer.length > 1024) buffer = '';
      for (const line of lines) {
        if (line === 'BLOCK') block('secure-desktop', true);
        else if (line === 'UNBLOCK') block('secure-desktop', false);
        else if (line === 'REFRESH') {
          refreshOverlayOrder();
          // Space-change notifications can precede completion of the native transition.
          clearTimeout(spaceRefresh);
          spaceRefresh = setTimeout(refreshOverlayOrder, 350);
        }
      }
    });
    observer.on('error', error => console.warn('Desktop observer unavailable:', error.message));
    observer.on('exit', () => block('secure-desktop', false));
  }
}

export function configureOverlay(window: BrowserWindow, priority?: number): void {
  if (!overlays.has(window)) {
    overlays.set(window, { wanted: false, priority: priority ?? 4 });
    window.once('closed', () => overlays.delete(window));
  } else if (priority !== undefined) overlays.get(window)!.priority = priority;
  // Pair a nonactivating panel with FullScreenAuxiliary/CanJoinAllSpaces.
  // Chrome fullscreen can sit above floating windows. Do not use screen-saver
  // level; secure desktop/lock/sleep also explicitly hide every registered overlay.
  window.setAlwaysOnTop(true, process.platform === 'darwin' ? 'pop-up-menu' : 'floating');
  if (process.platform === 'darwin') window.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true, skipTransformProcessType: true,
  });
}

export function showOverlay(window: BrowserWindow): void {
  if (window.isDestroyed()) return;
  configureOverlay(window);
  overlays.get(window)!.wanted = true;
  if (!blockers.size) { window.showInactive(); refreshOverlayOrder(); }
}

export function hideOverlay(window: BrowserWindow): void {
  if (window.isDestroyed()) return;
  const state = overlays.get(window);
  if (state) state.wanted = false;
  window.hide();
}

export function desktopIsAvailable(): boolean { return blockers.size === 0; }
export function onDesktopUnsafe(listener: () => void): () => void {
  safetyListeners.add(listener);
  return () => { safetyListeners.delete(listener); };
}

export function refreshOverlayOrder(): void {
  if (blockers.size) return;
  for (const [window, state] of [...overlays].sort((a, b) => b[1].priority - a[1].priority)) {
    if (!state.wanted || window.isDestroyed() || !window.isVisible()) continue;
    configureOverlay(window);
    window.moveTop();
  }
}

export function disposePlatform(): void {
  clearTimeout(spaceRefresh); spaceRefresh = undefined;
  for (const dispose of cleanup) dispose();
  cleanup = [];
  observer?.stdin?.end();
  observer = undefined;
  safetyListeners.clear();
  overlays.clear();
}
