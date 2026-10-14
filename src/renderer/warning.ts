import { murzAsset, type MurzAssetId } from '../shared/murz-assets';
import { murzCopy } from '../shared/murz-copy';
import type { PassiveCatBridge } from '../shared/types';

declare global { interface Window { murzPassive: PassiveCatBridge } }
const params = new URLSearchParams(location.search);
const mode = params.get('mode') === 'reward' ? 'reward' : 'warning';
const asset = murzAsset((params.get('asset') ?? 'mw') as MurzAssetId);
const image = document.querySelector<HTMLImageElement>('#murz')!;
const message = document.querySelector<HTMLElement>('#message')!;
const group = document.querySelector<HTMLElement>('#composition')!;
document.body.className = mode;
document.title = murzCopy.brand;
message.textContent = params.get('message') ?? murzCopy.states.WARNING;
image.alt = murzCopy.catAlt;
image.classList.toggle('outlined', asset.outline);
image.src = `../../assets/${asset.file}`;

function layout(): void {
  if (!image.naturalWidth || !image.naturalHeight) return;
  // Measure content before the native window is shrunk. Do not feed that shrink
  // back into image height: it used to shrink the cat/card again on every resize.
  const availableWidth = Math.max(1, Number(params.get('availableWidth')) || innerWidth);
  const availableHeight = Math.max(1, Number(params.get('availableHeight')) || innerHeight);
  message.style.maxWidth = `${Math.max(1, Math.min(340, availableWidth - 8, innerWidth - 8))}px`;
  const wantedHeight = Math.max(40, Math.min(360, Number(params.get('imageHeight')) || 195));
  const maxHeight = Math.max(1, Math.min(wantedHeight, availableHeight - message.offsetHeight - 14));
  const width = Math.min(availableWidth - 8, innerWidth - 8, maxHeight * image.naturalWidth / image.naturalHeight);
  image.style.width = `${Math.max(1, width)}px`;
  image.style.height = `${Math.max(1, width * image.naturalHeight / image.naturalWidth)}px`;
}

void image.decode().then(() => {
  layout();
  requestAnimationFrame(() => {
    const rect = group.getBoundingClientRect();
    window.murzPassive.ready(Math.ceil(rect.width + 8), Math.ceil(rect.height + 8));
    document.body.classList.add('ready');
  });
}).catch(() => window.murzPassive.failed());
image.addEventListener('error', () => window.murzPassive.failed());
window.addEventListener('resize', layout);
document.addEventListener('contextmenu', event => event.preventDefault());
