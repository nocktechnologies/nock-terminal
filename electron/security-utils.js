const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

function canonicalizePath(targetPath) {
  if (typeof targetPath !== 'string' || targetPath.trim() === '') {
    throw new Error('Path must be a non-empty string');
  }

  const resolved = path.resolve(targetPath);
  const realpath = fs.realpathSync.native || fs.realpathSync;

  try {
    return realpath(resolved);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;

    const parent = path.dirname(resolved);
    if (parent === resolved) return resolved;

    return path.join(canonicalizePath(parent), path.basename(resolved));
  }
}

function isPathWithinRoots(targetPath, roots) {
  if (!Array.isArray(roots) || roots.length === 0) return false;

  let normalizedTarget;
  try {
    normalizedTarget = canonicalizePath(targetPath);
  } catch {
    return false;
  }

  return roots.some((root) => {
    try {
      const normalizedRoot = canonicalizePath(root);
      const relative = path.relative(normalizedRoot, normalizedTarget);
      return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
    } catch {
      return false;
    }
  });
}

function sanitizeStringList(value, { maxItems = 100, maxLength = 200 } = {}) {
  if (!Array.isArray(value)) return [];

  const seen = new Set();
  const result = [];

  for (const entry of value) {
    if (result.length >= maxItems) break;
    if (typeof entry !== 'string') continue;

    const trimmed = entry.trim();
    if (!trimmed || trimmed.length > maxLength) continue;

    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }

  return result;
}

function sanitizeDevRoots(value) {
  if (!Array.isArray(value)) return [];

  const roots = [];
  const seen = new Set();
  const realpath = fs.realpathSync.native || fs.realpathSync;
  const homeDir = realpath(os.homedir());

  for (const entry of value) {
    if (roots.length >= 20) break;
    if (typeof entry !== 'string') continue;

    const trimmed = entry.trim();
    if (!trimmed) continue;

    let normalized;
    try {
      normalized = canonicalizePath(trimmed);
      const stat = fs.statSync(normalized);
      if (!stat.isDirectory()) continue;
    } catch {
      continue;
    }

    const rootPath = path.parse(normalized).root;
    if (normalized === rootPath) continue;
    if (normalized === homeDir) continue;

    if (seen.has(normalized)) continue;
    seen.add(normalized);
    roots.push(normalized);
  }

  return roots;
}

// Hardening flags for PASSIVE git invocations (background dashboard discovery
// and editor git-status polling) against discovered/untrusted repos. A cloned
// repo can set repo-local config `core.fsmonitor` — which git treats as a hook
// command — and Nock Terminal would otherwise EXECUTE it while merely reading
// status, before the user ever opens a terminal there (code-execution vector,
// Nock #8661). These flags neutralize repo-controlled execution:
//   core.fsmonitor=false      — never run the fsmonitor hook command
//   core.hooksPath=/dev/null  — point hooks at an empty path so NO repo hook
//                               fires (a missing dir = no hooks, cross-platform;
//                               git-for-windows maps /dev/null)
//   --no-optional-locks       — don't take/refresh index locks for a read
// Prepend to the git arg list, e.g.:
//   execFile('git', passiveGitArgs('status', '--porcelain'), ...)
// Only for PASSIVE reads — do NOT use for a terminal the user explicitly
// launched (that repo is their trusted choice).
const PASSIVE_GIT_HARDENING_ARGS = Object.freeze([
  '-c', 'core.fsmonitor=false',
  '-c', 'core.hooksPath=/dev/null',
  '--no-optional-locks',
]);

function passiveGitArgs(...rest) {
  return [...PASSIVE_GIT_HARDENING_ARGS, ...rest];
}

// The config flags above close core.fsmonitor, but git ALSO executes
// attribute-driven programs during `status` — a repo-local `filter.<name>.clean`
// (bound to a path by an in-tree `.gitattributes`) runs whenever git can't
// settle a file's modified-state by stat alone (attacker ships a same-size,
// different-bytes worktree copy). Same untrusted `.git/config` + `.gitattributes`
// as the fsmonitor vector, so it's the same threat model (Nock #8661, sibling).
// There is NO single `-c` flag that disables filters, and the driver NAME is
// attacker-chosen so a blanket `-c filter.X.clean=` is impossible.
//
// We instead read attributes from an EMPTY tree (`--attr-source=<empty-tree>`).
// With no `.gitattributes` in scope, NO path binds to ANY filter/diff/textconv
// driver, so the whole class of attribute-driven execution is neutralized
// regardless of driver name — while `status --porcelain` output is unchanged.
// `--attr-source` is a git top-level option (git >= 2.36); on older git it is
// an unknown option and the invocation fails closed (no execution, status just
// reports nothing) rather than running the filter.
const EMPTY_TREE_OID = {
  sha1: '4b825dc642cb6eb9a060e54bf8d69288fbee4904',
  sha256: '6ef19b41225c5369f1c104d45d8d85efa9b057b53b14b4b9b939dd74decc5321',
};

const _objectFormatCache = new Map(); // repoPath -> 'sha1' | 'sha256'

// Resolve the empty-tree oid for a repo's hash algorithm (cached — a repo's
// object format never changes). Fails closed to sha1 (the near-universal
// default); a wrong oid only makes git error out, which is safe.
async function emptyTreeAttrSource(repoPath) {
  let fmt = _objectFormatCache.get(repoPath);
  if (!fmt) {
    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', '--show-object-format'], {
        cwd: repoPath,
        timeout: 3000,
        windowsHide: true,
      });
      fmt = stdout.trim();
    } catch {
      fmt = 'sha1';
    }
    if (!EMPTY_TREE_OID[fmt]) fmt = 'sha1';
    _objectFormatCache.set(repoPath, fmt);
  }
  return EMPTY_TREE_OID[fmt];
}

// Full argument list for a PASSIVE git read of `repoPath`: the config-flag
// hardening PLUS `--attr-source=<empty tree>` so no attribute-driven driver
// (filter/diff/textconv) can execute. Use this for every passive status sink.
async function hardenedPassiveGitArgs(repoPath, ...rest) {
  const oid = await emptyTreeAttrSource(repoPath);
  return passiveGitArgs(`--attr-source=${oid}`, ...rest);
}

module.exports = {
  canonicalizePath,
  isPathWithinRoots,
  sanitizeDevRoots,
  sanitizeStringList,
  PASSIVE_GIT_HARDENING_ARGS,
  passiveGitArgs,
  EMPTY_TREE_OID,
  emptyTreeAttrSource,
  hardenedPassiveGitArgs,
};
