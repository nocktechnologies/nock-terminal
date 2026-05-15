import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildUnsavedFilesMessage,
  normalizeUnsavedFiles,
} from '../src/utils/unsavedFiles.mjs';

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
