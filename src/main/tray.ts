import { Menu, nativeImage, Tray } from 'electron';
import path from 'node:path';

export function createTray(assetDirectory: string, summon: () => void, quit: () => void): Tray {
  const icon = nativeImage.createFromPath(path.join(assetDirectory,
    process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png'));
  if (icon.isEmpty()) throw new Error('MurzHelps tray icon is missing');
  if (process.platform === 'darwin') icon.setTemplateImage(true);
  const tray = new Tray(icon);
  tray.setToolTip('MurzHelps');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'MurzHelps', enabled: false },
    { type: 'separator' },
    { label: 'Summon Murz', click: summon },
    { type: 'separator' },
    { label: 'Quit MurzHelps', click: quit },
  ]));
  if (process.platform === 'win32') tray.on('click', () => tray.popUpContextMenu());
  return tray;
}
