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

// --- fd-exhaustion regression (kqueue held one fd per watched file) ----------

const FD_DIR = process.platform === 'linux' ? '/proc/self/fd' : '/dev/fd';
const fdCount = () => fs.readdirSync(FD_DIR).length;

function makeTree(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function waitForEvent(watcher, ms = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no changed event emitted')), ms);
    watcher.once('changed', (event) => {
      clearTimeout(timer);
      resolve(event);
    });
  });
}

const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('watching a large tree holds O(1) fds, not one per file', { skip: process.platform === 'win32' }, async () => {
  const dir = makeTree('file-watcher-fd-');
  for (let i = 0; i < 300; i++) {
    fs.writeFileSync(path.join(dir, `f${i}.txt`), 'x');
  }

  const watcher = new FileWatcher(createFileService());
  const before = fdCount();
  try {
    watcher.watch(dir);
    await settle(1500); // let the initial crawl finish
    const held = fdCount() - before;
    assert.ok(held < 50, `watcher held ${held} fds for 300 files`);
  } finally {
    await watcher.stop();
  }
});

test('emits change for an in-place modified file', { skip: process.platform === 'win32' }, async () => {
  const dir = makeTree('file-watcher-change-');
  const target = path.join(dir, 'a.txt');
  fs.writeFileSync(target, 'one');

  const watcher = new FileWatcher(createFileService());
  try {
    watcher.watch(dir);
    await settle(700); // watcher setup + initial crawl
    const pending = waitForEvent(watcher);
    fs.appendFileSync(target, 'two');
    const event = await pending;
    assert.equal(event.type, 'change');
    assert.equal(fs.realpathSync(event.path), fs.realpathSync(target));
  } finally {
    await watcher.stop();
  }
});

test('atomic replace of an existing file emits change, not add (editor saves)', { skip: process.platform === 'win32' }, async () => {
  const dir = makeTree('file-watcher-atomic-');
  const target = path.join(dir, 'a.txt');
  fs.writeFileSync(target, 'one');

  const watcher = new FileWatcher(createFileService());
  try {
    watcher.watch(dir);
    await settle(700);
    const pending = waitForEvent(watcher);
    const tmp = path.join(dir, 'a.txt.tmp');
    fs.writeFileSync(tmp, 'two');
    fs.renameSync(tmp, target); // how editors save: write temp, rename over
    const event = await pending;
    assert.equal(event.type, 'change');
    assert.equal(fs.realpathSync(event.path), fs.realpathSync(target));
  } finally {
    await watcher.stop();
  }
});

test('stays silent for writes inside ignored dirs', { skip: process.platform === 'win32' }, async () => {
  const dir = makeTree('file-watcher-ignored-');
  fs.mkdirSync(path.join(dir, 'node_modules'));
  fs.writeFileSync(path.join(dir, 'node_modules', 'x.js'), 'x');
  fs.writeFileSync(path.join(dir, 'src.txt'), 'one');

  const watcher = new FileWatcher(createFileService());
  const events = [];
  try {
    watcher.watch(dir);
    watcher.on('changed', (event) => events.push(event));
    await settle(700);
    fs.appendFileSync(path.join(dir, 'node_modules', 'x.js'), 'y');
    const pending = waitForEvent(watcher);
    fs.appendFileSync(path.join(dir, 'src.txt'), 'two');
    await pending;
    assert.ok(
      events.every((e) => !e.path.includes('node_modules')),
      `ignored-dir event leaked: ${JSON.stringify(events)}`
    );
  } finally {
    await watcher.stop();
  }
});
