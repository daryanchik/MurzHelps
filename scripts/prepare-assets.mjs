/** One-time deterministic asset preparation. Never redraws, rotates, or crops Murz. */
import sharp from 'sharp';
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

// Small code-native silhouette for the app/tray, unrelated to photo processing.
const silhouette = '<path fill="#25241f" d="M18 70c0-18 15-29 34-27l-2-15 17 8 12-8 6 17c9 4 14 12 13 21-1 14-15 24-32 24H39c-14 0-21-8-21-20Z"/><path d="M36 75c-13-13-26-7-23 4 3 10 19 12 32 8" fill="none" stroke="#25241f" stroke-width="9" stroke-linecap="round"/><path d="M62 54q5 4 10 0m8 0q4 3 7-1" fill="none" stroke="#f7f4ed" stroke-width="3" stroke-linecap="round"/>';
const templateSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 110 110">${silhouette.replaceAll('#25241f', '#000').replaceAll('#f7f4ed', '#fff')}</svg>`;
const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 110 110"><rect x="2" y="2" width="106" height="106" rx="26" fill="#f7f4ed"/>${silhouette}</svg>`;
// App icon: Murzik's real face
await sharp('src/web/assets/murz-icon.png')
  .resize(1024, 1024, {
    fit: 'contain',
    background: '#00000000'
  })
  .png()
  .toFile('assets/icon.png');
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
const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = await Promise.all(sizes.map(size => sharp(Buffer.from(iconSvg)).resize(size).png().toBuffer()));
const icoHeader = Buffer.alloc(6 + sizes.length * 16);
icoHeader.writeUInt16LE(1, 2); icoHeader.writeUInt16LE(sizes.length, 4);
let offset = icoHeader.length;
pngs.forEach((png, i) => {
  const at = 6 + i * 16;
  icoHeader[at] = sizes[i] % 256; icoHeader[at + 1] = sizes[i] % 256;
  icoHeader.writeUInt16LE(1, at + 4); icoHeader.writeUInt16LE(32, at + 6);
  icoHeader.writeUInt32LE(png.length, at + 8); icoHeader.writeUInt32LE(offset, at + 12);
  offset += png.length;
});
await writeFile('assets/icon.ico', Buffer.concat([icoHeader, ...pngs]));
const chunks = [];
for (const [type, size] of [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024]]) {
  const data = await sharp(Buffer.from(iconSvg)).resize(size).png().toBuffer();
  const header = Buffer.alloc(8); header.write(type); header.writeUInt32BE(data.length + 8, 4);
  chunks.push(header, data);
}
const icnsBody = Buffer.concat(chunks), icnsHeader = Buffer.alloc(8);
icnsHeader.write('icns'); icnsHeader.writeUInt32BE(icnsBody.length + 8, 4);
await writeFile('assets/icon.icns', Buffer.concat([icnsHeader, icnsBody]));
// Fail asset preparation if any original color byte changed during PNG encoding.
const decoded = await sharp(await readFile('assets/murz.png')).raw().toBuffer();
for (let i = 0; i < count; i++) {
  for (let c = 0; c < 3; c++) {
    if (decoded[i * 4 + c] !== rgb[i * 3 + c]) throw new Error('Original photo RGB changed');
  }
}
