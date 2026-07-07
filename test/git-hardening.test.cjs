// Regression test for Nock #8661 — passive git invocations must NOT execute
// repo-controlled hooks/config on discovered/untrusted repos.
//
// Attack: a cloned repo sets repo-local `core.fsmonitor` to an executable.
// Git treats core.fsmonitor as a hook command and runs it while merely reading
// status. Nock Terminal polls git status passively during dashboard discovery
// and editor git-status polling — BEFORE the user opens a terminal — so an
// untrusted repo would get code execution. The fix hardens every passive
// invocation with `-c core.fsmonitor=false -c core.hooksPath=/dev/null
// --no-optional-locks`.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const FileService = require('../electron/file-service');
const SessionDiscovery = require('../electron/session-discovery');
const { passiveGitArgs, PASSIVE_GIT_HARDENING_ARGS } = require('../electron/security-utils');

// Build a git repo whose repo-local filter.<name>.clean writes a sentinel,
// bound to a tracked file by an in-tree .gitattributes, with a same-size but
// different-bytes worktree copy so `git status` MUST run the clean filter to
// settle modified-state. Returns { repo, sentinel } or null if git is missing.
async function makeFilterTrappedRepo(t) {
  let repo;
  try {
    repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nock-8661-filter-')));
  } catch {
    return null;
  }
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));

  try {
    await execFileAsync('git', ['init', '-q'], { cwd: repo });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: repo });
  } catch {
    return null;
  }

  const sentinel = path.join(repo, 'FILTER_PWNED');

  // Tracked file, committed with its clean (unfiltered) content.
  fs.writeFileSync(path.join(repo, 'data.bin'), 'AAAA');
  await execFileAsync('git', ['add', 'data.bin'], { cwd: repo });
  await execFileAsync('git', ['commit', '-q', '-m', 'init'], { cwd: repo });

  // in-tree .gitattributes binds the poisoned filter to the tracked file.
  fs.writeFileSync(path.join(repo, '.gitattributes'), 'data.bin filter=pwn\n');
  // repo-local clean filter: drops the sentinel, then passes content through.
  await execFileAsync(
    'git',
    ['config', 'filter.pwn.clean', `sh -c 'printf pwned > ${JSON.stringify(sentinel)}; cat'`],
    { cwd: repo },
  );

  // Same-size (4 bytes), different-bytes worktree copy + an old mtime so git
  // cannot settle modified-state by stat alone and must run the clean filter.
  fs.writeFileSync(path.join(repo, 'data.bin'), 'BBBB');
  const old = new Date('2020-01-01T00:00:00Z');
  fs.utimesSync(path.join(repo, 'data.bin'), old, old);

  return { repo, sentinel };
}

// Confirm the filter trap is live in THIS git — an UNHARDENED status runs the
// clean filter and drops the sentinel. Returns true if the trap fired.
async function filterTrapFires(repo, sentinel) {
  fs.rmSync(sentinel, { force: true });
  try {
    await execFileAsync('git', ['status', '--porcelain'], { cwd: repo });
  } catch { /* git may complain; we only care about the side effect */ }
  const fired = fs.existsSync(sentinel);
  fs.rmSync(sentinel, { force: true });
  return fired;
}

function createStore(devRoots) {
  return {
    get(key) {
      if (key === 'devRoots') return devRoots;
      return undefined;
    },
  };
}

// Build a git repo whose repo-local core.fsmonitor points at a script that
// writes a sentinel file. Returns { repo, sentinel } or null if git is missing.
async function makeBoobyTrappedRepo(t) {
  let repo;
  try {
    repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nock-8661-')));
  } catch {
    return null;
  }
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));

  try {
    await execFileAsync('git', ['init', '-q'], { cwd: repo });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: repo });
  } catch {
    return null; // git not available in this environment
  }

  const sentinel = path.join(repo, 'PWNED');
  // The malicious hook program. It writes the sentinel then emits a minimal
  // valid fsmonitor response so git does not error out.
  const hook = path.join(repo, 'evil-fsmonitor.sh');
  fs.writeFileSync(
    hook,
    '#!/bin/sh\n' +
      `printf pwned > ${JSON.stringify(sentinel)}\n` +
      // fsmonitor v2 protocol: print a token line then a trailing NUL.
      'printf "%s\\0" "/"\n',
    { mode: 0o755 },
  );

  // Create an index so `git status` reads it and would query fsmonitor.
  fs.writeFileSync(path.join(repo, 'a.txt'), 'hi');
  await execFileAsync('git', ['add', 'a.txt'], { cwd: repo });

  // The repo-controlled poison: repo-LOCAL config, exactly what a clone can ship.
  await execFileAsync('git', ['config', 'core.fsmonitor', hook], { cwd: repo });

  return { repo, sentinel };
}

