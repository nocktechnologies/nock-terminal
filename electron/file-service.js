const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const {
  isPathWithinRoots,
  sanitizeDevRoots,
  hardenedPassiveGitArgs,
  gitOpArgs,
  canonicalizePath,
} = require('./security-utils');

const DEFAULT_TREE_MAX_DEPTH = 8;
const DEFAULT_TREE_MAX_ENTRIES = 2000;
const LARGE_FILE_BYTES = 1024 * 1024;
const FILE_PREVIEW_BYTES = 8192;
const IGNORED_TREE_ENTRIES = new Set([
  'node_modules', '.git', '__pycache__', 'dist', 'build',
  '.next', '.nuxt', '.cache', '.parcel-cache', 'coverage',
  '.venv', 'venv', 'env', '.env', '.DS_Store', 'Thumbs.db',
]);

function normalizePositiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

class FileService {
  constructor(store) {
    this.store = store;
    this.grantedRoots = [];
    // Repos the user has actively TRUSTED this session by opening a terminal in
    // them (canonical paths). gitOp (pull/push/fetch) is gated on this — see
    // gitOp() and Nock #8663. Populated via trustRepoRoot() when a terminal
    // launches; being merely discovered/allowed is NOT trust.
    this.trustedRepoRoots = [];
  }

  setGrantedRoots(roots) {
    this.grantedRoots = sanitizeDevRoots(roots || []);
  }

  // Mark a repo as trusted for gitOp because the user opened a terminal in it.
  // Best-effort: a path that can't be canonicalized is simply not recorded.
  trustRepoRoot(dirPath) {
    if (typeof dirPath !== 'string' || dirPath === '') return;
    let canon;
    try {
      canon = canonicalizePath(dirPath);
    } catch {
      return;
    }
    if (!this.trustedRepoRoots.includes(canon)) {
      this.trustedRepoRoots.push(canon);
    }
  }

  // True only if `dirPath` shares a tree with a repo the user opened a terminal
  // in — the op path within a trusted root, or a trusted root within the op path
  // (covers terminal-at-root/op-at-subdir and vice-versa). A merely-discovered
  // repo the user never opened a terminal in is NOT trusted.
  isGitOpTrusted(dirPath) {
    if (!this.trustedRepoRoots.length) return false;
    if (isPathWithinRoots(dirPath, this.trustedRepoRoots)) return true;
    return this.trustedRepoRoots.some((root) => isPathWithinRoots(root, [dirPath]));
  }

  tree(dirPath, options = {}) {
    const maxDepth = normalizePositiveInteger(options.maxDepth, DEFAULT_TREE_MAX_DEPTH);
    const maxEntries = normalizePositiveInteger(options.maxEntries, DEFAULT_TREE_MAX_ENTRIES);
    const meta = {
      truncated: false,
      truncatedByDepth: false,
      truncatedByEntries: false,
      entryCount: 0,
      maxDepth,
      maxEntries,
    };

    if (!this._isAllowedPath(dirPath)) {
      return { entries: [], meta: { ...meta, error: 'Path not allowed' } };
    }

    // A deleted/moved project root would otherwise return an empty tree that
    // looks identical to an empty folder. Surface it so the UI can say so
    // instead of showing a silent blank pane.
    const resolved = path.resolve(dirPath);
    let rootStat;
    try {
      rootStat = fs.statSync(resolved);
    } catch (err) {
      const error = err.code === 'ENOENT'
        ? 'Project folder no longer exists'
        : `Cannot open project folder: ${err.code || err.message}`;
      return { entries: [], meta: { ...meta, error } };
    }
    if (!rootStat.isDirectory()) {
      return { entries: [], meta: { ...meta, error: 'Project path is not a folder' } };
    }

    return {
      entries: this._treeEntries(resolved, 0, { maxDepth, maxEntries }, meta),
      meta,
    };
  }

  _treeEntries(dirPath, depth, options, meta) {
    if (depth >= options.maxDepth) {
      meta.truncated = true;
      meta.truncatedByDepth = true;
      return [];
    }

    try {
      const dir = fs.opendirSync(dirPath);
      const result = [];

      try {
        let entry;
        while ((entry = dir.readSync()) !== null) {
          if (IGNORED_TREE_ENTRIES.has(entry.name)) continue;
          if (entry.name.startsWith('.') && entry.name !== '.claude') continue;

          if (meta.entryCount >= options.maxEntries) {
            meta.truncated = true;
            meta.truncatedByEntries = true;
            break;
          }

          const fullPath = path.join(dirPath, entry.name);

          if (entry.isDirectory()) {
            meta.entryCount += 1;
            result.push({
              name: entry.name,
              path: fullPath,
              type: 'dir',
              children: this._treeEntries(fullPath, depth + 1, options, meta),
            });
          } else if (entry.isFile()) {
            meta.entryCount += 1;
            result.push({
              name: entry.name,
              path: fullPath,
              type: 'file',
            });
          }
        }
      } finally {
        dir.closeSync();
      }

      result.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      });

