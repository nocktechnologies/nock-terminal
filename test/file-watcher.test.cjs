const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

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

test('IGNORED_DIRS matches the same paths as the old chokidar 3 globs', () => {
  const ignoredContents = [
    '/repo/node_modules/react/index.js',
    '/repo/packages/app/node_modules/left-pad/index.js',
    '/repo/.git/HEAD',
    '/repo/src/__pycache__/mod.cpython-311.pyc',
    '/repo/dist/bundle.js',
    '/repo/build/output.css',
    '/repo/.next/cache/chunk.js',
    '/repo/.cache/tmp.bin',
    '/repo/coverage/lcov.info',
    'C:\\repo\\node_modules\\react\\index.js',
  ];
  for (const p of ignoredContents) {
    assert.equal(FileWatcher.IGNORED_DIRS.test(p), true, `expected ignored: ${p}`);
  }

  const watchedPaths = [
    '/repo/src/App.jsx',
    '/repo/distribution/notes.md',
    '/repo/builder/main.js',
    '/repo/electron/coverage-report.txt',
    // Directory entries themselves stay visible, matching '**/<dir>/**'.
    '/repo/node_modules',
    '/repo/dist',
  ];
  for (const p of watchedPaths) {
    assert.equal(FileWatcher.IGNORED_DIRS.test(p), false, `expected watched: ${p}`);
  }
});

test('stop() returns a promise that resolves once the watcher is closed', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-watcher-test-'));
  const watcher = new FileWatcher(createFileService());
  try {
    watcher.watch(dir);
    const closed = watcher.stop();
    assert.equal(typeof closed?.then, 'function');
    await closed;
    assert.equal(watcher.watcher, null);
  } finally {
    watcher.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('stop() without an active watcher still returns a promise', async () => {
  const watcher = new FileWatcher(createFileService());
  const closed = watcher.stop();
  assert.equal(typeof closed?.then, 'function');
  await closed;
});
