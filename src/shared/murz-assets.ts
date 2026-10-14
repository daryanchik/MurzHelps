export const murzAssets = {
  mb: { file: 'murz.png', outline: false },
  ms1: { file: 'ms1.png', outline: true },
  ms2: { file: 'ms2.png', outline: true },
  ms3: { file: 'ms3.png', outline: true },
  ms4: { file: 'ms4.png', outline: true },
  ms5: { file: 'ms5.png', outline: true },
  ms6: { file: 'ms6.png', outline: true },
  mw: { file: 'mw.png', outline: true },
} as const;

export type ShortMurzAssetId = `ms${number}`;
export type WarningMurzAssetId = 'mw' | `mw${number}`;
export type MurzAssetId = 'mb' | ShortMurzAssetId | WarningMurzAssetId | 'murz-shirt';
export const shortMurzAssets = Object.keys(murzAssets).filter(
  (id): id is ShortMurzAssetId => id !== 'mb' && id !== 'mw',
);
export interface MurzPresentation { asset: MurzAssetId; message: string }

/** Derive only controlled basenames, never renderer-provided paths. */
export function murzAsset(id: MurzAssetId): { file: string; outline: boolean } {
  if (id === 'mb') return murzAssets.mb;
  if (id === 'mw' || /^(ms|mw)[1-9]\d*$/.test(id)) return { file: `${id}.png`, outline: true };
  if (id === 'murz-shirt') return { file: `${id}.png`, outline: true };
  return murzAssets.mb;
}

export function selectShortAsset(available: readonly ShortMurzAssetId[], previous?: MurzAssetId,
  random = Math.random): MurzAssetId {
  const candidates = available.length > 1 ? available.filter(id => id !== previous) : available;
  return candidates.length
    ? candidates[Math.min(candidates.length - 1, Math.max(0, Math.floor(random() * candidates.length)))]
    : 'mb';
}
