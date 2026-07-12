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

test('_pollGitStatus stops polling when the project root has been deleted', async () => {
  let gitStatusCalls = 0;
  const watcher = new FileWatcher({
    isAllowedPath: () => true, // still "allowed" (a configured devRoot), just gone from disk
    gitStatus: async () => { gitStatusCalls += 1; return {}; },
  });
  watcher.currentRoot = path.join(os.tmpdir(), 'nock-terminal-does-not-exist-' + process.pid);
  watcher.gitPollInterval = setInterval(() => {}, 1_000_000);

  await watcher._pollGitStatus();

  assert.equal(gitStatusCalls, 0, 'should not run git on a deleted root');
  assert.equal(watcher.currentRoot, null, 'watcher stops when the root is gone');
  assert.equal(watcher.gitPollInterval, null, 'poll interval cleared');
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

// --- silent fs.watch fallback (fseventsd can wedge and deliver zero events) --

function deadFsWatch() {
  return { close() {}, on() {} };
}

test('falls back to polling when fs.watch never delivers events', { skip: process.platform === 'win32' }, async () => {
  const dir = makeTree('file-watcher-fallback-');
  const target = path.join(dir, 'a.txt');
  fs.writeFileSync(target, 'one');

  const realWatch = fs.watch;
  fs.watch = deadFsWatch;
  const watcher = new FileWatcher(createFileService(), { verifyTimeoutMs: 250, pollIntervalMs: 150 });
  try {
    watcher.watch(dir);
    await settle(50);
    const pending = waitForEvent(watcher);
    fs.appendFileSync(target, 'two');
    const event = await pending;
    assert.equal(watcher.mode, 'poll', 'watcher should have detected the dead fs.watch');
    assert.equal(event.type, 'change');
    assert.equal(fs.realpathSync(event.path), fs.realpathSync(target));
    const leftovers = fs.readdirSync(dir).filter((n) => n.startsWith(FileWatcher.PROBE_PREFIX));
    assert.deepEqual(leftovers, [], 'probe file should be cleaned up');
  } finally {
    fs.watch = realWatch;
    await watcher.stop();
  }
});

test('keeps the native watcher when the probe event arrives', async () => {
  const dir = makeTree('file-watcher-probe-ok-');

  const realWatch = fs.watch;
  let rawListener = null;
  fs.watch = (root, opts, cb) => {
    rawListener = cb;
    return deadFsWatch();
  };
  const watcher = new FileWatcher(createFileService(), { verifyTimeoutMs: 250, pollIntervalMs: 150 });
  try {
    watcher.watch(dir);
    assert.equal(typeof rawListener, 'function');
    rawListener('rename', FileWatcher.PROBE_PREFIX + 'x');
    await settle(500); // past the verification window
    assert.equal(watcher.mode, 'native', 'probe event seen, no fallback expected');
    const leftovers = fs.readdirSync(dir).filter((n) => n.startsWith(FileWatcher.PROBE_PREFIX));
    assert.deepEqual(leftovers, [], 'probe file should be cleaned up');
  } finally {
    fs.watch = realWatch;
    await watcher.stop();
  }
});

test('forced polling emits change then unlink for a modified and deleted file', { skip: process.platform === 'win32' }, async () => {
  const dir = makeTree('file-watcher-poll-');
  const target = path.join(dir, 'a.txt');
  fs.writeFileSync(target, 'one');

  const watcher = new FileWatcher(createFileService(), { forcePolling: true, pollIntervalMs: 150 });
  try {
    watcher.watch(dir);
    assert.equal(watcher.mode, 'poll');
    await settle(50);

    const pendingChange = waitForEvent(watcher);
    fs.appendFileSync(target, 'two');
    const changeEvent = await pendingChange;
    assert.equal(changeEvent.type, 'change');
    assert.equal(fs.realpathSync(changeEvent.path), fs.realpathSync(target));

    const pendingUnlink = waitForEvent(watcher);
    fs.rmSync(target);
    const unlinkEvent = await pendingUnlink;
    assert.equal(unlinkEvent.type, 'unlink');
  } finally {
    await watcher.stop();
  }
});

test('forced polling stays silent for ignored dirs and holds O(1) fds', { skip: process.platform === 'win32' }, async () => {
  const dir = makeTree('file-watcher-poll-ignored-');
  fs.mkdirSync(path.join(dir, 'node_modules'));
  fs.writeFileSync(path.join(dir, 'node_modules', 'x.js'), 'x');
  for (let i = 0; i < 300; i++) {
    fs.writeFileSync(path.join(dir, `f${i}.txt`), 'x');
  }
  fs.writeFileSync(path.join(dir, 'src.txt'), 'one');

  const watcher = new FileWatcher(createFileService(), { forcePolling: true, pollIntervalMs: 150 });
  const events = [];
  const before = fdCount();
  try {
    watcher.watch(dir);
    watcher.on('changed', (event) => events.push(event));
    await settle(500); // several poll ticks over the 300-file tree
    const held = fdCount() - before;
    assert.ok(held < 50, `polling watcher held ${held} fds for 300 files`);

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
