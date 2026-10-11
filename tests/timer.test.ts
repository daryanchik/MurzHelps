import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BreakTimer } from '../src/main/timer';
import { TimerRuntime, type TimerScheduler } from '../src/main/timer-runtime';
import { bindTimerView } from '../src/main/timer-view';
import { DEFAULT_SETTINGS, formatRemaining, type TimerSettings, type TimerSnapshot } from '../src/shared/timer-state';

const minute = 60_000;
function fixture(settings: TimerSettings = { ...DEFAULT_SETTINGS }) {
  let now = 0;
  const timer = new BreakTimer(settings, () => now);
  const warnings: TimerSnapshot[] = [], changes: TimerSnapshot[] = [];
  timer.onWarning(snapshot => warnings.push(snapshot));
  timer.subscribe(snapshot => changes.push(snapshot));
  return { timer, warnings, changes,
    advance: (ms: number, tick = true) => { now += ms; if (tick) timer.tick(); },
    at: (ms: number) => { now = ms; timer.tick(); },
  };
}

test('launches IDLE; Start begins one full work interval and is idempotent', () => {
  const { timer } = fixture();
  assert.equal(timer.snapshot().phase, 'IDLE');
  timer.start();
  const initial = timer.snapshot();
  assert.equal(initial.phase, 'WORKING');
  assert.equal(initial.remainingMs, 60 * minute);
  timer.start();
  assert.deepEqual(timer.snapshot(), initial);
});

test('remaining time comes from elapsed timestamps, including fractional ticks', () => {
  const { timer, advance } = fixture();
  timer.start();
  advance(42_123);
  assert.equal(timer.snapshot().remainingMs, 60 * minute - 42_123);
  advance(81_111);
  assert.equal(timer.snapshot().remainingMs, 60 * minute - 123_234);
});

test('warns exactly once at minute 55, inside the 60 minute work interval', () => {
  const { timer, at, warnings } = fixture();
  timer.start();
  at(55 * minute - 1);
  assert.equal(warnings.length, 0);
  at(55 * minute);
  assert.equal(timer.snapshot().phase, 'WARNING');
  assert.equal(warnings.length, 1);
  at(59 * minute); timer.tick(); timer.pause(); timer.resume();
  assert.equal(warnings.length, 1);
  at(60 * minute);
  assert.equal(timer.snapshot().phase, 'BREAK');
  assert.equal(timer.snapshot().remainingMs, 45 * minute);
});

test('automatically completes break, starts next work and warns once in each cycle', () => {
  const { timer, at, warnings } = fixture();
  timer.start(); at(55 * minute); at(60 * minute);
  const breakId = timer.snapshot().intervalId;
  at(105 * minute);
  assert.equal(timer.snapshot().phase, 'WORKING');
  assert.equal(timer.snapshot().remainingMs, 60 * minute);
  assert.equal(timer.snapshot().intervalId, breakId + 1);
  at(160 * minute);
  assert.equal(warnings.length, 2);
});

test('warning 0 is disabled; warning equal to work starts immediately', () => {
  for (const warningMinutes of [0, 1]) {
    const f = fixture({ workMinutes: 1, breakMinutes: 1, warningMinutes });
    f.timer.start();
    assert.equal(f.timer.snapshot().phase, warningMinutes ? 'WARNING' : 'WORKING');
    f.advance(minute);
    assert.equal(f.timer.snapshot().phase, 'BREAK');
    assert.equal(f.warnings.length, warningMinutes);
  }
});

test('dismissal starts full work immediately; double clicks and stale break ids are ignored', () => {
  const { timer, advance } = fixture();
  timer.startBreakNow(); advance(minute);
  const id = timer.snapshot().intervalId;
  assert.equal(timer.dismissBreak(id), true);
  assert.equal(timer.snapshot().remainingMs, 60 * minute);
  const work = timer.snapshot();
  assert.equal(timer.dismissBreak(id), false);
  assert.deepEqual(timer.snapshot(), work);
  timer.startBreakNow();
  assert.equal(timer.dismissBreak(id), false);
  assert.equal(timer.snapshot().phase, 'BREAK');
  assert.equal(timer.dismissBreak(NaN), false);
});

test('a dismissal received after the old break expired does not restart live work', () => {
  const { timer, advance } = fixture();
  timer.startBreakNow();
  const id = timer.snapshot().intervalId;
  advance(46 * minute, false);
  assert.equal(timer.dismissBreak(id), false);
  assert.equal(timer.snapshot().remainingMs, 59 * minute);
});

for (const phase of ['WORKING', 'BREAK'] as const) {
  test(`pause/resume preserves exact milliseconds in ${phase}`, () => {
    const { timer, advance } = fixture();
    if (phase === 'BREAK') timer.startBreakNow(); else timer.start();
    advance(1234); timer.pause();
    const paused = timer.snapshot();
    advance(500 * minute); timer.pause();
    assert.equal(timer.snapshot().remainingMs, paused.remainingMs);
    assert.equal(timer.snapshot().phase, phase);
    timer.resume(); timer.resume(); advance(3456);
    assert.equal(timer.snapshot().remainingMs, paused.remainingMs - 3456);
  });
}

