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

export type MurzAssetId = keyof typeof murzAssets;
export type ShortMurzAssetId = Exclude<MurzAssetId, 'mb' | 'mw'>;
export const shortMurzAssets = Object.keys(murzAssets).filter(
  (id): id is ShortMurzAssetId => id !== 'mb' && id !== 'mw',
);
export interface MurzPresentation { asset: MurzAssetId; message: string }

export function selectShortAsset(available: readonly ShortMurzAssetId[], previous?: MurzAssetId,
  random = Math.random): MurzAssetId {
  const candidates = available.length > 1 ? available.filter(id => id !== previous) : available;
  return candidates.length
    ? candidates[Math.min(candidates.length - 1, Math.max(0, Math.floor(random() * candidates.length)))]
    : 'mb';
}
