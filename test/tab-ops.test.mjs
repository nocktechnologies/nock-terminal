import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createTabId,
  nextActiveTabId,
  removeTabById,
  reorderTabList,
} from '../src/utils/tabOps.mjs';

test('createTabId produces unique prefixed ids', () => {
  const first = createTabId();
  const second = createTabId();
  assert.match(first, /^tab-\d+-[a-z0-9]+$/);
  assert.notEqual(first, second);
  assert.match(createTabId('dispatch'), /^dispatch-\d+-[a-z0-9]+$/);
});

test('reorderTabList moves the dragged tab to the target position', () => {
  const tabs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  assert.deepEqual(
    reorderTabList(tabs, 'a', 'c').map(t => t.id),
    ['b', 'c', 'a']
  );
  assert.deepEqual(
    reorderTabList(tabs, 'c', 'a').map(t => t.id),
    ['c', 'a', 'b']
  );
});

test('reorderTabList returns the original list when either id is missing', () => {
  const tabs = [{ id: 'a' }, { id: 'b' }];
  assert.equal(reorderTabList(tabs, 'a', 'missing'), tabs);
  assert.equal(reorderTabList(tabs, 'missing', 'b'), tabs);
});

test('removeTabById filters the tab but refuses to remove pinned tabs', () => {
  const tabs = [{ id: 'a' }, { id: 'b', pinned: true }, { id: 'c' }];

  assert.deepEqual(removeTabById(tabs, 'a').map(t => t.id), ['b', 'c']);
  assert.equal(removeTabById(tabs, 'b'), tabs);
  assert.equal(removeTabById(tabs, 'missing'), tabs);
});

test('nextActiveTabId keeps the current tab unless it was closed', () => {
  const remaining = [{ id: 'a' }, { id: 'b' }];

  assert.equal(nextActiveTabId(remaining, 'c', 'a'), 'a');
  assert.equal(nextActiveTabId(remaining, 'a', 'a'), 'b');
  assert.equal(nextActiveTabId([], 'a', 'a'), null);
});
