import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { BreakTimer } from '../src/main/timer';
import { bindPowerEvents } from '../src/main/power-events';
import { DEFAULT_SETTINGS, SNOOZE_MS } from '../src/shared/timer-state';

for (const phase of ['work', 'break']) {
  test(`sleep freezes ${phase}, wake resumes exact remaining time once`, () => {
    let now = 0;
    const timer = new BreakTimer({ ...DEFAULT_SETTINGS, workMinutes: 1, shortMinutes: 1, warningMinutes: 0 }, () => now);
    const power = new EventEmitter();
    const cleanup = bindPowerEvents(power, timer);
    if (phase === 'work') timer.start(); else timer.startBreakNow();
    now = 12_345; power.emit('suspend'); power.emit('suspend');
    const frozen = timer.snapshot();
    now += 24 * 60 * 60_000; timer.tick();
    assert.equal(timer.snapshot().remainingMs, 47_655);
    power.emit('resume'); power.emit('resume');
    assert.equal(timer.snapshot().phase, frozen.phase);
    assert.equal(timer.snapshot().remainingMs, frozen.remainingMs);
    now += 1000; timer.tick(); assert.equal(timer.snapshot().remainingMs, 46_655);
    cleanup(); assert.equal(power.listenerCount('suspend'), 0);
    assert.equal(power.listenerCount('unlock-screen'), 0);
  });
}
for (const order of [['resume', 'unlock-screen'], ['unlock-screen', 'resume']]) {
  test(`overlapping sleep/lock wait for both events (${order.join(', ')})`, () => {
    let now = 0;
    const timer = new BreakTimer(undefined, () => now);
    const power = new EventEmitter(); bindPowerEvents(power, timer);
    timer.start(); now = 1234; power.emit('lock-screen');
    now += 1000; power.emit('suspend'); now += 1_000_000;
    power.emit(order[0]); now += 40_000; timer.tick();
    assert.equal(timer.snapshot().remainingMs, 1_800_000 - 1234);
    assert.equal(timer.snapshot().paused, true);
    power.emit(order[1]); assert.equal(timer.snapshot().paused, false);
    now += 1000; timer.tick(); assert.equal(timer.snapshot().remainingMs, 1_800_000 - 2234);
  });
}
test('wake/unlock never cancels a manual user pause', () => {
  let now = 0;
  const timer = new BreakTimer(undefined, () => now);
  const power = new EventEmitter(); bindPowerEvents(power, timer);
  timer.startBreakNow(); now = 123; timer.pause();
  power.emit('lock-screen'); power.emit('suspend'); now += 99_000_000;
  power.emit('resume'); power.emit('unlock-screen');
  assert.equal(timer.snapshot().paused, true);
  assert.deepEqual(timer.snapshot().pauseReasons, ['user']);
  assert.equal(timer.snapshot().remainingMs, 300_000 - 123);
  timer.resume(); assert.equal(timer.snapshot().paused, false);
});
test('starting while already locked freezes until unlock; system pause survives restart/stop', () => {
  let now = 0;
  const timer = new BreakTimer(undefined, () => now);
  const power = Object.assign(new EventEmitter(), { getSystemIdleState: () => 'locked' });
  bindPowerEvents(power, timer);
  timer.start(); now += 99_000_000; timer.tick();
  assert.equal(timer.snapshot().remainingMs, 1_800_000);
  timer.stop(); timer.startBreakNow();
  assert.equal(timer.snapshot().paused, true);
  power.emit('unlock-screen'); assert.equal(timer.snapshot().paused, false);
});
test('a warning threshold reached at suspend is delivered once on resume', () => {
  let now = 0, count = 0;
  const timer = new BreakTimer(undefined, () => now);
  const power = new EventEmitter(); bindPowerEvents(power, timer);
  timer.onWarning(() => count++); timer.start();
  now = 25 * 60_000; power.emit('suspend');
  assert.equal(count, 0); now += 999_000; power.emit('resume');
  assert.equal(count, 1); timer.tick(); assert.equal(count, 1);
});

test('snooze uses the same sleep and lock freezing mechanism', () => {
  let now = 0;
  const timer = new BreakTimer(undefined, () => now);
  const power = new EventEmitter(); const cleanup = bindPowerEvents(power, timer);
  timer.startBreakNow(); const visitId = timer.snapshot().visitId;
  timer.snooze(timer.snapshot().intervalId); now = 1234; power.emit('lock-screen'); power.emit('suspend');
  now += 86_400_000; power.emit('resume'); timer.tick();
  assert.equal(timer.snapshot().phase, 'SNOOZED'); assert.equal(timer.snapshot().remainingMs, SNOOZE_MS - 1234);
  power.emit('unlock-screen'); now += SNOOZE_MS - 1234; timer.tick();
  assert.equal(timer.snapshot().phase, 'SHORT_VISIT'); assert.equal(timer.snapshot().visitId, visitId);
  assert.equal(timer.snapshot().remainingMs, 5 * 60_000); cleanup();
});
