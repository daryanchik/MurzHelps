import { build } from 'esbuild';
import { copyFile, mkdir, rm, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateAppIcons } from './prepare-icons.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
await generateAppIcons();
for (const file of ['murz.png', 'tray.png', 'tray@2x.png', 'trayTemplate.png', 'trayTemplate@2x.png', 'icon.png', 'icon.ico', 'icon.icns']) {
  await access(path.join('assets', file));
}
await rm('dist', { recursive: true, force: true });
await mkdir('dist/renderer', { recursive: true });
await Promise.all([
  build({ entryPoints: ['src/main/main.ts'], outfile: 'dist/main/main.cjs', platform: 'node', format: 'cjs', target: 'node22', bundle: true, external: ['electron'], sourcemap: true }),
  build({ entryPoints: ['src/preload/preload.ts'], outfile: 'dist/preload/preload.cjs', platform: 'node', format: 'cjs', target: 'node22', bundle: true, external: ['electron'], sourcemap: true }),
  build({ entryPoints: ['src/preload/settings-preload.ts'], outfile: 'dist/preload/settings-preload.cjs', platform: 'node', format: 'cjs', target: 'node22', bundle: true, external: ['electron'], sourcemap: true }),
  build({ entryPoints: ['src/renderer/renderer.ts'], outfile: 'dist/renderer/renderer.js', platform: 'browser', format: 'iife', target: 'chrome130', bundle: true, sourcemap: true }),
  build({ entryPoints: ['src/renderer/settings.ts'], outfile: 'dist/renderer/settings.js', platform: 'browser', format: 'iife', target: 'chrome130', bundle: true, sourcemap: true }),
  build({ entryPoints: ['src/renderer/warning.ts'], outfile: 'dist/renderer/warning.js', platform: 'browser', format: 'iife', target: 'chrome130', bundle: true, sourcemap: true }),
  copyFile('src/renderer/index.html', 'dist/renderer/index.html'),
  copyFile('src/renderer/styles.css', 'dist/renderer/styles.css'),
  copyFile('src/renderer/settings.html', 'dist/renderer/settings.html'),
  copyFile('src/renderer/settings.css', 'dist/renderer/settings.css'),
  copyFile('src/renderer/warning.html', 'dist/renderer/warning.html'),
]);
console.log('Built main, sandboxed preload, and renderer.');