test('passiveGitArgs prepends the hardening flags', () => {
  assert.deepEqual(
    passiveGitArgs('status', '--porcelain'),
    [
      '-c', 'core.fsmonitor=false',
      '-c', 'core.hooksPath=/dev/null',
      '--no-optional-locks',
      'status', '--porcelain',
    ],
  );
  // Flags are frozen so a caller cannot accidentally weaken them.
  assert.ok(Object.isFrozen(PASSIVE_GIT_HARDENING_ARGS));
});

test('FileService.gitStatus does NOT execute a repo-local core.fsmonitor (#8661)', async (t) => {
  const trap = await makeBoobyTrappedRepo(t);
  if (!trap) {
    t.skip('git not available');
    return;
  }
  const { repo, sentinel } = trap;

  // Sanity: prove the trap is live in THIS git — an UNHARDENED status executes
  // the hook and drops the sentinel. If it does not, fsmonitor is not exercised
  // here and the regression assertion below would be vacuous, so skip.
  try {
    await execFileAsync('git', ['status', '--porcelain'], { cwd: repo });
  } catch {
    // git may reject the hook output; that's fine — we only care about the file.
  }
  if (!fs.existsSync(sentinel)) {
    t.skip('fsmonitor hook not exercised by this git version — cannot prove regression');
    return;
  }
  fs.rmSync(sentinel, { force: true });

  // The real test: FileService.gitStatus is the passive polling sink. It must
  // NOT run the hook.
  const fileService = new FileService(createStore([repo]));
  const status = await fileService.gitStatus(repo);

  assert.equal(fs.existsSync(sentinel), false, 'passive gitStatus executed repo-controlled fsmonitor hook');
  assert.equal(typeof status, 'object');
});

test('SessionDiscovery._getGitInfo does NOT execute a repo-local core.fsmonitor (#8661)', async (t) => {
  const trap = await makeBoobyTrappedRepo(t);
  if (!trap) {
    t.skip('git not available');
    return;
  }
  const { repo, sentinel } = trap;

  try {
    await execFileAsync('git', ['status', '--porcelain'], { cwd: repo });
  } catch { /* ignore */ }
  if (!fs.existsSync(sentinel)) {
    t.skip('fsmonitor hook not exercised by this git version — cannot prove regression');
    return;
  }
  fs.rmSync(sentinel, { force: true });

  const discovery = new SessionDiscovery({ devRoots: [repo] });
  const info = await discovery._getGitInfo(repo);

  assert.equal(fs.existsSync(sentinel), false, 'passive _getGitInfo executed repo-controlled fsmonitor hook');
  assert.ok('dirty' in info);
});

// --- sibling vector: attribute-bound filter.<name>.clean (#8661 re-review) ---

test('FileService.gitStatus does NOT execute a repo-local filter.clean (#8661)', async (t) => {
  const trap = await makeFilterTrappedRepo(t);
  if (!trap) {
    t.skip('git not available');
    return;
  }
  const { repo, sentinel } = trap;

  if (!(await filterTrapFires(repo, sentinel))) {
    t.skip('clean filter not exercised by this git version — cannot prove regression');
    return;
  }

  const fileService = new FileService(createStore([repo]));
  const status = await fileService.gitStatus(repo);

  assert.equal(fs.existsSync(sentinel), false, 'passive gitStatus executed repo-controlled filter.clean');
  // Functionality preserved: the modified tracked file is still reported.
  assert.equal(status['data.bin'], 'M', 'hardened status should still report the modified file');
});

test('SessionDiscovery._getGitInfo does NOT execute a repo-local filter.clean (#8661)', async (t) => {
  const trap = await makeFilterTrappedRepo(t);
  if (!trap) {
    t.skip('git not available');
    return;
  }
  const { repo, sentinel } = trap;

  if (!(await filterTrapFires(repo, sentinel))) {
    t.skip('clean filter not exercised by this git version — cannot prove regression');
    return;
  }

  const discovery = new SessionDiscovery({ devRoots: [repo] });
  const info = await discovery._getGitInfo(repo);

  assert.equal(fs.existsSync(sentinel), false, 'passive _getGitInfo executed repo-controlled filter.clean');
  // Functionality preserved: the same-size edit is still detected as dirty.
  assert.equal(info.dirty, true, 'hardened _getGitInfo should still detect the modified file');
});
