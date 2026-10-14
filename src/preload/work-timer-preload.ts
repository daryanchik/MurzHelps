import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type WorkTimerBridge } from '../shared/types';
import type { TimerSnapshot } from '../shared/timer-state';
const bridge: WorkTimerBridge = {
  get: () => ipcRenderer.invoke(IPC.workTimerGet),
  onTimer: callback => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: TimerSnapshot) => callback(snapshot);
    ipcRenderer.on(IPC.workTimerUpdate, listener);
    return () => ipcRenderer.off(IPC.workTimerUpdate, listener);
  },
  resizeStart: edge => ipcRenderer.send(IPC.workTimerResizeStart, edge),
  resizeEnd: () => ipcRenderer.send(IPC.workTimerResizeEnd),
};
contextBridge.exposeInMainWorld('murzWorkTimer', bridge);
