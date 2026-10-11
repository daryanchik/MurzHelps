import type { TimerSnapshot } from '../shared/timer-state';
import type { BreakTimer } from './timer';

export interface TimerScheduler {
  every(callback: () => void, milliseconds: number): unknown;
  cancel(handle: unknown): void;
}
const defaultScheduler: TimerScheduler = {
  every: (callback, ms) => setInterval(callback, ms),
  cancel: handle => clearInterval(handle as ReturnType<typeof setInterval>),
};

/** Exactly one refresh loop. It wakes the state machine, never decrements time. */
export class TimerRuntime {
  private handle: unknown;
  private unsubscribe?: () => void;
  constructor(private readonly timer: BreakTimer, private readonly scheduler = defaultScheduler) {}

  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.timer.subscribe(snapshot => this.sync(snapshot));
    this.sync(this.timer.snapshot());
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.clear();
  }

  private clear(): void {
    if (this.handle !== undefined) this.scheduler.cancel(this.handle);
    this.handle = undefined;
  }

  private sync(snapshot: TimerSnapshot): void {
    if (snapshot.phase === 'IDLE' || snapshot.paused) { this.clear(); return; }
    if (this.handle === undefined) this.handle = this.scheduler.every(() => this.timer.tick(), 250);
  }
}
