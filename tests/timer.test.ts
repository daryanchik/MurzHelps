import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BreakTimer } from '../src/main/timer';
import { TimerRuntime, type TimerScheduler } from '../src/main/timer-runtime';
import { bindTimerView } from '../src/main/timer-view';
import { DEFAULT_SETTINGS, SNOOZE_MS, formatRemaining, type TimerSettings, type TimerSnapshot } from '../src/shared/timer-state';

const minute = 60_000;
function fixture(settings: Partial<TimerSettings> = {}) {
  let now = 0;
  const timer = new BreakTimer({ ...DEFAULT_SETTINGS, ...settings }, () => now);
  const warnings: TimerSnapshot[] = [], changes: TimerSnapshot[] = [];
  timer.onWarning(snapshot => warnings.push(snapshot));
  timer.subscribe(snapshot => changes.push(snapshot));
  return { timer, warnings, changes,
    advance: (ms: number, tick = true) => { now += ms; if (tick) timer.tick(); },
    at: (ms: number) => { now = ms; timer.tick(); },
  };
}

test('automatic startup follows preferences; manual Start is idempotent', () => {
  for (const autoStart of [false, true]) {
    const { timer } = fixture({ autoStart });
    assert.equal(timer.snapshot().phase, 'IDLE');
    timer.startAutomatically();
    assert.equal(timer.snapshot().phase, autoStart ? 'WORKING' : 'IDLE');
    timer.start();
    const initial = timer.snapshot();
    assert.equal(initial.remainingMs, 30 * minute);
    assert.equal(initial.workIndex, 1);
    timer.start(); timer.startAutomatically();
    assert.deepEqual(timer.snapshot(), initial);
  }
});

test('three short visits then a long visit AFTER the fourth work interval; cycle repeats', () => {
  const { timer, advance } = fixture(); timer.start();
  for (let cycle = 0; cycle < 2; cycle++) {
    for (let index = 1; index <= 4; index++) {
      assert.equal(timer.snapshot().phase, 'WORKING');
      assert.equal(timer.snapshot().workIndex, index);
      advance(30 * minute);
      assert.equal(timer.snapshot().phase, index === 4 ? 'LONG_VISIT' : 'SHORT_VISIT');
      assert.equal(timer.snapshot().remainingMs, (index === 4 ? 15 : 5) * minute);
      advance((index === 4 ? 15 : 5) * minute);
    }
    assert.equal(timer.snapshot().workIndex, 1);
  }
});

test('every=1 produces a long visit after the first work interval', () => {
  const { timer, advance } = fixture({ longEvery: 1 }); timer.start(); advance(30 * minute);
  assert.equal(timer.snapshot().phase, 'LONG_VISIT');
  advance(15 * minute); assert.equal(timer.snapshot().workIndex, 1);
});

test('warns once within work; zero disables it and equal duration warns at start', () => {
  const { timer, at, warnings } = fixture(); timer.start();
  at(25 * minute - 1); assert.equal(warnings.length, 0);
  at(25 * minute); assert.equal(timer.snapshot().phase, 'WARNING');
  at(29 * minute); timer.tick(); timer.pause(); timer.resume();
  assert.equal(warnings.length, 1);
  at(30 * minute); assert.equal(timer.snapshot().phase, 'SHORT_VISIT');
  for (const warningMinutes of [0, 1]) {
    const f = fixture({ workMinutes: 1, warningMinutes }); f.timer.start();
    assert.equal(f.timer.snapshot().phase, warningMinutes ? 'WARNING' : 'WORKING');
    f.advance(minute); assert.equal(f.timer.snapshot().phase, 'SHORT_VISIT');
    assert.equal(f.warnings.length, warningMinutes);
  }
});

test('dismissal advances short visits; dismissing the long visit resets the cycle', () => {
  const { timer } = fixture(); timer.start();
  for (let index = 1; index <= 4; index++) {
    timer.startBreakNow(); const id = timer.snapshot().intervalId;
    assert.equal(timer.snapshot().phase, index === 4 ? 'LONG_VISIT' : 'SHORT_VISIT');
    assert.equal(timer.dismissBreak(id), true);
    const work = timer.snapshot();
    assert.equal(work.workIndex, index === 4 ? 1 : index + 1);
    assert.equal(work.remainingMs, 30 * minute);
    for (const stale of [id, NaN, Infinity, -1]) assert.equal(timer.dismissBreak(stale), false);
    assert.deepEqual(timer.snapshot(), work);
  }
});

