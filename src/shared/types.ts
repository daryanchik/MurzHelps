import type { SettingsSaveResult, SettingsSnapshot, TimerSettings, TimerSnapshot } from './timer-state';
import type { MurzPresentation } from './murz-assets';

export interface Size { width: number; height: number }
export interface Point { x: number; y: number }
export interface Rect extends Point, Size {}
export interface WorkTimerGeometry extends Rect { displayId?: number }
export interface WorkTimerBridge {
  get(): Promise<TimerSnapshot>;
  onTimer(callback: (snapshot: TimerSnapshot) => void): () => void;
  resizeStart(edge: string): void;
  resizeEnd(): void;
}
export interface PassiveCatBridge {
  readonly imageReadiness: ImageReadiness;
  ready(width: number, height: number): void;
  failed(reason: ImageFailure | 'layout'): void;
  diagnostic(stage: RendererStage): void;
}

/** All geometry is in Electron device-independent pixels (DIP), not physical pixels. */
export interface OverlayLayout {
  window: Rect;
  cat: Rect;
  button: Rect;
  buttonRadius: number;
  info?: Rect;
  snooze?: Rect;
  infoRadius?: number;
  outline?: number;
}

export interface LayoutSnapshot {
  revision: number;
  layout: OverlayLayout;
  presentation: MurzPresentation;
  intervalId: number;
}

export type ImageReadiness = 'load' | 'decode';
export type ImageFailure = 'image-load' | 'image-decode' | 'image-timeout';
export type RendererStage = 'image-loading' | 'image-loaded' | 'decoding' | 'layout-applied' | 'ready-sent';
export type RendererFailure = ImageFailure | 'layout' | 'get-layout' | 'get-timer' | 'script';

export interface MurzBridge {
  readonly imageReadiness: ImageReadiness;
  getLayout(): Promise<LayoutSnapshot>;
  onLayout(callback: (snapshot: LayoutSnapshot) => void): () => void;
  ready(revision: number): void;
  getTimer(): Promise<TimerSnapshot>;
  onTimer(callback: (snapshot: TimerSnapshot) => void): () => void;
  dismiss(intervalId: number): void;
  snooze(intervalId: number): void;
  pointerMoved(): void;
  diagnostic(revision: number, stage: RendererStage): void;
  reportError(reason: RendererFailure, revision: number): void;
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
  snooze: 'murz:snooze',
  pointer: 'murz:pointer',
  error: 'murz:renderer-error',
  diagnostic: 'murz:renderer-diagnostic',
  getTimer: 'murz:get-timer',
  timer: 'murz:timer',
  getSettings: 'murz:get-settings',
  saveSettings: 'murz:save-settings',
  closeSettings: 'murz:close-settings',
  passiveReady: 'murz:passive-ready',
  passiveFailed: 'murz:passive-failed',
  passiveDiagnostic: 'murz:passive-diagnostic',
  workTimerGet: 'murz:work-timer-get',
  workTimerUpdate: 'murz:work-timer-update',
  workTimerResizeStart: 'murz:work-timer-resize-start',
  workTimerResizeEnd: 'murz:work-timer-resize-end',
} as const;

