import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VisibilityState } from '../src/shared/visibility';

test('startup waits for the image and layout acknowledgment', () => {
  const state = new VisibilityState();
  assert.equal(state.shouldShow, false);
  state.invalidate();
  assert.equal(state.shouldShow, false);
  state.acknowledge(state.revision);
  assert.equal(state.shouldShow, true);
});
test('dismissal survives a late ready message', () => {
  const state = new VisibilityState();
  const revision = state.invalidate();
  state.dismiss();
  state.acknowledge(revision);
  assert.equal(state.shouldShow, false);
});
test('many summon/dismiss cycles retain one explicit visible state', () => {
  const state = new VisibilityState();
  for (let i = 0; i < 50; i++) {
    state.summon();
    state.invalidate();
    state.acknowledge(state.revision);
    assert.equal(state.shouldShow, true);
    state.dismiss();
    assert.equal(state.shouldShow, false);
  }
});
test('display reconfiguration rejects obsolete and malformed ready messages', () => {
  const state = new VisibilityState();
  const old = state.invalidate();
  const current = state.invalidate();
  assert.equal(state.acknowledge(old), false);
  assert.equal(state.acknowledge(NaN), false);
  assert.equal(state.shouldShow, false);
  assert.equal(state.acknowledge(current), true);
  assert.equal(state.shouldShow, true);
});
test('display updates never resurrect a dismissed cat', () => {
  const state = new VisibilityState();
  state.dismiss();
  state.invalidate();
  state.acknowledge(state.revision);
  assert.equal(state.shouldShow, false);
});