for (const kind of ['short', 'long'] as const) {
  test(`one snooze returns the same ${kind} visit with full original duration and a fresh token`, () => {
    const { timer, advance, warnings } = fixture({ longEvery: kind === 'long' ? 1 : 4 });
    timer.start(); timer.startBreakNow(); advance(1234);
    const original = timer.snapshot();
    assert.equal(timer.snooze(original.intervalId), true);
    const sleeping = timer.snapshot();
    assert.equal(sleeping.phase, 'SNOOZED');
    assert.equal(sleeping.remainingMs, SNOOZE_MS);
    assert.equal(sleeping.workIndex, original.workIndex);
    assert.equal(sleeping.visitId, original.visitId);
    assert.equal(timer.snooze(original.intervalId), false);
    assert.equal(timer.dismissBreak(original.intervalId), false);
    timer.startBreakNow(); assert.deepEqual(timer.snapshot(), sleeping);
    timer.configure({ ...DEFAULT_SETTINGS, longEvery: 2, shortMinutes: 2, longMinutes: 3 });
    advance(SNOOZE_MS);
    const returned = timer.snapshot();
    assert.equal(returned.phase, original.phase);
    assert.equal(returned.visitId, original.visitId);
    assert.equal(returned.remainingMs, original.durationMs);
    assert.notEqual(returned.intervalId, original.intervalId);
    assert.equal(returned.snoozeUsed, true);
    assert.equal(timer.dismissBreak(original.intervalId), false);
    assert.equal(timer.snooze(returned.intervalId), false);
    assert.equal(warnings.length, 0);
    assert.equal(timer.dismissBreak(returned.intervalId), true);
    assert.equal(timer.snapshot().workIndex, kind === 'long' ? 1 : 2);
    timer.startBreakNow(); assert.equal(timer.snapshot().snoozeUsed, false);
  });
}

test('manual summon in IDLE is a standalone short visit; repeated summons do not restart it', () => {
  const { timer, advance } = fixture(); timer.startBreakNow(); advance(1234);
  const visit = timer.snapshot();
  assert.equal(visit.workIndex, 0); assert.equal(visit.phase, 'SHORT_VISIT');
  timer.startBreakNow(); assert.deepEqual(timer.snapshot(), visit);
  timer.pause(); const paused = timer.snapshot(); timer.startBreakNow();
  assert.deepEqual(timer.snapshot(), paused);
  timer.resume(); advance(5 * minute - 1234);
  assert.equal(timer.snapshot().phase, 'WORKING'); assert.equal(timer.snapshot().workIndex, 1);
});

test('manual summon from warning uses the scheduled visit and cancels the remaining work', () => {
  const { timer, advance } = fixture({ longEvery: 1 }); timer.start(); advance(25 * minute);
  assert.equal(timer.snapshot().phase, 'WARNING'); timer.startBreakNow();
  assert.equal(timer.snapshot().phase, 'LONG_VISIT'); assert.equal(timer.snapshot().remainingMs, 15 * minute);
});

test('a delayed command after visit expiry cannot alter the next work interval', () => {
  const { timer, advance } = fixture(); timer.startBreakNow(); const id = timer.snapshot().intervalId;
  advance(6 * minute, false);
  assert.equal(timer.dismissBreak(id), false); assert.equal(timer.snooze(id), false);
  assert.equal(timer.snapshot().remainingMs, 29 * minute);
});

for (const phase of ['WORKING', 'SHORT_VISIT', 'LONG_VISIT', 'SNOOZED'] as const) {
  test(`pause/resume preserves exact milliseconds in ${phase}`, () => {
    const { timer, advance } = fixture({ longEvery: phase === 'LONG_VISIT' ? 1 : 4 });
    timer.start(); if (phase !== 'WORKING') timer.startBreakNow();
    if (phase === 'SNOOZED') timer.snooze(timer.snapshot().intervalId);
    advance(1234); timer.pause(); const paused = timer.snapshot();
    advance(500 * minute); timer.pause();
    assert.equal(timer.snapshot().remainingMs, paused.remainingMs);
    assert.equal(timer.snapshot().phase, phase);
    timer.resume(); timer.resume(); advance(3456);
    assert.equal(timer.snapshot().remainingMs, paused.remainingMs - 3456);
  });
}

