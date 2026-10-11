import { app, type BrowserWindow } from 'electron';

export function configureApplication(): void {
  if (process.platform === 'darwin') {
    app.setActivationPolicy('accessory');
  } else if (process.platform === 'win32') {
    app.setAppUserModelId('com.squirrel.MurzHelps.MurzHelps');
  }
}

export function configureOverlay(window: BrowserWindow): void {
  // Floating is above ordinary apps, below the system menu, Dock and taskbar.
  window.setAlwaysOnTop(true, 'floating');
  if (process.platform === 'darwin') {
    window.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
  }
}
