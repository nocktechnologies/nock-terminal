import assert from 'node:assert/strict';
import test from 'node:test';

import { formatTreeMetaNotice } from '../src/utils/fileTreeMeta.mjs';

test('formatTreeMetaNotice hides expected depth-only lazy-loading metadata', () => {
  assert.equal(
    formatTreeMetaNotice({ truncated: true, truncatedByDepth: true, maxDepth: 1 }, 'tree'),
    null
  );
});

test('formatTreeMetaNotice reports entry truncation and load errors', () => {
  assert.equal(
    formatTreeMetaNotice(
      { truncated: true, truncatedByEntries: true, entryCount: 300, maxEntries: 300 },
      'tree'
    ),
    'Partial tree shown (300/300 entries)'
  );

  assert.equal(
    formatTreeMetaNotice({ error: 'Cannot read folder' }, 'folder'),
    'Cannot read folder'
  );
});
