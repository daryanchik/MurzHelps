import { murzCopy } from '../shared/murz-copy';
import { isVisit, type TimerEvent, type TimerSnapshot } from '../shared/timer-state';
import type { BreakTimer } from './timer';
import { PassiveCat } from './passive-cat';
import { onDesktopUnsafe } from './platform';

export class CycleReward {
  private eligible = false;
  private rewardedCycle = -1;
  private readonly cat: PassiveCat;
  private readonly unsubscribe: (() => void)[];
  constructor(timer: BreakTimer, assets: string, private readonly takePriority: () => void) {
    this.cat = new PassiveCat(assets);
    this.unsubscribe = [timer.onEvent((event, current) => this.event(event, current)), timer.subscribe(snapshot => {
      if (isVisit(snapshot.phase) || snapshot.phase === 'IDLE' || snapshot.phase === 'SNOOZED' || snapshot.paused) this.clear();
    }), onDesktopUnsafe(() => this.clear())];
  }
  get visible(): boolean { return this.cat.visible; }
  clear(): void { this.cat.clear(); }
  dispose(): void { for (const unsubscribe of this.unsubscribe) unsubscribe(); this.cat.dispose(); }

  private event(event: TimerEvent, current: TimerSnapshot): void {
    if (event.type === 'reset') { this.eligible = false; this.clear(); return; }
    if (event.type === 'cycle-started') { this.eligible = true; return; }
    if (event.type === 'dismiss' || event.type === 'work-skipped' || event.type === 'snooze' || event.type === 'cycles-skipped') this.eligible = false;
    if (event.type !== 'visit-finished' || !event.natural) return;
    const cycle = event.snapshot.cycleId ?? -1;
    if (event.snapshot.visitKind !== 'long' || !this.eligible
      || cycle === this.rewardedCycle || current.cycleId !== cycle + 1 || current.workIndex !== 1
      || (current.phase !== 'WORKING' && current.phase !== 'WARNING') || current.paused
      || current.durationMs - current.remainingMs > 2500) return;
    this.rewardedCycle = cycle;
    this.takePriority();
    void this.cat.show({ mode: 'reward', asset: 'murz-shirt', message: murzCopy.reward, duration: 5000 })
      .catch(error => console.warn('Reward unavailable:', error));
  }
}
