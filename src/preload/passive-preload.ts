import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type PassiveCatBridge } from '../shared/types';
const bridge: PassiveCatBridge = {
  ready: (width, height) => ipcRenderer.send(IPC.passiveReady, width, height),
  failed: () => ipcRenderer.send(IPC.passiveFailed),
};
contextBridge.exposeInMainWorld('murzPassive', bridge);
