import { isVisit, type TimerSnapshot } from '../shared/timer-state';
import type { BreakTimer } from './timer';

interface BreakView {
  setTimerSnapshot(snapshot: TimerSnapshot): void;
  summon(): void;
  dismiss(): void;
}

/** One existing window; visibility follows the timer, never drives its clock. */
export function bindTimerView(timer: BreakTimer, view: BreakView): () => void {
  let showing: number | null = null;
  const render = (snapshot: TimerSnapshot) => {
    view.setTimerSnapshot(snapshot);
    if (isVisit(snapshot.phase)) {
      if (showing !== snapshot.intervalId) view.summon();
      showing = snapshot.intervalId;
    } else {
      if (showing !== null) view.dismiss();
      showing = null;
    }
  };
  view.dismiss();
  render(timer.snapshot());
  return timer.subscribe(render);
}
