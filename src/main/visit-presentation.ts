import { murzCopy, randomCopy } from '../shared/murz-copy';
import { selectShortAsset, type MurzAssetId, type MurzPresentation, type ShortMurzAssetId } from '../shared/murz-assets';
import type { TimerSnapshot } from '../shared/timer-state';

export class VisitPresentation {
  private visitId: number | null = null;
  private previous?: MurzAssetId;
  private current: MurzPresentation = { asset: 'mb', message: murzCopy.long };
  constructor(private readonly available: readonly ShortMurzAssetId[], private readonly random = Math.random) {}

  forVisit(snapshot: TimerSnapshot): MurzPresentation {
    if (snapshot.visitId !== null && snapshot.visitId !== this.visitId) {
      this.visitId = snapshot.visitId;
      if (snapshot.visitKind === 'long') this.current = { asset: 'mb', message: murzCopy.long };
      else {
        const asset = selectShortAsset(this.available, this.previous, this.random);
        this.previous = asset;
        this.current = { asset, message: randomCopy(murzCopy.short, murzCopy.cardTitle, this.random) };
      }
    }
    return { ...this.current };
  }
}
