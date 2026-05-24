const test = require('node:test');
const assert = require('node:assert/strict');

const FileWatcher = require('../electron/file-watcher');

function createFileService() {
  return {
    isAllowedPath: () => true,
    gitStatus: () => ({}),
  };
}

test('file watcher emits change events for modified files', () => {
  const watcher = new FileWatcher(createFileService());
  const events = [];

  watcher.currentRoot = '/repo';
  watcher.on('changed', event => events.push(event));

  watcher._emitChanged('change', '/repo/src/App.jsx');

  assert.deepEqual(events, [{ type: 'change', path: '/repo/src/App.jsx' }]);
});
