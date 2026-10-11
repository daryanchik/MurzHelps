import { murzCopy } from '../shared/murz-copy';
import type { MurzPresentation, ShortMurzAssetId } from '../shared/murz-assets';
import type { TimerSnapshot } from '../shared/timer-state';
import { ShuffleBag } from '../shared/shuffle-bag';

export class VisitPresentation {
  private visitId: number | null = null;
  private current: MurzPresentation = { asset: 'mb', message: murzCopy.long };
  private readonly images: ShuffleBag<ShortMurzAssetId>;
  private readonly messages: ShuffleBag<string>;

  constructor(available: readonly ShortMurzAssetId[], random = Math.random) {
    this.images = new ShuffleBag(available, random);
    this.messages = new ShuffleBag(murzCopy.short, random);
  }

  forVisit(snapshot: TimerSnapshot): MurzPresentation {
    if (snapshot.visitId !== null && snapshot.visitId !== this.visitId) {
      this.visitId = snapshot.visitId;
      if (snapshot.visitKind === 'long') this.current = { asset: 'mb', message: murzCopy.long };
      else this.current = {
        asset: this.images.next() ?? 'mb',
        message: this.messages.next() ?? murzCopy.cardTitle,
      };
    }
    return { ...this.current };
  }
}