test('restart and stop cancel snooze, clear user pause and start a fresh cycle', () => {
  const { timer, advance } = fixture(); timer.startBreakNow(); const old = timer.snapshot().intervalId;
  timer.snooze(old); advance(minute); timer.pause(); timer.restartWork();
  assert.equal(timer.snapshot().phase, 'WORKING'); assert.equal(timer.snapshot().paused, false);
  assert.equal(timer.snapshot().remainingMs, 30 * minute); assert.equal(timer.snapshot().workIndex, 1);
  assert.equal(timer.dismissBreak(old), false);
  timer.stop(); advance(1000 * minute);
  assert.equal(timer.snapshot().phase, 'IDLE'); assert.equal(timer.snapshot().remainingMs, 0);
  timer.start(); assert.equal(timer.snapshot().remainingMs, 30 * minute);
});

test('durations and warning threshold are pinned for the current interval, not future intervals', () => {
  const { timer, at, warnings } = fixture(); timer.start(); at(20 * minute);
  timer.configure({ ...DEFAULT_SETTINGS, workMinutes: 10, shortMinutes: 2, warningMinutes: 1 });
  assert.equal(timer.snapshot().remainingMs, 10 * minute);
  at(25 * minute); assert.equal(warnings.length, 1);
  at(30 * minute); assert.equal(timer.snapshot().remainingMs, 2 * minute);
  timer.configure({ ...DEFAULT_SETTINGS, workMinutes: 3, shortMinutes: 1, warningMinutes: 0 });
  assert.equal(timer.snapshot().remainingMs, 2 * minute);
  at(32 * minute); assert.equal(timer.snapshot().remainingMs, 3 * minute);
});

test('frequency changes only at the next full cycle, including dismissing a long visit', () => {
  const { timer } = fixture(); timer.start();
  timer.configure({ ...DEFAULT_SETTINGS, longEvery: 2 });
  for (let index = 1; index <= 4; index++) {
    assert.equal(timer.snapshot().cycleLength, 4);
    timer.startBreakNow(); assert.equal(timer.snapshot().phase, index === 4 ? 'LONG_VISIT' : 'SHORT_VISIT');
    timer.dismissBreak(timer.snapshot().intervalId);
  }
  assert.equal(timer.snapshot().cycleLength, 2);
  timer.startBreakNow(); timer.dismissBreak(timer.snapshot().intervalId);
  timer.startBreakNow(); assert.equal(timer.snapshot().phase, 'LONG_VISIT');
});

test('settings saved during pause leave frozen remaining time intact', () => {
  const { timer, advance } = fixture(); timer.start(); advance(minute); timer.pause();
  timer.configure({ ...DEFAULT_SETTINGS, workMinutes: 1, shortMinutes: 1, warningMinutes: 0 });
  advance(100 * minute); timer.resume(); assert.equal(timer.snapshot().remainingMs, 29 * minute);
});

test('late ticks retain overshoot, skip full cycles and publish only the current state', () => {
  const { timer, at, warnings, changes } = fixture(); timer.start(); at(30 * minute + 1234);
  assert.equal(timer.snapshot().phase, 'SHORT_VISIT'); assert.equal(timer.snapshot().remainingMs, 5 * minute - 1234);
  assert.equal(warnings.length, 0);
  at(35 * minute + 4321); assert.equal(timer.snapshot().remainingMs, 30 * minute - 4321);
  changes.length = 0;
  // 4*30 + 3*5 + 15 = 150 minutes per cycle.
  at(150 * minute * 1_000_000 + minute);
  assert.equal(timer.snapshot().phase, 'WORKING'); assert.equal(timer.snapshot().workIndex, 1);
  assert.equal(timer.snapshot().remainingMs, 29 * minute); assert.equal(changes.length, 1);
});

