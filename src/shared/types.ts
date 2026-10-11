import type { SettingsSaveResult, SettingsSnapshot, TimerSettings, TimerSnapshot } from './timer-state';

export interface Size { width: number; height: number }
export interface Point { x: number; y: number }
export interface Rect extends Point, Size {}

/** All geometry is in Electron device-independent pixels (DIP), not physical pixels. */
export interface OverlayLayout {
  window: Rect;
  cat: Rect;
  button: Rect;
  buttonRadius: number;
  info?: Rect;
}

export interface LayoutSnapshot {
  revision: number;
  layout: OverlayLayout;
}

export interface MurzBridge {
  getLayout(): Promise<LayoutSnapshot>;
  onLayout(callback: (snapshot: LayoutSnapshot) => void): () => void;
  ready(revision: number): void;
  getTimer(): Promise<TimerSnapshot>;
  onTimer(callback: (snapshot: TimerSnapshot) => void): () => void;
  dismiss(intervalId: number): void;
  pointerMoved(): void;
  reportError(): void;
}

export interface SettingsBridge {
  get(): Promise<SettingsSnapshot>;
  save(settings: TimerSettings): Promise<SettingsSaveResult>;
  close(): void;
}

export const IPC = {
  getLayout: 'murz:get-layout',
  layout: 'murz:layout',
  ready: 'murz:ready',
  dismiss: 'murz:dismiss',
  pointer: 'murz:pointer',
  error: 'murz:renderer-error',
  getTimer: 'murz:get-timer',
  timer: 'murz:timer',
  getSettings: 'murz:get-settings',
  saveSettings: 'murz:save-settings',
  closeSettings: 'murz:close-settings',
} as const;

