const test = require('node:test');
const assert = require('node:assert/strict');

const { decideRendererRecovery, RECOVERY_DEFAULTS } = require('../electron/renderer-recovery');

test('a clean renderer exit is ignored (normal teardown, not a crash)', () => {
  const decision = decideRendererRecovery({
    reason: 'clean-exit',
    crashTimestamps: [],
    now: 1000,
  });
  assert.equal(decision.action, 'ignore');
  // A clean exit must not be recorded as a crash.
  assert.deepEqual(decision.crashTimestamps, []);
});

test('a first crash triggers a reload and records the timestamp', () => {
  const decision = decideRendererRecovery({
    reason: 'crashed',
    crashTimestamps: [],
    now: 5000,
  });
  assert.equal(decision.action, 'reload');
  assert.equal(decision.attempt, 1);
  assert.deepEqual(decision.crashTimestamps, [5000]);
});

test('repeated crashes within the window eventually give up instead of looping', () => {
  let state = [];
  const now0 = 10_000;
  const reasons = [];
  // maxCrashes defaults to 3: crashes 1-3 reload, the 4th gives up.
  for (let i = 0; i < 4; i++) {
    const d = decideRendererRecovery({
      reason: 'crashed',
      crashTimestamps: state,
      now: now0 + i * 1000,
    });
    state = d.crashTimestamps;
    reasons.push(d.action);
  }
  assert.deepEqual(reasons, ['reload', 'reload', 'reload', 'giveup']);
});

test('crashes outside the rolling window do not count toward the cap', () => {
  const windowMs = RECOVERY_DEFAULTS.windowMs;
  // Three old crashes, all older than the window relative to `now`.
  const old = [1000, 2000, 3000];
  const decision = decideRendererRecovery({
    reason: 'crashed',
    crashTimestamps: old,
    now: 3000 + windowMs + 1,
  });
  // Stale timestamps are dropped, so this reads as the first fresh crash.
  assert.equal(decision.action, 'reload');
  assert.equal(decision.attempt, 1);
  assert.deepEqual(decision.crashTimestamps, [3000 + windowMs + 1]);
});

test('an unknown/undefined reason is treated as a recoverable crash', () => {
  const decision = decideRendererRecovery({
    reason: undefined,
    crashTimestamps: [],
    now: 42,
  });
  assert.equal(decision.action, 'reload');
});

test('caller-supplied thresholds override the defaults', () => {
  const first = decideRendererRecovery({
    reason: 'oom',
    crashTimestamps: [],
    now: 0,
    maxCrashes: 1,
    windowMs: 1000,
  });
  assert.equal(first.action, 'reload');
  const second = decideRendererRecovery({
    reason: 'oom',
    crashTimestamps: first.crashTimestamps,
    now: 500,
    maxCrashes: 1,
    windowMs: 1000,
  });
  assert.equal(second.action, 'giveup');
});
