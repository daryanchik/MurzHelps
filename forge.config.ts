import type { ForgeConfig } from '@electron-forge/shared-types';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { readFileSync } from 'node:fs';

const exec = promisify(execFile);
const { version } = JSON.parse(readFileSync(path.resolve('package.json'), 'utf8')) as { version: string };
const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    name: 'MurzHelps',
    executableName: 'MurzHelps',
    appBundleId: 'app.murzhelps.desktop',
    appCategoryType: 'public.app-category.productivity',
    icon: path.resolve('assets/icon'),
    extendInfo: { LSUIElement: true, NSHighResolutionCapable: true },
    // Bundles contain all runtime code. Never ship sources, tests or build tools.
    ignore: file => (Boolean(file)
      && !/^\/(dist(?:\/|$)|assets(?:\/|$)|package\.json$)/.test(file))
      || /^\/assets\/(source|icons)(?:\/|$)/.test(file)
      || file === '/assets/icon.svg',
    prune: false,
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-dmg',
      platforms: ['darwin'],
      config: { name: 'MurzHelps', format: 'ULFO', overwrite: true },
    },
    {
      name: '@electron-forge/maker-squirrel',
      platforms: ['win32'],
      config: {
        name: 'MurzHelps',
        authors: 'MurzHelps',
        description: 'Murz has decided that your break has started.',
        setupExe: `MurzHelps-${version}-Setup.exe`,
        setupIcon: path.resolve('assets/icon.ico'),
        noMsi: true,
      },
    },
    // Auxiliary Linux ZIP for build verification. Linux is not a supported target.
    { name: '@electron-forge/maker-zip', platforms: ['linux'], config: {} },
  ],
  hooks: {
    generateAssets: async () => {
      const { stdout } = await exec(process.execPath, [path.resolve('scripts/build.mjs')]);
      process.stdout.write(stdout);
    },
  },
};
export default config;
