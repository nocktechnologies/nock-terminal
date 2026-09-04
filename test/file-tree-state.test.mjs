import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeTreeEntries, replaceTreeNodeChildren } from '../src/utils/fileTreeState.mjs';

test('normalizeTreeEntries marks directories as not yet loaded for lazy expansion', () => {
  const entries = normalizeTreeEntries([
    { name: 'docs', type: 'dir', path: '/repo/docs', children: [] },
    { name: 'README.md', type: 'file', path: '/repo/README.md' },
  ]);

  assert.deepEqual(entries, [
    { name: 'docs', type: 'dir', path: '/repo/docs', children: [], childrenLoaded: false, loadingChildren: false },
    { name: 'README.md', type: 'file', path: '/repo/README.md' },
  ]);
});

test('replaceTreeNodeChildren installs loaded children without touching siblings', () => {
  const tree = normalizeTreeEntries([
    { name: 'docs', type: 'dir', path: '/repo/docs', children: [] },
    { name: 'src', type: 'dir', path: '/repo/src', children: [] },
  ]);

  const next = replaceTreeNodeChildren(tree, '/repo/docs', [
    { name: 'README.md', type: 'file', path: '/repo/docs/README.md' },
  ]);

  assert.deepEqual(next[0], {
    name: 'docs',
    type: 'dir',
    path: '/repo/docs',
    childrenLoaded: true,
    loadingChildren: false,
    children: [{ name: 'README.md', type: 'file', path: '/repo/docs/README.md' }],
  });
  assert.equal(next[1].childrenLoaded, false);
});
