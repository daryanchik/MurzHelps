import { build } from 'esbuild';
import { copyFile, mkdir, rm, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
for (const file of ['murz.png', 'tray.png', 'trayTemplate.png', 'icon.ico', 'icon.icns']) {
  await access(path.join('assets', file));
}
await rm('dist', { recursive: true, force: true });
await mkdir('dist/renderer', { recursive: true });
await Promise.all([
  build({ entryPoints: ['src/main/main.ts'], outfile: 'dist/main/main.cjs', platform: 'node', format: 'cjs', target: 'node22', bundle: true, external: ['electron'], sourcemap: true }),
  build({ entryPoints: ['src/preload/preload.ts'], outfile: 'dist/preload/preload.cjs', platform: 'node', format: 'cjs', target: 'node22', bundle: true, external: ['electron'], sourcemap: true }),
  build({ entryPoints: ['src/renderer/renderer.ts'], outfile: 'dist/renderer/renderer.js', platform: 'browser', format: 'iife', target: 'chrome130', bundle: true, sourcemap: true }),
  copyFile('src/renderer/index.html', 'dist/renderer/index.html'),
  copyFile('src/renderer/styles.css', 'dist/renderer/styles.css'),
]);
console.log('Built main, sandboxed preload, and renderer.');
