import { murzAssets } from '../shared/murz-assets';
import { murzCopy } from '../shared/murz-copy';

const params = new URLSearchParams(location.search);
const asset = murzAssets[params.get('asset') === 'mw' ? 'mw' : 'mb'];
const image = document.querySelector<HTMLImageElement>('#murz')!;
document.title = murzCopy.states.WARNING;
document.querySelector('#message')!.textContent = params.get('message') ?? murzCopy.states.WARNING;
image.alt = murzCopy.catAlt;
image.src = `../../assets/${asset.file}`;
image.classList.toggle('outlined', asset.outline);
