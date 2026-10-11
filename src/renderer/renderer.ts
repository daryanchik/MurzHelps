import type { LayoutSnapshot, MurzBridge, Rect } from '../shared/types';

declare global { interface Window { murz: MurzBridge } }

const image = document.querySelector<HTMLImageElement>('#murz')!;
const button = document.querySelector<HTMLButtonElement>('#dismiss')!;
let latestRevision = -1;

function place(element: HTMLElement, rect: Rect): void {
  // CSSOM property assignment is allowed by the restrictive style-src CSP.
  element.style.left = `${rect.x}px`;
  element.style.top = `${rect.y}px`;
  element.style.width = `${rect.width}px`;
  element.style.height = `${rect.height}px`;
}

async function applyLayout(snapshot: LayoutSnapshot): Promise<void> {
  if (snapshot.revision <= latestRevision) return;
  latestRevision = snapshot.revision;
  try {
    await image.decode();
    if (snapshot.revision !== latestRevision) return;
    place(image, snapshot.layout.cat);
    place(button, snapshot.layout.button);
    button.style.borderRadius = `${snapshot.layout.buttonRadius}px`;
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    if (snapshot.revision === latestRevision) window.murz.ready(snapshot.revision);
  } catch {
    window.murz.reportError();
  }
}

// Subscribe before asking for the initial state: no missed display-change update.
window.murz.onLayout(snapshot => { void applyLayout(snapshot); });
void window.murz.getLayout().then(applyLayout).catch(() => window.murz.reportError());
button.addEventListener('click', () => window.murz.dismiss());
image.addEventListener('error', () => window.murz.reportError());
document.addEventListener('dragstart', event => event.preventDefault());
document.addEventListener('contextmenu', event => event.preventDefault());
// Forwarded moves reduce the latency of macOS click-through; main owns the mask.
let pendingMove = false;
document.addEventListener('pointermove', () => {
  if (pendingMove) return;
  pendingMove = true;
  requestAnimationFrame(() => { pendingMove = false; window.murz.pointerMoved(); });
}, { passive: true });
// Prevent Chromium's page zoom without installing a global keyboard hook.
document.addEventListener('wheel', event => { if (event.ctrlKey || event.metaKey) event.preventDefault(); }, { passive: false });
