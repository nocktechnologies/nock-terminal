const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const EventEmitter = require('node:events');

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
    'node_modules/react/index.js',
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

test('watch() refuses roots that fail the project-watch guard', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-watcher-test-'));
  const originalWarn = console.warn;
  const watcher = new FileWatcher({
    isAllowedPath: () => true,
    isWatchableRoot: () => false,
    gitStatus: () => {
      throw new Error('git status should not run for refused roots');
    },
  });

  try {
    console.warn = () => {};
    const started = watcher.watch(dir);

    assert.equal(started, false);
    assert.equal(watcher.watcher, null);
    assert.equal(watcher.currentRoot, null);
  } finally {
    console.warn = originalWarn;
    await watcher.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('watch() stops after resource-limit watcher errors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-watcher-test-'));
  const originalError = console.error;
  const fakeWatcher = new EventEmitter();
  let closed = false;
  fakeWatcher.close = async () => {
    closed = true;
  };

  const watcher = new FileWatcher(createFileService(), {
    watch: () => fakeWatcher,
  });

  try {
    console.error = () => {};
    const started = watcher.watch(dir);
    fakeWatcher.emit('error', Object.assign(new Error('EMFILE: too many open files, watch'), { code: 'EMFILE' }));

    assert.equal(started, true);
    assert.equal(closed, true);
    assert.equal(watcher.watcher, null);
    assert.equal(watcher.currentRoot, null);
  } finally {
    console.error = originalError;
    await watcher.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
