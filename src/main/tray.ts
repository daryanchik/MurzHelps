import { Menu, nativeImage, Tray } from 'electron';
import path from 'node:path';
import { formatRemaining, type TimerSnapshot } from '../shared/timer-state';
import type { BreakTimer } from './timer';

/** Keep one tray and one menu; only their labels/enabled states change. */
export function createTray(assetDirectory: string, timer: BreakTimer, settings: () => void, quit: () => void) {
  const icon = nativeImage.createFromPath(path.join(assetDirectory,
    process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png'));
  if (icon.isEmpty()) throw new Error('MurzHelps tray icon is missing');
  if (process.platform === 'darwin') icon.setTemplateImage(true);
  const tray = new Tray(icon);
  const menu = Menu.buildFromTemplate([
    { label: 'MurzHelps', enabled: false },
    { type: 'separator' },
    { id: 'status', label: 'Status: Idle', enabled: false },
    { id: 'remaining', label: 'Remaining: —', enabled: false },
    { type: 'separator' },
    { id: 'start', label: 'Start Timer', click: () => timer.start() },
    { id: 'pause', label: 'Pause', click: () => {
      if (timer.snapshot().pauseReasons.includes('user')) timer.resume();
      else timer.pause();
    } },
    { label: 'Restart Work Timer', click: () => timer.restartWork() },
    { label: 'Start Break Now', click: () => timer.startBreakNow() },
    { id: 'stop', label: 'Stop Timer', click: () => timer.stop() },
    { type: 'separator' },
    { label: 'Settings', click: settings },
    { type: 'separator' },
    { label: 'Quit MurzHelps', click: quit },
  ]);
  const update = (snapshot: TimerSnapshot) => {
    const names = { IDLE: 'Idle', WORKING: 'Working', WARNING: 'Warning', BREAK: 'Break' };
    const status = `${names[snapshot.phase]}${snapshot.paused ? ' (Paused)' : ''}`;
    const remaining = snapshot.phase === 'IDLE' ? '—' : formatRemaining(snapshot.remainingMs);
    menu.getMenuItemById('status')!.label = `Status: ${status}`;
    menu.getMenuItemById('remaining')!.label = `Remaining: ${remaining}`;
    menu.getMenuItemById('start')!.enabled = snapshot.phase === 'IDLE';
    menu.getMenuItemById('pause')!.enabled = snapshot.phase !== 'IDLE';
    menu.getMenuItemById('pause')!.label = snapshot.pauseReasons.includes('user') ? 'Resume' : 'Pause';
    menu.getMenuItemById('stop')!.enabled = snapshot.phase !== 'IDLE';
    tray.setToolTip(`MurzHelps · ${status} · ${remaining}`);
    if (process.platform === 'linux') tray.setContextMenu(menu);
  };
  update(timer.snapshot());
  tray.setContextMenu(menu);
  const unsubscribe = timer.subscribe(update);
  if (process.platform === 'win32') tray.on('click', () => { timer.tick(); tray.popUpContextMenu(); });
  return { tray, dispose: () => { unsubscribe(); tray.destroy(); } };
}
