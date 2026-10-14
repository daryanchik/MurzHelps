import type { WarningMurzAssetId } from '../shared/murz-assets';
import { murzCopy } from '../shared/murz-copy';
import { ShuffleBag } from '../shared/shuffle-bag';
import type { TimerSnapshot } from '../shared/timer-state';
import { discoverMurzAssets } from './assets';
import { PassiveCat } from './passive-cat';
import type { BreakTimer } from './timer';

export class BreakWarning {
  private activeId?: number;
  private readonly unsubscribe: (() => void)[];
  private readonly messages = new ShuffleBag(murzCopy.warning);
  private readonly images: ShuffleBag<WarningMurzAssetId>;
  private readonly cat: PassiveCat;

  constructor(timer: BreakTimer, assetDirectory: string, private readonly blocked = () => false) {
    this.images = new ShuffleBag(discoverMurzAssets(assetDirectory).warning);
    this.cat = new PassiveCat(assetDirectory);
    this.unsubscribe = [timer.onWarning(snapshot => { void this.show(snapshot); }), timer.subscribe(snapshot => {
      if (snapshot.phase !== 'WARNING' || snapshot.intervalId !== this.activeId || snapshot.paused || this.blocked()) this.clear();
    })];
  }
  clear(): void { this.activeId = undefined; this.cat.clear(); }
  dispose(): void { for (const unsubscribe of this.unsubscribe) unsubscribe(); this.cat.dispose(); }
  private async show(snapshot: TimerSnapshot): Promise<void> {
    this.clear();
    if (this.blocked() || snapshot.paused) return;
    this.activeId = snapshot.intervalId;
    const id = this.activeId;
    const message = this.messages.next() ?? murzCopy.states.WARNING;
    const shown = await this.cat.show({ mode: 'warning', asset: this.images.next() ?? 'mb', message, duration: 6000 });
    if (!shown && this.activeId === id) await this.cat.show({ mode: 'warning', asset: 'mb', message, duration: 6000 });
  }
}
