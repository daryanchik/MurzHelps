import { performance } from 'node:perf_hooks';
import { DEFAULT_SETTINGS, validateSettings, isVisit, SNOOZE_MS } from '../shared/timer-state';
import type { PauseReason, VisitKind, TimerPhase, TimerSettings, TimerSnapshot } from '../shared/timer-state';

const MINUTE = 60_000;
type Listener = (snapshot: TimerSnapshot) => void;

/** Pure state machine. No Electron, image, renderer, animation, or scheduling code. */
export class BreakTimer {
  private phase: TimerPhase = 'IDLE';
  private intervalId = 0;
  private visitSequence = 0;
  private visitId: number | null = null;
  private visitKind: VisitKind | null = null;
  private visitDuration = 0;
  private snoozeUsed = false;
  private standalone = false;
  private workIndex = 0;
  private cycleLength = DEFAULT_SETTINGS.longEvery;
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

  startAutomatically(): void {
    if (this.settings.autoStart) this.start();
  }

  restartWork(): void {
    const now = this.now();
    this.pauses.delete('user');
    this.beginCycle(now);
    this.advance(now);
    this.publish(now);
  }

  startBreakNow(): void {
    const now = this.now();
    this.advance(now);
    if (isVisit(this.phase) || this.phase === 'SNOOZED') { this.publish(now); return; }
    this.pauses.delete('user');
    if (this.phase === 'IDLE') {
      this.workIndex = 0;
      this.cycleLength = this.settings.longEvery;
      this.standalone = true;
    }
    this.beginVisit(now, this.phase !== 'IDLE' && this.workIndex === this.cycleLength ? 'long' : 'short');
    this.publish(now);
  }

  /** Tokens change on snooze and return, so even a delayed first-screen click is stale. */
  dismissBreak(expectedIntervalId: number): boolean {
    const now = this.now();
    this.advance(now);
    if (!this.acceptsVisitCommand(expectedIntervalId)) { this.publish(now); return false; }
    this.pauses.delete('user');
    this.finishVisit(now);
    this.advance(now);
    this.publish(now);
    return true;
  }

  snooze(expectedIntervalId: number): boolean {
    const now = this.now();
    this.advance(now);
    if (!this.acceptsVisitCommand(expectedIntervalId) || this.snoozeUsed) { this.publish(now); return false; }
    this.pauses.delete('user');
    this.snoozeUsed = true;
    this.begin('SNOOZED', now, SNOOZE_MS);
    this.publish(now);
    return true;
  }

  private acceptsVisitCommand(id: number): boolean {
    return Number.isSafeInteger(id) && isVisit(this.phase) && id === this.intervalId;
  }

  stop(): void {
    const now = this.now();
    this.phase = 'IDLE';
    this.visitId = null;
    this.visitKind = null;
    this.snoozeUsed = false;
    this.standalone = false;
    this.workIndex = 0;
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

  private begin(phase: TimerPhase, at: number, duration: number): void {
    this.phase = phase;
    this.intervalId++;
    this.duration = duration;
    this.activeWarning = phase === 'WORKING' ? this.settings.warningMinutes * MINUTE : 0;
    this.warningSent = false;
    this.frozenRemaining = duration;
    this.deadline = this.pauses.size ? null : at + duration;
  }

  private beginWork(at: number): void {
    this.visitId = null;
    this.visitKind = null;
    this.snoozeUsed = false;
    this.begin('WORKING', at, this.settings.workMinutes * MINUTE);
  }

  private beginCycle(at: number): void {
    this.workIndex = 1;
    this.cycleLength = this.settings.longEvery;
    this.standalone = false;
    this.beginWork(at);
  }

  private beginVisit(at: number, kind: VisitKind): void {
    this.visitId = ++this.visitSequence;
    this.visitKind = kind;
    this.snoozeUsed = false;
    this.visitDuration = (kind === 'long' ? this.settings.longMinutes : this.settings.shortMinutes) * MINUTE;
    this.begin(kind === 'long' ? 'LONG_VISIT' : 'SHORT_VISIT', at, this.visitDuration);
  }

  private finishVisit(at: number): void {
    if (this.visitKind === 'long' || this.standalone) this.beginCycle(at);
    else { this.workIndex++; this.beginWork(at); }
  }

  private advance(now: number): void {
    if (this.phase === 'IDLE' || this.pauses.size || this.deadline === null) return;
    // Retain elapsed overshoot, publishing only the final live state.
    while (this.deadline !== null && now >= this.deadline) {
      const boundary: number = this.deadline;
      if (this.phase === 'SNOOZED') {
        this.begin(this.visitKind === 'long' ? 'LONG_VISIT' : 'SHORT_VISIT', boundary, this.visitDuration);
      } else if (isVisit(this.phase)) {
        const completedCycle = this.visitKind === 'long' || this.standalone;
        this.finishVisit(boundary);
        if (completedCycle) {
          const cycle = (this.cycleLength * this.settings.workMinutes
            + (this.cycleLength - 1) * this.settings.shortMinutes + this.settings.longMinutes) * MINUTE;
          const skip = Math.floor((now - boundary) / cycle);
          if (skip > 0) {
            this.deadline = boundary + skip * cycle + this.duration;
            this.intervalId += skip * this.cycleLength * 2;
            this.visitSequence += skip * this.cycleLength;
          }
        }
      } else {
        this.beginVisit(boundary, this.workIndex === this.cycleLength ? 'long' : 'short');
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
      visitId: this.visitId, visitKind: this.visitKind, snoozeUsed: this.snoozeUsed,
      workIndex: this.workIndex, cycleLength: this.cycleLength,
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
      snapshot.durationMs, snapshot.pauseReasons, snapshot.settings, snapshot.visitId, snapshot.snoozeUsed, snapshot.workIndex, snapshot.cycleLength]);
    if (key !== this.lastPublished) {
      this.lastPublished = key;
      this.revision++;
      for (const listener of this.listeners) listener(this.makeSnapshot(now));
    }
    if (notifyWarning) for (const listener of this.warnings) listener(this.makeSnapshot(now));
  }
}
