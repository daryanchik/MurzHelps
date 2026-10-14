import { readdirSync } from 'node:fs';
import type { ShortMurzAssetId, WarningMurzAssetId } from '../shared/murz-assets';

export function discoverMurzAssets(directory: string): { short: ShortMurzAssetId[]; warning: WarningMurzAssetId[] } {
  let names: string[];
  try { names = readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isFile()).map(entry => entry.name); }
  catch { return { short: [], warning: [] }; }
  names.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  return {
    short: names.filter(name => /^ms[1-9]\d*\.png$/.test(name)).map(name => name.slice(0, -4) as ShortMurzAssetId),
    warning: names.filter(name => /^mw(?:[1-9]\d*)?\.png$/.test(name)).map(name => name.slice(0, -4) as WarningMurzAssetId),
  };
}
