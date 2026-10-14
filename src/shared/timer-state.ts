import { murzCopy } from './murz-copy';

export type TimerPhase = 'IDLE' | 'WORKING' | 'WARNING' | 'SHORT_VISIT' | 'LONG_VISIT' | 'SNOOZED';
export type VisitKind = 'short' | 'long';
export const SNOOZE_MS = 5 * 60_000;
export function isVisit(phase: TimerPhase): boolean { return phase === 'SHORT_VISIT' || phase === 'LONG_VISIT'; }
export type PauseReason = 'user' | 'sleep' | 'lock';

export interface TimerSettings {
  workMinutes: number;
  shortMinutes: number;
  longMinutes: number;
  longEvery: number;
  autoStart: boolean;
  warningMinutes: number;
  showWorkTimer?: boolean;
}

export const DEFAULT_SETTINGS: Readonly<TimerSettings> = Object.freeze({
  workMinutes: 30, shortMinutes: 5, longMinutes: 15, longEvery: 4, warningMinutes: 5, autoStart: true, showWorkTimer: false,
});

export interface TimerSnapshot {
  revision: number;
  phase: TimerPhase;
  intervalId: number;
  visitId: number | null;
  visitKind: VisitKind | null;
  snoozeUsed: boolean;
  workIndex: number;
  cycleLength: number;
  remainingMs: number;
  durationMs: number;
  paused: boolean;
  pauseReasons: PauseReason[];
  settings: TimerSettings;
  cycleId?: number;
}

export interface TimerEvent {
  type: 'reset' | 'cycle-started' | 'work-skipped' | 'dismiss' | 'snooze' | 'visit-finished' | 'cycles-skipped';
  snapshot: TimerSnapshot;
  natural?: boolean;
}

export type SettingsErrors = Partial<Record<keyof TimerSettings, string>>;
export type SettingsValidation = { ok: true; settings: TimerSettings }
  | { ok: false; errors: SettingsErrors; error?: string };
export type SettingsSaveResult = { ok: true; settings: TimerSettings }
  | { ok: false; errors?: SettingsErrors; error: string };
export interface SettingsSnapshot { settings: TimerSettings; loadWarning?: string }

export function validateSettings(input: unknown): SettingsValidation {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: {}, error: murzCopy.errors.settingsObject };
  }
  const record = input as Record<string, unknown>;
  const errors: SettingsErrors = {};
  const ranges = { workMinutes: [1, 240], shortMinutes: [1, 120], longMinutes: [1, 120], longEvery: [1, 24], warningMinutes: [0, 15] } as const;
  for (const key of Object.keys(ranges) as (keyof typeof ranges)[]) {
    const value = record[key];
    const [min, max] = ranges[key];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
      errors[key] = murzCopy.errors.numberRange(min, max);
    }
  }
  if (typeof record.autoStart !== 'boolean') errors.autoStart = murzCopy.errors.boolean;
  if (record.showWorkTimer !== undefined && typeof record.showWorkTimer !== 'boolean') errors.showWorkTimer = murzCopy.errors.boolean;
  if (!errors.workMinutes && !errors.warningMinutes && (record.warningMinutes as number) > (record.workMinutes as number)) {
    errors.warningMinutes = murzCopy.errors.warningRange;
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, settings: {
    workMinutes: record.workMinutes as number,
    shortMinutes: record.shortMinutes as number,
    longMinutes: record.longMinutes as number,
    longEvery: record.longEvery as number,
    autoStart: record.autoStart as boolean,
    warningMinutes: record.warningMinutes as number,
    showWorkTimer: record.showWorkTimer === true,
  } };
}

export function formatRemaining(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return hours ? `${two(hours)}:${two(minutes)}:${two(seconds % 60)}` : `${two(minutes)}:${two(seconds % 60)}`;
}

export function idleSnapshot(): TimerSnapshot {
  return { revision: 0, phase: 'IDLE', intervalId: 0, visitId: null, visitKind: null, snoozeUsed: false, workIndex: 0, cycleLength: DEFAULT_SETTINGS.longEvery, remainingMs: 0, durationMs: 0,
    paused: false, pauseReasons: [], settings: { ...DEFAULT_SETTINGS } };
}
