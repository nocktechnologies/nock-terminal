// Regression test for Nock #8663 — gitOp (pull/push/fetch) must not execute
// repo-controlled config on a repo the user has merely DISCOVERED but never
// opened a terminal in (not yet trusted).
//
// fetch/pull/checkout make git run repo-controlled config as commands:
//   remote.<name>.url=ext::<cmd>   (arbitrary "transport" command)
//   core.sshCommand=<cmd>          (runs instead of ssh)
//   filter.<name>.smudge=<cmd>     (checkout smudge filter)
// The fix is a TRUST GATE: gitOp only runs on a repo the user opened a terminal
// in (FileService.trustRepoRoot). An untrusted repo is refused outright (no git
// runs). Defense-in-depth: even on a trusted repo the `ext::` transport is
// refused via -c protocol.ext.allow=never. Legitimate hooks/filters on a trusted
// repo must keep working (no over-hardening).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const FileService = require('../electron/file-service');
const { gitOpArgs, GITOP_HARDENING_ARGS } = require('../electron/security-utils');

function createStore(devRoots) {
  return {
    get(key) {
      if (key === 'devRoots') return devRoots;
      return undefined;
    },
  };
}

function sandbox(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nock-8663-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function gitAvailable() {
  try {
    await execFileAsync('git', ['--version']);
    return true;
  } catch {
    return false;
  }
}

// A repo whose `origin` is an ext:: "remote" that runs a helper writing a
// sentinel, plus repo-local protocol.ext.allow=always (attacker controls
// .git/config) so a bare `git fetch` would execute it.
async function makeExtExploitRepo(root) {
  const repo = path.join(root, 'evil');
  fs.mkdirSync(repo, { recursive: true });
  await execFileAsync('git', ['init', '-q'], { cwd: repo });
  await execFileAsync('git', ['config', 'user.email', 't@e.com'], { cwd: repo });
  await execFileAsync('git', ['config', 'user.name', 't'], { cwd: repo });

  const sentinel = path.join(root, 'EXT_PWNED');
  const helper = path.join(root, 'helper.sh');
  fs.writeFileSync(helper, `#!/bin/sh\ntouch ${JSON.stringify(sentinel)}\nexit 1\n`, { mode: 0o755 });
  await execFileAsync('git', ['remote', 'add', 'origin', `ext::${helper} %S`], { cwd: repo });
  // Attacker re-enables the ext transport that git blocks by default.
  await execFileAsync('git', ['config', 'protocol.ext.allow', 'always'], { cwd: repo });
  return { repo, sentinel };
}

// A repo whose repo-local core.sshCommand runs a sentinel-writing command, bound
// to an ssh:// origin so a bare `git fetch` executes it. Unlike ext::, the gitOp
// path does NOT neutralize core.sshCommand on a trusted repo (that would break a
// user's legit ssh key), so ONLY the trust gate stops it — a genuine
// fail-on-revert for code execution.
async function makeSshCommandExploitRepo(root, name = 'evilssh') {
  const repo = path.join(root, name);
  fs.mkdirSync(repo, { recursive: true });
  await execFileAsync('git', ['init', '-q'], { cwd: repo });
  await execFileAsync('git', ['config', 'user.email', 't@e.com'], { cwd: repo });
  await execFileAsync('git', ['config', 'user.name', 't'], { cwd: repo });

  const sentinel = path.join(root, `SSH_PWNED_${name}`);
  await execFileAsync('git', ['remote', 'add', 'origin', 'ssh://nobody@127.0.0.1:22/x.git'], { cwd: repo });
  await execFileAsync(
    'git',
    ['config', 'core.sshCommand', `sh -c 'touch ${JSON.stringify(sentinel)}; exit 1'`],
    { cwd: repo },
  );
  return { repo, sentinel };
}

test('gitOpArgs carries the fsmonitor + ext-transport hardening', () => {
  assert.deepEqual(gitOpArgs('fetch'), [
    '-c', 'core.fsmonitor=false',
    '-c', 'protocol.ext.allow=never',
    'fetch',
  ]);
  assert.ok(Object.isFrozen(GITOP_HARDENING_ARGS));
});

test('trust is REPO IDENTITY (git-root equality), not path containment (#8663)', async (t) => {
  if (!(await gitAvailable())) { t.skip('git not available'); return; }
  const root = sandbox(t);
  const gitInit = async (p) => {
    fs.mkdirSync(p, { recursive: true });
    await execFileAsync('git', ['init', '-q'], { cwd: p });
  };

  // legit repo (opened) with a same-repo subdir and a NESTED child repo (own .git)
  const legit = path.join(root, 'legit');
  await gitInit(legit);
  const legitSub = path.join(legit, 'src', 'deep');
  fs.mkdirSync(legitSub, { recursive: true });
  const nestedChild = path.join(legit, 'vendor', 'evil');
  await gitInit(nestedChild); // Probe A (downward): attacker repo nested inside

  // monorepo with a nested child repo the user actually opens (Probe B upward)
  const mono = path.join(root, 'mono');
  await gitInit(mono);
  const monoUi = path.join(mono, 'packages', 'ui');
  await gitInit(monoUi);

  // Terminal opened in /legit
  const fsA = new FileService(createStore([root]));
  assert.equal(fsA.isGitOpTrusted(legit), false, 'nothing trusted yet');
  fsA.trustRepoRoot(legit);
  assert.equal(fsA.isGitOpTrusted(legit), true, 'the opened repo root is trusted');
  assert.equal(fsA.isGitOpTrusted(legitSub), true, 'a same-repo subdir resolves to the same repo (flex preserved)');
  // Probe A — DOWNWARD leak closed: a nested child repo is a different identity.
  assert.equal(fsA.isGitOpTrusted(nestedChild), false, 'nested child repo (own .git) must NOT inherit trust');
  assert.equal(fsA.isGitOpTrusted(root), false, 'a non-repo parent path is untrusted');

  // Terminal opened in the nested /mono/packages/ui
  const fsB = new FileService(createStore([root]));
  fsB.trustRepoRoot(monoUi);
  assert.equal(fsB.isGitOpTrusted(monoUi), true, 'the opened nested repo is trusted');
  // Probe B — UPWARD leak closed: the enclosing parent repo is a different identity.
  assert.equal(fsB.isGitOpTrusted(mono), false, 'enclosing parent repo (own .git) must NOT be trusted');
});

test('gitOp REFUSES an untrusted repo and does NOT execute core.sshCommand (#8663)', async (t) => {
  if (!(await gitAvailable())) { t.skip('git not available'); return; }
  const root = sandbox(t);
  // core.sshCommand is NOT neutralized on the trusted path, so this proves the
  // GATE (not the ext flag) prevents execution — reverting the gate lets it fire.
  const { repo, sentinel } = await makeSshCommandExploitRepo(root);

  const fileService = new FileService(createStore([root]));
  // repo is allowed (under devRoot) but the user never opened a terminal in it.
  const result = await fileService.gitOp(repo, 'fetch');

  assert.equal(result.success, false);
  assert.equal(result.requiresTrust, true, 'untrusted repo must require trust');
  assert.equal(fs.existsSync(sentinel), false, 'gitOp executed repo-controlled core.sshCommand on an untrusted repo');
});

test('gitOp on a TRUSTED repo still refuses the ext:: transport (defense-in-depth, #8663)', async (t) => {
  if (!(await gitAvailable())) { t.skip('git not available'); return; }
  const root = sandbox(t);
  const { repo, sentinel } = await makeExtExploitRepo(root);

  const fileService = new FileService(createStore([root]));
  fileService.trustRepoRoot(repo); // user opened a terminal here

  const result = await fileService.gitOp(repo, 'fetch');

  // Trust passed the gate, so git DID run (not requiresTrust) — but the ext::
  // transport is refused by -c protocol.ext.allow=never, so no code executed.
  assert.notEqual(result.requiresTrust, true, 'gate should have passed for a trusted repo');
  assert.equal(result.success, false, 'ext:: fetch should still fail (transport refused)');
  assert.equal(fs.existsSync(sentinel), false, 'trusted gitOp executed the ext:: transport');
});

test('gitOp on a TRUSTED repo still runs legitimate hooks (no over-hardening, #8663)', async (t) => {
  if (!(await gitAvailable())) { t.skip('git not available'); return; }
  const root = sandbox(t);

  // bare upstream + a working clone with upstream tracking
  const up = path.join(root, 'up.git');
  const work = path.join(root, 'work');
  await execFileAsync('git', ['init', '-q', '--bare', up]);
  await execFileAsync('git', ['clone', '-q', up, work]);
  await execFileAsync('git', ['config', 'user.email', 't@e.com'], { cwd: work });
  await execFileAsync('git', ['config', 'user.name', 't'], { cwd: work });
  fs.writeFileSync(path.join(work, 'f.txt'), 'v1\n');
  await execFileAsync('git', ['add', 'f.txt'], { cwd: work });
  await execFileAsync('git', ['commit', '-qm', 'c1'], { cwd: work });
  await execFileAsync('git', ['push', '-q', 'origin', 'HEAD:main'], { cwd: work });
  // Track origin/main on whatever the local default branch is named, so a bare
  // `git pull` has an upstream to merge (avoids assuming the branch name).
  await execFileAsync('git', ['branch', '--set-upstream-to=origin/main'], { cwd: work });

  // advance upstream from a second clone so a bare `git pull` has something to merge
  const work2 = path.join(root, 'work2');
  await execFileAsync('git', ['clone', '-q', '-b', 'main', up, work2]);
  await execFileAsync('git', ['config', 'user.email', 't@e.com'], { cwd: work2 });
  await execFileAsync('git', ['config', 'user.name', 't'], { cwd: work2 });
  fs.appendFileSync(path.join(work2, 'f.txt'), 'v2\n');
  await execFileAsync('git', ['commit', '-qam', 'c2'], { cwd: work2 });
  await execFileAsync('git', ['push', '-q', 'origin', 'main'], { cwd: work2 });

  // a LEGITIMATE post-merge hook on the trusted repo — must still fire
  const hookRan = path.join(root, 'POSTMERGE_RAN');
  const hookPath = path.join(work, '.git', 'hooks', 'post-merge');
  fs.writeFileSync(hookPath, `#!/bin/sh\ntouch ${JSON.stringify(hookRan)}\n`, { mode: 0o755 });

  const fileService = new FileService(createStore([root]));
  fileService.trustRepoRoot(work);

  const result = await fileService.gitOp(work, 'pull');

  assert.equal(result.success, true, `trusted pull should succeed: ${result.error || ''}`);
  assert.equal(fs.existsSync(hookRan), true, 'trusted repo post-merge hook must still run (do not over-harden)');
});
