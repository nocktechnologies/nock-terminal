import test from 'node:test';
import assert from 'node:assert/strict';

import { debounce } from '../src/utils/debounce.mjs';

test('coalesces a burst of calls into a single trailing invocation', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const fn = debounce(() => { calls += 1; }, 250);

  fn();
  fn();
  fn();
  assert.equal(calls, 0, 'nothing fires before the wait elapses');

  t.mock.timers.tick(249);
  assert.equal(calls, 0, 'still pending just before the deadline');

  t.mock.timers.tick(1);
  assert.equal(calls, 1, 'a single invocation after the burst settles');
});

test('passes through the arguments of the last call', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const seen = [];
  const fn = debounce((x) => seen.push(x), 100);

  fn('a');
  fn('b');
  fn('c');
  t.mock.timers.tick(100);

  assert.deepEqual(seen, ['c']);
});

test('a call after the previous one settled fires again', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const fn = debounce(() => { calls += 1; }, 100);

  fn();
  t.mock.timers.tick(100);
  fn();
  t.mock.timers.tick(100);

  assert.equal(calls, 2);
});

test('cancel() drops a pending invocation', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const fn = debounce(() => { calls += 1; }, 100);

  fn();
  fn.cancel();
  t.mock.timers.tick(100);

  assert.equal(calls, 0);
});
