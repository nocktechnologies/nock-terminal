import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeFilePathForCompare,
  shouldRefreshOpenFile,
  updateSavedFileContent,
} from '../src/utils/editorFileState.mjs';

test('normalizeFilePathForCompare normalizes separators for watcher comparisons', () => {
  assert.equal(normalizeFilePathForCompare('C:\\repo\\src\\App.jsx'), 'C:/repo/src/App.jsx');
});

test('shouldRefreshOpenFile only refreshes matching changed files that are not modified', () => {
  const filePath = '/repo/src/App.jsx';

  assert.equal(
    shouldRefreshOpenFile(filePath, { type: 'change', path: '/repo/src/App.jsx' }, { modified: false }),
    true
  );
  assert.equal(
    shouldRefreshOpenFile(filePath, { type: 'add', path: '/repo/src/App.jsx' }, { modified: false }),
    false
  );
  assert.equal(
    shouldRefreshOpenFile(filePath, { type: 'change', path: '/repo/src/App.jsx' }, { modified: true }),
    false
  );
  assert.equal(
    shouldRefreshOpenFile(filePath, { type: 'change', path: '/repo/src/Other.jsx' }, { modified: false }),
    false
  );
});

test('updateSavedFileContent replaces stale cached content after a save', () => {
  const next = updateSavedFileContent(
    {
      '/repo/a.txt': { content: 'old', size: 3, readOnly: false },
      '/repo/b.txt': { content: 'keep', size: 4, readOnly: false },
    },
    '/repo/a.txt',
    'fresh'
  );

  assert.deepEqual(next['/repo/a.txt'], {
    content: 'fresh',
    size: 5,
    readOnly: false,
    truncated: false,
  });
  assert.equal(next['/repo/b.txt'].content, 'keep');
});