test('delayed ticks match an independent four-work-interval schedule', () => {
  const { timer, at } = fixture({ workMinutes: 7, shortMinutes: 3, longMinutes: 5, warningMinutes: 2 }); timer.start();
  let elapsed = 0;
  for (let i = 1; i <= 150; i++) {
    elapsed += (i * 7927) % (20 * minute); at(elapsed);
    const cyclePosition = elapsed % (42 * minute);
    const index = Math.min(3, Math.floor(cyclePosition / (10 * minute)));
    const position = cyclePosition - index * 10 * minute;
    const end = index === 3 ? 12 : 10;
    const expected = position >= 7 * minute ? (index === 3 ? 'LONG_VISIT' : 'SHORT_VISIT')
      : position >= 5 * minute ? 'WARNING' : 'WORKING';
    assert.equal(timer.snapshot().phase, expected);
    assert.equal(timer.snapshot().workIndex, index + 1);
    assert.equal(timer.snapshot().remainingMs, (position < 7 * minute ? 7 : end) * minute - position);
  }
});

test('fractional timestamps are preserved and backwards clock readings do not add time', () => {
  const { timer, at } = fixture(); timer.start(); at(42_123);
  assert.equal(timer.snapshot().remainingMs, 30 * minute - 42_123);
  at(41_000); assert.equal(timer.snapshot().remainingMs, 30 * minute - 42_123);
});

test('scheduler never duplicates its loop and is released on pause/stop/quit', () => {
  const f = fixture({ ...DEFAULT_SETTINGS, workMinutes: 1, shortMinutes: 1, warningMinutes: 0 });
  const callbacks = new Map<object, () => void>();
  const scheduler: TimerScheduler = {
    every: callback => { const handle = {}; callbacks.set(handle, callback); return handle; },
    cancel: handle => { callbacks.delete(handle as object); },
  };
  const runtime = new TimerRuntime(f.timer, scheduler);
  runtime.start(); runtime.start(); assert.equal(callbacks.size, 0);
  f.timer.start(); f.timer.start(); f.timer.restartWork(); f.timer.startBreakNow();
  assert.equal(callbacks.size, 1);
  f.advance(minute, false); [...callbacks.values()][0]();
  assert.equal(f.timer.snapshot().phase, 'WORKING');
  assert.equal(callbacks.size, 1);
  f.timer.pause(); assert.equal(callbacks.size, 0);
  f.timer.resume(); f.timer.resume(); assert.equal(callbacks.size, 1);
  f.timer.stop(); assert.equal(callbacks.size, 0);
  f.timer.start(); runtime.dispose(); runtime.dispose(); assert.equal(callbacks.size, 0);
  f.timer.restartWork(); assert.equal(callbacks.size, 0);
});

test('view reuses one overlay, retains it on break pause, and hides on dismissal/end/stop', () => {
  const f = fixture({ ...DEFAULT_SETTINGS, workMinutes: 1, shortMinutes: 1, warningMinutes: 0 });
  const calls: string[] = [];
  const unsubscribe = bindTimerView(f.timer, {
    summon: () => calls.push('show'), dismiss: () => calls.push('hide'), setTimerSnapshot: () => {},
  });
  f.timer.start(); f.advance(minute); f.timer.pause(); f.advance(minute); f.timer.resume();
  assert.deepEqual(calls, ['hide', 'show']);
  f.advance(minute); assert.deepEqual(calls, ['hide', 'show', 'hide']);
  f.timer.startBreakNow(); f.timer.dismissBreak(f.timer.snapshot().intervalId);
  f.timer.startBreakNow(); f.timer.stop();
  assert.deepEqual(calls, ['hide', 'show', 'hide', 'show', 'hide', 'show', 'hide']);
  unsubscribe(); f.timer.startBreakNow(); assert.equal(calls.length, 7);
});

test('invalid configuration is rejected without changing timer; snapshots cannot mutate preferences', () => {
  const { timer } = fixture(); timer.start();
  const before = timer.snapshot();
  assert.throws(() => timer.configure({ ...DEFAULT_SETTINGS, workMinutes: 0, shortMinutes: 1, warningMinutes: 0 }));
  const clone = timer.snapshot(); clone.settings.workMinutes = 240;
  assert.deepEqual(timer.snapshot(), before);
});

test('display rounds remaining seconds upwards, with hours when needed', () => {
  assert.equal(formatRemaining(0), '00:00');
  assert.equal(formatRemaining(1), '00:01');
  assert.equal(formatRemaining(59_001), '01:00');
  assert.equal(formatRemaining(42 * minute + 15_000), '42:15');
  assert.equal(formatRemaining(240 * minute), '04:00:00');
});
