import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildUnsavedFilesMessage,
  collectUnsavedFiles,
  normalizeUnsavedFiles,
} from '../src/utils/unsavedFiles.mjs';

test('collectUnsavedFiles dedupes unsaved files across all tabs', () => {
  const tabs = [
    { id: 'a', splitContent: { unsavedFiles: ['src/App.jsx', 'a.txt'] } },
    { id: 'b', splitContent: { unsavedFiles: ['a.txt', 'b.txt'] } },
    { id: 'c' }, // no splitContent
    { id: 'd', splitContent: {} }, // no unsavedFiles
  ];
  assert.deepEqual(collectUnsavedFiles(tabs), ['src/App.jsx', 'a.txt', 'b.txt']);
});

test('collectUnsavedFiles returns [] for empty or invalid input', () => {
  assert.deepEqual(collectUnsavedFiles([]), []);
  assert.deepEqual(collectUnsavedFiles(null), []);
  assert.deepEqual(collectUnsavedFiles([{ id: 'x' }]), []);
});

test('normalizeUnsavedFiles removes invalid and duplicate entries', () => {
  assert.deepEqual(
    normalizeUnsavedFiles(['src/App.jsx', '', null, 'src/App.jsx', 'README.md']),
    ['src/App.jsx', 'README.md']
  );
});

test('buildUnsavedFilesMessage summarizes single and multiple files', () => {
  assert.equal(
    buildUnsavedFilesMessage(['src/App.jsx']),
    'Discard unsaved changes to App.jsx?'
  );

  assert.equal(
    buildUnsavedFilesMessage(['src/App.jsx', 'README.md', 'docs/ROADMAP.md']),
    'Discard unsaved changes to 3 files? App.jsx, README.md, ROADMAP.md'
  );
});
