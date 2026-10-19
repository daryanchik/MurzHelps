import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type PassiveCatBridge } from '../shared/types';
const bridge: PassiveCatBridge = {
  imageReadiness: process.platform === 'win32' ? 'load' : 'decode',
  ready: (width, height) => ipcRenderer.send(IPC.passiveReady, width, height),
  failed: reason => ipcRenderer.send(IPC.passiveFailed, reason),
  diagnostic: stage => ipcRenderer.send(IPC.passiveDiagnostic, stage),
};
contextBridge.exposeInMainWorld('murzPassive', bridge);
