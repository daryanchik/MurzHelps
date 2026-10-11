export type TimerPhase = 'IDLE' | 'WORKING' | 'WARNING' | 'BREAK';
export type PauseReason = 'user' | 'sleep' | 'lock';

export interface TimerSettings {
  workMinutes: number;
  breakMinutes: number;
  warningMinutes: number;
}

export const DEFAULT_SETTINGS: Readonly<TimerSettings> = Object.freeze({
  workMinutes: 60, breakMinutes: 45, warningMinutes: 5,
});

export interface TimerSnapshot {
  revision: number;
  phase: TimerPhase;
  intervalId: number;
  remainingMs: number;
  durationMs: number;
  paused: boolean;
  pauseReasons: PauseReason[];
  settings: TimerSettings;
}

export type SettingsErrors = Partial<Record<keyof TimerSettings, string>>;
export type SettingsValidation = { ok: true; settings: TimerSettings }
  | { ok: false; errors: SettingsErrors; error?: string };
export type SettingsSaveResult = { ok: true; settings: TimerSettings }
  | { ok: false; errors?: SettingsErrors; error: string };
export interface SettingsSnapshot { settings: TimerSettings; loadWarning?: string }

export function validateSettings(input: unknown): SettingsValidation {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: {}, error: 'Ожидались три числовых параметра.' };
  }
  const record = input as Record<string, unknown>;
  const errors: SettingsErrors = {};
  const ranges = { workMinutes: [1, 240], breakMinutes: [1, 120], warningMinutes: [0, 15] } as const;
  for (const key of Object.keys(ranges) as (keyof TimerSettings)[]) {
    const value = record[key];
    const [min, max] = ranges[key];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
      errors[key] = `Введите целое число от ${min} до ${max}.`;
    }
  }
  if (!errors.workMinutes && !errors.warningMinutes && (record.warningMinutes as number) > (record.workMinutes as number)) {
    errors.warningMinutes = 'Предупреждение не может быть длиннее рабочего интервала.';
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, settings: {
    workMinutes: record.workMinutes as number,
    breakMinutes: record.breakMinutes as number,
    warningMinutes: record.warningMinutes as number,
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
  return { revision: 0, phase: 'IDLE', intervalId: 0, remainingMs: 0, durationMs: 0,
    paused: false, pauseReasons: [], settings: { ...DEFAULT_SETTINGS } };
}
