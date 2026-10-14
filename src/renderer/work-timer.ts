import { formatRemaining, type TimerSnapshot } from '../shared/timer-state';
import { murzCopy } from '../shared/murz-copy';
import type { WorkTimerBridge } from '../shared/types';
declare global { interface Window { murzWorkTimer: WorkTimerBridge } }
const time = document.querySelector<HTMLOutputElement>('#time')!;
const pause = document.querySelector<HTMLElement>('#pause')!;
const label = document.querySelector<HTMLElement>('#label')!;
label.textContent = murzCopy.workTimerArrival;
let revision = -1;
function render(snapshot: TimerSnapshot): void {
  if (snapshot.revision < revision) return;
  revision = snapshot.revision;
  label.textContent = snapshot.phase === 'SNOOZED' ? murzCopy.workTimerReturn : murzCopy.workTimerArrival;
  time.textContent = formatRemaining(snapshot.remainingMs);
  pause.textContent = snapshot.paused ? murzCopy.paused : '';
}
window.murzWorkTimer.onTimer(render);
void window.murzWorkTimer.get().then(render).catch(() => {});
for (const edge of document.querySelectorAll<HTMLElement>('[data-edge]')) {
  edge.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault(); edge.setPointerCapture(event.pointerId);
    window.murzWorkTimer.resizeStart(edge.dataset.edge!);
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) edge.addEventListener(name, () => window.murzWorkTimer.resizeEnd());
}
window.addEventListener('blur', () => window.murzWorkTimer.resizeEnd());
document.addEventListener('contextmenu', event => event.preventDefault());
document.addEventListener('dragstart', event => event.preventDefault());
