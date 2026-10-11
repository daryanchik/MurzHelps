/** One-time deterministic asset preparation. Never redraws, rotates, or crops Murz. */
import sharp from 'sharp';
import { generateAppIcons } from './prepare-icons.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.chdir(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const { data: rgb, info } = await sharp('assets/source/murz-original.jpeg').removeAlpha().raw().toBuffer({ resolveWithObject: true });
const { width, height } = info;
const count = width * height;
const background = new Uint8Array(count);
const queue = new Int32Array(count);
let head = 0, tail = 0;
function enqueue(pixel) {
  if (background[pixel]) return;
  const offset = pixel * 3;
  const low = Math.min(rgb[offset], rgb[offset + 1], rgb[offset + 2]);
  const high = Math.max(rgb[offset], rgb[offset + 1], rgb[offset + 2]);
  // Only near-white pixels connected to the OUTSIDE are background.
  if (low < 232 || high - low > 22) return;
  background[pixel] = 1;
  queue[tail++] = pixel;
}
for (let x = 0; x < width; x++) { enqueue(x); enqueue((height - 1) * width + x); }
for (let y = 0; y < height; y++) { enqueue(y * width); enqueue(y * width + width - 1); }
while (head < tail) {
  const pixel = queue[head++], x = pixel % width, y = Math.floor(pixel / width);
  if (x > 0) enqueue(pixel - 1);
  if (x + 1 < width) enqueue(pixel + 1);
  if (y > 0) enqueue(pixel - width);
  if (y + 1 < height) enqueue(pixel + width);
}
const rgba = Buffer.alloc(count * 4);
let transparent = 0;
for (let i = 0; i < count; i++) {
  // Preserve EVERY decoded RGB byte. Only the alpha channel is introduced.
  rgba[i * 4] = rgb[i * 3];
  rgba[i * 4 + 1] = rgb[i * 3 + 1];
  rgba[i * 4 + 2] = rgb[i * 3 + 2];
  const low = Math.min(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]);
  const alpha = background[i] ? Math.max(0, Math.min(255, Math.round((248 - low) * 255 / 16))) : 255;
  rgba[i * 4 + 3] = alpha;
  if (alpha === 0) transparent++;
}
await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toFile('assets/murz.png');
console.log(`Original photo preserved: ${width}×${height}; ${(transparent / count * 100).toFixed(1)}% fully transparent.`);

// Original code-native tray silhouette, independent of the photographic app icon.
const silhouette = '<path fill="#25241f" d="M18 70c0-18 15-29 34-27l-2-15 17 8 12-8 6 17c9 4 14 12 13 21-1 14-15 24-32 24H39c-14 0-21-8-21-20Z"/><path d="M36 75c-13-13-26-7-23 4 3 10 19 12 32 8" fill="none" stroke="#25241f" stroke-width="9" stroke-linecap="round"/><path d="M62 54q5 4 10 0m8 0q4 3 7-1" fill="none" stroke="#f7f4ed" stroke-width="3" stroke-linecap="round"/>';
const templateSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 110 110">${silhouette.replaceAll('#25241f', '#000').replaceAll('#f7f4ed', '#fff')}</svg>`;
const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 110 110"><rect x="2" y="2" width="106" height="106" rx="26" fill="#f7f4ed"/>${silhouette}</svg>`;
await generateAppIcons();
await sharp(Buffer.from(iconSvg)).resize(32).png().toFile('assets/tray.png');
await sharp(Buffer.from(iconSvg)).resize(64).png().toFile('assets/tray@2x.png');
for (const [size, name] of [[20, 'trayTemplate.png'], [40, 'trayTemplate@2x.png']]) {
  // Knock out the eye holes instead of leaving white pixels in a macOS template.
  const { data, info: meta } = await sharp(Buffer.from(templateSvg)).resize(size).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    data[i + 3] = Math.round(data[i + 3] * (1 - data[i] / 255));
    data[i] = data[i + 1] = data[i + 2] = 0;
  }
  await sharp(data, { raw: meta }).png().toFile(`assets/${name}`);
}
// Fail asset preparation if any original color byte changed during PNG encoding.
const decoded = await sharp(await readFile('assets/murz.png')).raw().toBuffer();
for (let i = 0; i < count; i++) {
  for (let c = 0; c < 3; c++) {
    if (decoded[i * 4 + c] !== rgb[i * 3 + c]) throw new Error('Original photo RGB changed');
  }
}
