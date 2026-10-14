import { app } from 'electron';
import path from 'node:path';

export function nativePath(name: string): string {
  return path.join(app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'dist'),
    'native', name + (process.platform === 'win32' ? '.exe' : ''));
}
