import { Menu, nativeImage, Tray } from 'electron';
import path from 'node:path';
import { formatRemaining, isVisit, type TimerSnapshot } from '../shared/timer-state';
import type { BreakTimer } from './timer';
import { murzCopy } from '../shared/murz-copy';

/** Keep one tray and one menu; only their labels/enabled states change. */
export function createTray(assetDirectory: string, timer: BreakTimer, settings: () => void, quit: () => void) {
  const icon = nativeImage.createFromPath(path.join(assetDirectory,
    process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png'));
  if (icon.isEmpty()) throw new Error(murzCopy.errors.missingTray);
  if (process.platform === 'darwin') icon.setTemplateImage(true);
  const tray = new Tray(icon);
  const menu = Menu.buildFromTemplate([
    { label: murzCopy.brand, enabled: false },
    { type: 'separator' },
    { id: 'status', label: murzCopy.states.IDLE, enabled: false },
    { id: 'remaining', label: '—', enabled: false },
    { type: 'separator' },
    { id: 'start', label: murzCopy.tray.start, click: () => timer.start() },
    { id: 'pause', label: murzCopy.tray.pause, click: () => {
      if (timer.snapshot().pauseReasons.includes('user')) timer.resume();
      else timer.pause();
    } },
    { id: 'restart', label: murzCopy.tray.restart, click: () => timer.restartWork() },
    { id: 'summon', label: murzCopy.tray.summon, click: () => timer.startBreakNow() },
    { id: 'stop', label: murzCopy.tray.stop, click: () => timer.stop() },
    { type: 'separator' },
    { label: murzCopy.tray.settings, click: settings },
    { type: 'separator' },
    { label: murzCopy.tray.quit, click: quit },
  ]);
  const update = (snapshot: TimerSnapshot) => {
    const status = `${murzCopy.states[snapshot.phase]}${snapshot.paused ? ` · ${murzCopy.paused}` : ''}`;
    const remaining = snapshot.phase === 'IDLE' ? '—' : formatRemaining(snapshot.remainingMs);
    menu.getMenuItemById('status')!.label = status;
    menu.getMenuItemById('remaining')!.label = `${isVisit(snapshot.phase) ? murzCopy.untilEnd : snapshot.phase === 'SNOOZED' ? murzCopy.untilReturn : murzCopy.untilArrival}: ${remaining}`;
    menu.getMenuItemById('start')!.enabled = snapshot.phase === 'IDLE';
    menu.getMenuItemById('pause')!.enabled = snapshot.phase !== 'IDLE';
    menu.getMenuItemById('pause')!.label = snapshot.pauseReasons.includes('user') ? murzCopy.tray.resume : murzCopy.tray.pause;
    menu.getMenuItemById('summon')!.enabled = !isVisit(snapshot.phase) && snapshot.phase !== 'SNOOZED';
    menu.getMenuItemById('stop')!.enabled = snapshot.phase !== 'IDLE';
    tray.setToolTip(`${murzCopy.brand} · ${status} · ${remaining}`);
    if (process.platform === 'linux') tray.setContextMenu(menu);
  };
  update(timer.snapshot());
  tray.setContextMenu(menu);
  const unsubscribe = timer.subscribe(update);
  if (process.platform === 'win32') tray.on('click', () => { timer.tick(); tray.popUpContextMenu(); });
  return { tray, dispose: () => { unsubscribe(); tray.destroy(); } };
}