test('restart clears user pause, hides break logically and starts full work', () => {
  const { timer, advance } = fixture();
  timer.startBreakNow(); advance(minute); timer.pause(); timer.restartWork();
  assert.equal(timer.snapshot().phase, 'WORKING');
  assert.equal(timer.snapshot().paused, false);
  assert.equal(timer.snapshot().remainingMs, 60 * minute);
});

test('manual break from idle, working, warning or paused break has full duration', () => {
  const { timer, advance } = fixture();
  timer.startBreakNow();
  assert.equal(timer.snapshot().phase, 'BREAK');
  assert.equal(timer.snapshot().remainingMs, 45 * minute);
  timer.restartWork(); advance(55 * minute); timer.startBreakNow();
  advance(12_345); timer.pause(); timer.startBreakNow();
  assert.equal(timer.snapshot().remainingMs, 45 * minute);
  assert.equal(timer.snapshot().paused, false);
});

test('Stop cancels a session and later Start begins from scratch', () => {
  const { timer, advance } = fixture();
  timer.startBreakNow(); timer.pause(); timer.stop(); advance(1000 * minute);
  assert.equal(timer.snapshot().phase, 'IDLE');
  assert.equal(timer.snapshot().remainingMs, 0);
  assert.equal(timer.snapshot().paused, false);
  timer.start();
  assert.equal(timer.snapshot().remainingMs, 60 * minute);
});

test('new settings leave active work and warning threshold intact; next break uses new settings', () => {
  const { timer, at, warnings } = fixture();
  timer.start(); at(20 * minute);
  timer.configure({ workMinutes: 10, breakMinutes: 2, warningMinutes: 1 });
  assert.equal(timer.snapshot().remainingMs, 40 * minute);
  at(55 * minute);
  assert.equal(warnings.length, 1);
  at(60 * minute);
  assert.equal(timer.snapshot().remainingMs, 2 * minute);
  timer.configure({ workMinutes: 3, breakMinutes: 1, warningMinutes: 0 });
  assert.equal(timer.snapshot().remainingMs, 2 * minute);
  at(62 * minute);
  assert.equal(timer.snapshot().remainingMs, 3 * minute);
  assert.equal(timer.snapshot().phase, 'WORKING');
});

test('settings saved during pause do not mutate the frozen interval', () => {
  const { timer, advance } = fixture();
  timer.start(); advance(minute); timer.pause();
  timer.configure({ workMinutes: 1, breakMinutes: 1, warningMinutes: 0 });
  advance(100 * minute); timer.resume();
  assert.equal(timer.snapshot().remainingMs, 59 * minute);
});

test('late ticks retain overshoot, publish only current state and never replay expired warnings', () => {
  const { timer, at, warnings, changes } = fixture();
  timer.start(); at(60 * minute + 1234);
  assert.equal(timer.snapshot().phase, 'BREAK');
  assert.equal(timer.snapshot().remainingMs, 45 * minute - 1234);
  assert.equal(warnings.length, 0);
  at(105 * minute + 4321);
  assert.equal(timer.snapshot().phase, 'WORKING');
  assert.equal(timer.snapshot().remainingMs, 60 * minute - 4321);
  changes.length = 0;
  at(105 * minute * 1_000_000 + minute);
  assert.equal(timer.snapshot().remainingMs, 59 * minute);
  assert.equal(timer.snapshot().phase, 'WORKING');
  assert.equal(changes.length, 1);
});

test('many delayed updates match a reference schedule over multiple cycles', () => {
  const { timer, at } = fixture({ workMinutes: 7, breakMinutes: 3, warningMinutes: 2 });
  timer.start();
  let elapsed = 0;
  for (let i = 1; i <= 150; i++) {
    elapsed += (i * 7927) % (20 * minute);
    at(elapsed);
    const position = elapsed % (10 * minute);
    const expected = position >= 7 * minute ? 'BREAK' : position >= 5 * minute ? 'WARNING' : 'WORKING';
    assert.equal(timer.snapshot().phase, expected);
    assert.equal(timer.snapshot().remainingMs, (position < 7 * minute ? 7 : 10) * minute - position);
  }
});

test('scheduler never duplicates its loop and is released on pause/stop/quit', () => {
  const f = fixture({ workMinutes: 1, breakMinutes: 1, warningMinutes: 0 });
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
  const f = fixture({ workMinutes: 1, breakMinutes: 1, warningMinutes: 0 });
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
  assert.throws(() => timer.configure({ workMinutes: 0, breakMinutes: 1, warningMinutes: 0 }));
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
