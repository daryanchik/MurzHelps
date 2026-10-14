import { formatRemaining, isVisit, idleSnapshot, type TimerSnapshot } from '../shared/timer-state';
import { murzAsset } from '../shared/murz-assets';
import { murzCopy } from '../shared/murz-copy';
import type { LayoutSnapshot, MurzBridge, Rect } from '../shared/types';

declare global { interface Window { murz: MurzBridge } }
const image = document.querySelector<HTMLImageElement>('#murz')!;
const dismiss = document.querySelector<HTMLButtonElement>('#dismiss')!;
const snooze = document.querySelector<HTMLButtonElement>('#snooze')!;
const info = document.querySelector<HTMLElement>('#visit-info')!;
const remaining = document.querySelector<HTMLOutputElement>('#remaining')!;
const status = document.querySelector<HTMLElement>('#status')!;
const pauseStatus = document.querySelector<HTMLElement>('#pause-status')!;
const message = document.querySelector<HTMLElement>('#message')!;
let latestRevision = -1, timerRevision = -1;
let displayedInterval: number | null = null;
let pendingAction: number | null = null;
let visitMessage = '';
let timerState: TimerSnapshot = idleSnapshot();
document.title = murzCopy.brand;
image.alt = murzCopy.catAlt;
dismiss.textContent = murzCopy.buttons.dismiss;
remaining.setAttribute('aria-label', murzCopy.remaining);
info.setAttribute('aria-label', murzCopy.cardTitle);

function place(element: HTMLElement, rect: Rect): void {
  Object.assign(element.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
}
function updateButtons(): void {
  const disabled = !isVisit(timerState.phase) || displayedInterval !== timerState.intervalId
    || pendingAction === timerState.intervalId || timerState.pauseReasons.some(reason => reason === 'lock' || reason === 'sleep');
  dismiss.textContent = murzCopy.buttons.dismiss;
  dismiss.disabled = disabled;
  snooze.disabled = disabled || timerState.snoozeUsed;
  snooze.textContent = timerState.snoozeUsed ? murzCopy.buttons.snoozeUsed : murzCopy.buttons.snooze;
  message.textContent = visitMessage;
}
async function applyLayout(snapshot: LayoutSnapshot): Promise<void> {
  if (snapshot.revision <= latestRevision) return;
  latestRevision = snapshot.revision;
  displayedInterval = null;
  updateButtons();
  try {
    const asset = murzAsset(snapshot.presentation.asset);
    const src = new URL(`../../assets/${asset.file}`, location.href).href;
    if (image.src !== src) image.src = src;
    await image.decode();
    if (snapshot.revision !== latestRevision) return;
    image.classList.toggle('outlined', asset.outline);
    place(image, snapshot.layout.cat);
    place(dismiss, snapshot.layout.button);
    if (snapshot.layout.snooze) place(snooze, snapshot.layout.snooze);
    if (snapshot.layout.info) {
      place(info, snapshot.layout.info);
      info.classList.toggle('compact', snapshot.layout.info.height < 260);
      info.classList.toggle('tiny', snapshot.layout.info.height < 210);
    }
    info.style.borderRadius = `${snapshot.layout.infoRadius ?? 0}px`;
    dismiss.style.borderRadius = snooze.style.borderRadius = `${snapshot.layout.buttonRadius}px`;
    visitMessage = snapshot.presentation.message;
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    if (snapshot.revision !== latestRevision) return;
    displayedInterval = snapshot.intervalId;
    updateButtons();
    window.murz.ready(snapshot.revision);
  } catch {
    if (snapshot.revision === latestRevision) window.murz.reportError();
  }
}
function applyTimer(snapshot: TimerSnapshot): void {
  if (snapshot.revision < timerRevision) return;
  timerRevision = snapshot.revision;
  timerState = snapshot;
  if (pendingAction !== snapshot.intervalId) pendingAction = null;
  remaining.textContent = formatRemaining(snapshot.remainingMs);
  status.textContent = murzCopy.states[snapshot.phase];
  pauseStatus.textContent = snapshot.paused ? murzCopy.paused : '';
  updateButtons();
}
window.murz.onLayout(snapshot => { void applyLayout(snapshot); });
void window.murz.getLayout().then(applyLayout).catch(() => window.murz.reportError());
window.murz.onTimer(applyTimer);
void window.murz.getTimer().then(applyTimer).catch(() => window.murz.reportError());
for (const [button, action] of [[dismiss, 'dismiss'], [snooze, 'snooze']] as const) {
  button.addEventListener('click', () => {
    if (button.disabled || !isVisit(timerState.phase) || pendingAction === timerState.intervalId) return;
    pendingAction = timerState.intervalId;
    updateButtons();
    window.murz[action](timerState.intervalId);
  });
}
document.addEventListener('dragstart', event => event.preventDefault());
document.addEventListener('contextmenu', event => event.preventDefault());
let pendingMove = false;
document.addEventListener('pointermove', () => {
  if (pendingMove) return;
  pendingMove = true;
  requestAnimationFrame(() => { pendingMove = false; window.murz.pointerMoved(); });
}, { passive: true });
document.addEventListener('wheel', event => { if (event.ctrlKey || event.metaKey) event.preventDefault(); }, { passive: false });
