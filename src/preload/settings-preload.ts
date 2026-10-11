import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type SettingsBridge } from '../shared/types';

const bridge: SettingsBridge = {
  get: () => ipcRenderer.invoke(IPC.getSettings),
  save: settings => ipcRenderer.invoke(IPC.saveSettings, settings),
  close: () => ipcRenderer.send(IPC.closeSettings),
};
contextBridge.exposeInMainWorld('murzSettings', bridge);
