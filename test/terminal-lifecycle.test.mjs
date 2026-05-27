import test from 'node:test';
import assert from 'node:assert/strict';

import {
  collectLiveTerminalIds,
  summarizeReapedTerminals,
} from '../src/utils/terminalLifecycle.mjs';

test('collectLiveTerminalIds returns primary and split terminal ids', () => {
  const ids = collectLiveTerminalIds([
    { id: 'tab-1', splitContent: { type: 'terminal', id: 'split-1' } },
    { id: 'tab-2', splitContent: { type: 'editor', id: 'editor-1' } },
    { id: 'tab-1', splitContent: { type: 'terminal', id: 'split-1' } },
  ]);

  assert.deepEqual(ids, ['tab-1', 'split-1', 'tab-2']);
});

test('collectLiveTerminalIds ignores invalid tab shapes', () => {
  assert.deepEqual(collectLiveTerminalIds(null), []);
  assert.deepEqual(collectLiveTerminalIds([
    null,
    { id: '' },
    { id: 'tab-1', splitContent: { type: 'terminal', id: '' } },
  ]), ['tab-1']);
});

test('summarizeReapedTerminals formats cleanup results', () => {
  assert.equal(summarizeReapedTerminals([]), 'All running terminals are still attached.');
  assert.equal(summarizeReapedTerminals([{ id: 'tab-1' }]), 'Cleaned 1 stale terminal session.');
  assert.equal(
    summarizeReapedTerminals([{ id: 'tab-1' }, { id: 'tab-2' }]),
    'Cleaned 2 stale terminal sessions.'
  );
});
