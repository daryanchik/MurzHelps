import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type LayoutSnapshot, type MurzBridge } from '../shared/types';
import type { TimerSnapshot } from '../shared/timer-state';

// The renderer receives no Node, filesystem, general-purpose IPC, or Electron API.
const bridge: MurzBridge = {
  imageReadiness: process.platform === 'win32' ? 'load' : 'decode',
  getLayout: () => ipcRenderer.invoke(IPC.getLayout),
  onLayout: callback => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: LayoutSnapshot) => callback(snapshot);
    ipcRenderer.on(IPC.layout, listener);
    return () => ipcRenderer.removeListener(IPC.layout, listener);
  },
  ready: revision => ipcRenderer.send(IPC.ready, revision),
  getTimer: () => ipcRenderer.invoke(IPC.getTimer),
  onTimer: callback => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: TimerSnapshot) => callback(snapshot);
    ipcRenderer.on(IPC.timer, listener);
    return () => ipcRenderer.removeListener(IPC.timer, listener);
  },
  dismiss: intervalId => ipcRenderer.send(IPC.dismiss, intervalId),
  snooze: intervalId => ipcRenderer.send(IPC.snooze, intervalId),
  pointerMoved: () => ipcRenderer.send(IPC.pointer),
  diagnostic: (revision, stage) => ipcRenderer.send(IPC.diagnostic, revision, stage),
  reportError: (reason, revision) => ipcRenderer.send(IPC.error, reason, revision),
};
contextBridge.exposeInMainWorld('murz', bridge);
