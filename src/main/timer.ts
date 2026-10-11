import { performance } from 'node:perf_hooks';
import { DEFAULT_SETTINGS, validateSettings } from '../shared/timer-state';
import type { PauseReason, TimerPhase, TimerSettings, TimerSnapshot } from '../shared/timer-state';

const MINUTE = 60_000;
type Listener = (snapshot: TimerSnapshot) => void;

/** Pure state machine. No Electron, image, renderer, animation, or scheduling code. */
export class BreakTimer {
  private phase: TimerPhase = 'IDLE';
  private intervalId = 0;
  private revision = 0;
  private deadline: number | null = null;
  private frozenRemaining = 0;
  private duration = 0;
  private activeWarning = 0;
  private warningSent = false;
  private readonly pauses = new Set<PauseReason>();
  private readonly listeners = new Set<Listener>();
  private readonly warnings = new Set<Listener>();
  private settings: TimerSettings;
  private lastNow = -Infinity;
  private lastPublished = '';

  constructor(settings: TimerSettings = { ...DEFAULT_SETTINGS }, private readonly clock = () => performance.now()) {
    const checked = validateSettings(settings);
    if (!checked.ok) throw new Error('Invalid timer settings');
    this.settings = checked.settings;
  }

  subscribe(listener: Listener): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  onWarning(listener: Listener): () => void { this.warnings.add(listener); return () => { this.warnings.delete(listener); }; }

  snapshot(): TimerSnapshot { return this.makeSnapshot(this.now()); }

  tick(): void {
    const now = this.now();
    this.advance(now);
    this.publish(now);
  }

  start(): void {
    if (this.phase !== 'IDLE') return;
    this.restartWork();
  }

  restartWork(): void {
    const now = this.now();
    this.pauses.delete('user');
    this.begin('WORKING', now);
    this.advance(now);
    this.publish(now);
  }

  startBreakNow(): void {
    const now = this.now();
    this.pauses.delete('user');
    this.begin('BREAK', now);
    this.publish(now);
  }

  /** The id makes double-clicks and late messages from an older break harmless. */
  dismissBreak(expectedIntervalId: number): boolean {
    const now = this.now();
    this.advance(now);
    if (!Number.isSafeInteger(expectedIntervalId) || this.phase !== 'BREAK' || expectedIntervalId !== this.intervalId) {
      this.publish(now);
      return false;
    }
    this.pauses.delete('user');
    this.begin('WORKING', now);
    this.advance(now);
    this.publish(now);
    return true;
  }

  stop(): void {
    const now = this.now();
    this.phase = 'IDLE';
    this.deadline = null;
    this.frozenRemaining = this.duration = this.activeWarning = 0;
    this.warningSent = false;
    this.pauses.delete('user');
    this.publish(now);
  }

  pause(): void { if (this.phase !== 'IDLE') this.setPaused('user', true); }
  resume(): void { this.setPaused('user', false); }
  setSystemPaused(reason: 'sleep' | 'lock', paused: boolean): void { this.setPaused(reason, paused); }

  configure(settings: TimerSettings): void {
    const checked = validateSettings(settings);
    if (!checked.ok) throw new Error('Invalid timer settings');
    const now = this.now();
    // Bring elapsed intervals up to date BEFORE installing future settings.
    this.advance(now);
    this.settings = checked.settings;
    this.publish(now);
  }

  private now(): number {
    const value = this.clock();
    if (!Number.isFinite(value)) throw new Error('Timer clock must be finite');
    // Production uses a monotonic clock, unaffected by timezone / wall-clock edits.
    this.lastNow = Math.max(this.lastNow, value);
    return this.lastNow;
  }

  private remaining(now: number): number {
    if (this.phase === 'IDLE') return 0;
    return Math.max(0, this.deadline === null ? this.frozenRemaining : this.deadline - now);
  }

  private begin(phase: 'WORKING' | 'BREAK', at: number): void {
    this.phase = phase;
    this.intervalId++;
    this.duration = (phase === 'BREAK' ? this.settings.breakMinutes : this.settings.workMinutes) * MINUTE;
    this.activeWarning = phase === 'WORKING' ? this.settings.warningMinutes * MINUTE : 0;
    this.warningSent = false;
    this.frozenRemaining = this.duration;
    this.deadline = this.pauses.size ? null : at + this.duration;
  }

  private advance(now: number): void {
    if (this.phase === 'IDLE' || this.pauses.size || this.deadline === null) return;
    // Retain overshoot: a delayed UI tick cannot extend the current interval.
    // Only the final live state is published, so expired breaks never flash onscreen.
    while (this.deadline !== null && now >= this.deadline) {
      const boundary: number = this.deadline;
      if (this.phase === 'BREAK') {
        this.begin('WORKING', boundary);
        const cycle = (this.settings.workMinutes + this.settings.breakMinutes) * MINUTE;
        const skip = Math.floor((now - boundary) / cycle);
        // Skip arbitrarily many complete cycles without an unbounded catch-up loop.
        if (skip > 0) {
          this.deadline = boundary + skip * cycle + this.duration;
          this.intervalId += skip * 2;
        }
      } else {
        this.begin('BREAK', boundary);
      }
    }
    if (this.phase === 'WORKING' && this.activeWarning > 0 && this.remaining(now) <= this.activeWarning) {
      this.phase = 'WARNING';
    }
  }

  private setPaused(reason: PauseReason, paused: boolean): void {
    if (this.pauses.has(reason) === paused) return;
    const now = this.now();
    if (paused) {
      if (!this.pauses.size) {
        this.advance(now);
        this.frozenRemaining = this.remaining(now);
        this.deadline = null;
      }
      this.pauses.add(reason);
    } else {
      this.pauses.delete(reason);
      if (!this.pauses.size && this.phase !== 'IDLE') this.deadline = now + this.frozenRemaining;
      this.advance(now);
    }
    this.publish(now);
  }

  private makeSnapshot(now: number): TimerSnapshot {
    return {
      revision: this.revision, phase: this.phase, intervalId: this.intervalId,
      remainingMs: this.remaining(now), durationMs: this.duration,
      paused: this.phase !== 'IDLE' && this.pauses.size > 0,
      pauseReasons: [...this.pauses].sort(), settings: { ...this.settings },
    };
  }

  private publish(now: number): void {
    const notifyWarning = this.phase === 'WARNING' && !this.pauses.size && !this.warningSent;
    if (notifyWarning) this.warningSent = true;
    const snapshot = this.makeSnapshot(now);
    const key = JSON.stringify([snapshot.phase, snapshot.intervalId, Math.ceil(snapshot.remainingMs / 1000),
      snapshot.durationMs, snapshot.pauseReasons, snapshot.settings]);
    if (key !== this.lastPublished) {
      this.lastPublished = key;
      this.revision++;
      for (const listener of this.listeners) listener(this.makeSnapshot(now));
    }
    if (notifyWarning) for (const listener of this.warnings) listener(this.makeSnapshot(now));
  }
}
