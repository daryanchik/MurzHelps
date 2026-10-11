import type { TimerSnapshot } from '../shared/timer-state';
import type { BreakTimer } from './timer';

interface BreakView {
  setTimerSnapshot(snapshot: TimerSnapshot): void;
  summon(): void;
  dismiss(): void;
}

/** One existing window; visibility follows the timer, never drives its clock. */
export function bindTimerView(timer: BreakTimer, view: BreakView): () => void {
  let showing = false;
  const render = (snapshot: TimerSnapshot) => {
    view.setTimerSnapshot(snapshot);
    if (snapshot.phase === 'BREAK') {
      if (!showing) view.summon();
      showing = true;
    } else {
      if (showing) view.dismiss();
      showing = false;
    }
  };
  view.dismiss();
  render(timer.snapshot());
  return timer.subscribe(render);
}