      return result;
    } catch (err) {
      console.error(`FileService.tree error for ${dirPath}:`, err.message);
      return [];
    }
  }

  read(filePath) {
    if (!this._isAllowedPath(filePath)) {
      return { error: 'Path not allowed' };
    }

    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) {
        return { error: 'Not a file' };
      }
      const size = stat.size;

      let fd;
      let preview = Buffer.alloc(0);
      try {
        fd = fs.openSync(filePath, 'r');
        const buf = Buffer.alloc(Math.min(FILE_PREVIEW_BYTES, size));
        const bytesRead = buf.length > 0 ? fs.readSync(fd, buf, 0, buf.length, 0) : 0;
        preview = buf.subarray(0, bytesRead);
        if (preview.includes(0)) {
          return { error: 'Binary file — cannot open in editor' };
        }
      } finally {
        if (fd !== undefined) fs.closeSync(fd);
      }

      if (size > LARGE_FILE_BYTES) {
        return {
          content: preview.toString('utf-8'),
          size,
          readOnly: true,
          truncated: true,
          previewBytes: preview.length,
        };
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      return { content, size, readOnly: false, truncated: false };
    } catch (err) {
      return { error: err.message };
    }
  }

  write(filePath, content) {
    if (!this._isAllowedPath(filePath)) {
      return { success: false, error: 'Path not allowed' };
    }

    if (typeof content !== 'string') {
      return { success: false, error: 'Content must be a string' };
    }

    const tmpPath = filePath + '.nock-tmp';
    if (!this._isAllowedPath(tmpPath)) {
      return { success: false, error: 'Path not allowed' };
    }

    let fd;
    try {
      fd = fs.openSync(tmpPath, 'wx', 0o600);
      fs.writeFileSync(fd, content, 'utf-8');
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;

      if (!this._isAllowedPath(tmpPath) || !this._isAllowedPath(filePath)) {
        throw new Error('Path not allowed');
      }

      fs.renameSync(tmpPath, filePath);
      return { success: true };
    } catch (err) {
      try {
        if (fd !== undefined) fs.closeSync(fd);
      } catch {
        // ignore cleanup failure
      }
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
      return { success: false, error: err.message };
    }
  }

  stat(filePath) {
    if (!this.isAllowedPath(filePath)) {
      return { exists: false, size: 0, mtime: 0, error: 'Path not allowed' };
    }

    try {
      const stat = fs.statSync(filePath);
      return { exists: true, size: stat.size, mtime: stat.mtimeMs };
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error(`FileService.stat error for ${filePath}:`, err.message);
      }
      return { exists: false, size: 0, mtime: 0 };
    }
  }

  async gitOp(dirPath, operation) {
    const ALLOWED_OPS = new Set(['pull', 'push', 'fetch']);
    if (!ALLOWED_OPS.has(operation)) return { success: false, error: 'Unknown operation' };
    if (!this.isAllowedPath(dirPath)) return { success: false, error: 'Path not allowed' };

    // TRUST GATE (Nock #8663). fetch/pull/checkout make git execute
    // repo-controlled config — `remote.<name>.url=ext::<cmd>`, `core.sshCommand`,
    // and checkout smudge filters — as arbitrary commands. On a repo the user
    // has merely DISCOVERED (it appeared in the dashboard) but never opened a
    // terminal in, that is a code-execution surface. Refuse the op outright for
    // an untrusted repo (no git runs at all) and tell the UI trust is required;
    // opening a terminal there is the explicit trust step.
    if (!this.isGitOpTrusted(dirPath)) {
      return {
        success: false,
        requiresTrust: true,
        error: 'This repository has not been opened in a terminal yet. Open a terminal here first, then retry pull/push/fetch.',
      };
    }

    try {
      // The user trusts this repo, so its own hooks / smudge filters / sshCommand
      // are legitimate and preserved (NOT disabled — unlike the passive path).
      // We still neutralize the repo-controlled core.fsmonitor command and refuse
      // the `ext::` arbitrary-command transport as defense-in-depth (#8663).
      const { stdout } = await execFileAsync('git', gitOpArgs(operation), {
        cwd: dirPath,
        encoding: 'utf-8',
        timeout: 30000,
      });
      return { success: true, output: stdout.trim() };
    } catch (err) {
      const msg = ((err.stdout?.toString() || '') + (err.stderr?.toString() || '')).trim() || err.message;
      return { success: false, error: msg };
    }
  }

  async gitStatus(dirPath) {
    if (!this.isAllowedPath(dirPath)) return {};

    try {
      // PASSIVE status poll (editor git-status watcher) over a discovered repo.
      // Harden against repo-controlled execution — a repo-local core.fsmonitor
      // OR an attribute-bound filter.<name>.clean would otherwise run as a
      // command here (Nock #8661); --attr-source=<empty tree> kills the latter.
      const args = await hardenedPassiveGitArgs(dirPath, 'status', '--porcelain');
      const { stdout } = await execFileAsync('git', args, {
        cwd: dirPath,
        encoding: 'utf-8',
        timeout: 5000,
        windowsHide: true,
      });

      const status = {};
      for (const line of stdout.split('\n')) {
        if (!line.trim()) continue;
        const code = line.substring(0, 2).trim();
        const file = line.substring(3).trim();
        if (file) status[file] = code;
      }
      return status;
    } catch (err) {
      const msg = `${err.message || ''} ${err.stderr || ''}`;
      if (!msg.includes('not a git repository')) {
        console.warn(`FileService.gitStatus error for ${dirPath}:`, msg.trim());
      }
      return {};
    }
  }

  _isAllowedPath(filePath) {
    return this.isAllowedPath(filePath);
  }

  isAllowedPath(filePath) {
    const configuredRoots = sanitizeDevRoots(this.store?.get('devRoots') || []);
    const allowedRoots = [...new Set([...configuredRoots, ...this.grantedRoots])];
    if (allowedRoots.length === 0 || typeof filePath !== 'string' || filePath.trim() === '') {
      console.warn('FileService: no allowed roots configured — all paths rejected');
      return false;
    }
    return isPathWithinRoots(filePath, allowedRoots);
  }
}

module.exports = FileService;
