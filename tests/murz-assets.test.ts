import { test } from 'node:test';
import assert from 'node:assert/strict';
import { murzAssets, shortMurzAssets, selectShortAsset } from '../src/shared/murz-assets';
import { murzCopy, randomCopy } from '../src/shared/murz-copy';
import { VisitPresentation } from '../src/main/visit-presentation';
import { BreakTimer } from '../src/main/timer';
import config from '../forge.config';
import { ShuffleBag } from '../src/shared/shuffle-bag';

test('all seven new assets are runtime paths allowed by the existing package filter', () => {
  const ignore = config.packagerConfig!.ignore as (file: string) => boolean;
  for (const [id, asset] of Object.entries(murzAssets)) {
    assert.equal(ignore(`/assets/${asset.file}`), false);
    assert.equal(asset.outline, id !== 'mb');
  }
  assert.equal(shortMurzAssets.length, 6);
  assert.equal(murzAssets.mb.file, 'murz.png');
  assert.equal(murzAssets.mw.file, 'mw.png');
  assert.equal(ignore('/assets/source/original.png'), true);
});

test('short assets do not immediately repeat, including across a long visit', () => {
  assert.equal(selectShortAsset([], undefined, () => 0), 'mb');
  assert.equal(selectShortAsset(['ms1'], 'ms1', () => 0), 'ms1');
  for (const previous of shortMurzAssets) {
    for (const random of [0, 0.5, 0.999]) assert.notEqual(selectShortAsset(shortMurzAssets, previous, () => random), previous);
  }
  const timer = new BreakTimer();
  const view = new VisitPresentation(['ms1', 'ms2'], () => 0);
  timer.start(); timer.startBreakNow(); const first = view.forVisit(timer.snapshot());
  for (let i = 0; i < 3; i++) { timer.dismissBreak(timer.snapshot().intervalId); timer.startBreakNow(); }
  assert.equal(view.forVisit(timer.snapshot()).asset, 'mb');
  timer.dismissBreak(timer.snapshot().intervalId); timer.startBreakNow();
  assert.notEqual(view.forVisit(timer.snapshot()).asset, first.asset);
});

test('snooze preserves the picture and phrase; adding copy needs no photo or timer change', () => {
  let now = 0;
  const timer = new BreakTimer(undefined, () => now);
  const view = new VisitPresentation(shortMurzAssets, () => 0);
  timer.startBreakNow(); const initial = view.forVisit(timer.snapshot());
  timer.snooze(timer.snapshot().intervalId);
  assert.deepEqual(view.forVisit(timer.snapshot()), initial);
  now += 5 * 60_000; timer.tick(); assert.deepEqual(view.forVisit(timer.snapshot()), initial);
  assert.equal(initial.message, murzCopy.short[0]);
  assert.equal(randomCopy(['Новая реплика'], 'fallback'), 'Новая реплика');
  assert.equal(randomCopy([], murzCopy.cardTitle), murzCopy.cardTitle);
});

test('shuffle bag draws every item once per cycle and avoids repeats at boundaries', () => {
  const bag = new ShuffleBag(['a', 'b', 'c'], () => 0);
  const first = [bag.next(), bag.next(), bag.next()];
  assert.deepEqual(new Set(first), new Set(['a', 'b', 'c']));
  const second = [bag.next(), bag.next(), bag.next()];
  assert.notEqual(first[2], second[0]);
  assert.deepEqual(new Set(second), new Set(['a', 'b', 'c']));
  assert.equal(new ShuffleBag<string>([]).next(), undefined);
  assert.equal(new ShuffleBag(['a'], () => 0).next(), 'a');
});

test('short visits show all phrases and all six images before they repeat', () => {
  const timer = new BreakTimer();
  const view = new VisitPresentation(shortMurzAssets, () => 0);
  const phrases: string[] = [], images: string[] = [];
  timer.start();
  for (let i = 0; phrases.length < murzCopy.short.length && i < 100; i++) {
    timer.startBreakNow();
    const snapshot = timer.snapshot();
    const presentation = view.forVisit(snapshot);
    if (snapshot.visitKind === 'short') {
      phrases.push(presentation.message);
      images.push(presentation.asset);
    }
    assert.equal(timer.dismissBreak(snapshot.intervalId), true);
  }
  assert.equal(phrases.length, murzCopy.short.length);
  assert.equal(new Set(phrases).size, murzCopy.short.length);
  assert.equal(new Set(images.slice(0, shortMurzAssets.length)).size, shortMurzAssets.length);
});
