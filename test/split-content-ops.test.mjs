import test from 'node:test';
import assert from 'node:assert/strict';

import {
  closeEditorFileInTab,
  openFileInEditorSplit,
} from '../src/utils/splitContentOps.mjs';

test('openFileInEditorSplit creates an editor split for a tab without one', () => {
  const tab = { id: 't1', splitContent: null };
  const next = openFileInEditorSplit(tab, '/a.txt');

  assert.deepEqual(next.splitContent, {
    type: 'editor',
    files: ['/a.txt'],
    activeFile: '/a.txt',
  });
});

test('openFileInEditorSplit appends new files and focuses already-open files', () => {
  const tab = {
    id: 't1',
    splitContent: { type: 'editor', files: ['/a.txt'], activeFile: '/a.txt', unsavedFiles: ['/a.txt'] },
  };

  const appended = openFileInEditorSplit(tab, '/b.txt');
  assert.deepEqual(appended.splitContent.files, ['/a.txt', '/b.txt']);
  assert.equal(appended.splitContent.activeFile, '/b.txt');
  assert.deepEqual(appended.splitContent.unsavedFiles, ['/a.txt']);

  const refocused = openFileInEditorSplit(appended, '/a.txt');
  assert.deepEqual(refocused.splitContent.files, ['/a.txt', '/b.txt']);
  assert.equal(refocused.splitContent.activeFile, '/a.txt');
});

test('closeEditorFileInTab keeps remaining files and picks the last as active', () => {
  const tab = {
    id: 't1',
    splitContent: {
      type: 'editor',
      files: ['/a.txt', '/b.txt', '/c.txt'],
      activeFile: '/b.txt',
      unsavedFiles: ['/b.txt', '/c.txt'],
    },
  };

  const next = closeEditorFileInTab(tab, '/b.txt');
  assert.deepEqual(next.splitContent.files, ['/a.txt', '/c.txt']);
  assert.equal(next.splitContent.activeFile, '/c.txt');
  assert.deepEqual(next.splitContent.unsavedFiles, ['/c.txt']);

  const keepActive = closeEditorFileInTab(tab, '/a.txt');
  assert.equal(keepActive.splitContent.activeFile, '/b.txt');
});

test('closeEditorFileInTab clears the split when the last file closes', () => {
  const tab = {
    id: 't1',
    splitContent: { type: 'editor', files: ['/a.txt'], activeFile: '/a.txt' },
  };
  assert.equal(closeEditorFileInTab(tab, '/a.txt').splitContent, null);
});

test('closeEditorFileInTab leaves non-editor tabs untouched', () => {
  const terminalTab = { id: 't1', splitContent: { type: 'terminal', id: 's1' } };
  assert.equal(closeEditorFileInTab(terminalTab, '/a.txt'), terminalTab);
});
