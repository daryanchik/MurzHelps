/** Platform icons share one committed photograph; tray assets are independent. */
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function generateAppIcons({
  source = path.join(root, 'assets/icons/murz-icon.png'),
  output = path.join(root, 'assets'),
} = {}) {
  // Contain preserves the full face, ears, aspect ratio and transparent padding.
  const photo = await sharp(source).resize(1024, 1024, {
    fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 },
  }).ensureAlpha().png().toBuffer();
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'icon.png'), photo);

  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = await Promise.all(sizes.map(size => sharp(photo).resize(size, size).png().toBuffer()));
  const directory = Buffer.alloc(6 + sizes.length * 16);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(sizes.length, 4);
  let offset = directory.length;
  pngs.forEach((png, i) => {
    const at = 6 + i * 16;
    directory[at] = sizes[i] % 256;
    directory[at + 1] = sizes[i] % 256;
    directory.writeUInt16LE(1, at + 4);
    directory.writeUInt16LE(32, at + 6);
    directory.writeUInt32LE(png.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });
  await writeFile(path.join(output, 'icon.ico'), Buffer.concat([directory, ...pngs]));

  const chunks = [];
  for (const [type, size] of [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024]]) {
    const png = await sharp(photo).resize(size, size).png().toBuffer();
    const header = Buffer.alloc(8);
    header.write(type);
    header.writeUInt32BE(png.length + 8, 4);
    chunks.push(header, png);
  }
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(8);
  header.write('icns');
  header.writeUInt32BE(body.length + 8, 4);
  await writeFile(path.join(output, 'icon.icns'), Buffer.concat([header, body]));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await generateAppIcons();
  console.log('Generated PNG, ICO and ICNS from assets/icons/murz-icon.png. Tray unchanged.');
}
