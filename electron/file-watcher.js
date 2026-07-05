const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const EventEmitter = require('events');

// chokidar 4 dropped glob support; this regex covers the same paths the old
// '**/<dir>/**' globs did (anything inside these directories at any depth).
const IGNORED_DIRS = /(?:^|[\\/])(node_modules|\.git|__pycache__|dist|build|\.next|\.cache|coverage)[\\/]/;

// Matches the old chokidar `depth: 8` option: root contents are depth 0, so
// watched paths have at most 9 relative segments (8 dirs + entry name).
const MAX_DEPTH_SEGMENTS = 9;

// Matches the old chokidar awaitWriteFinish stabilityThreshold: coalesce the
// event bursts a single save produces and emit once the file settles.
const SETTLE_MS = 300;

// One recursive fs.watch per project root. On macOS libuv backs this with
// FSEvents (a single fd per watch); the previous per-file kqueue fallback via
// chokidar 4 opened one fd per watched file, which put the main process at
// ~20k fds on large projects and broke all child-process spawning (EBADF).
class FileWatcher extends EventEmitter {
  constructor(fileService) {
    super();
    this.fileService = fileService;
    this.watcher = null;
    this.currentRoot = null;
    this.gitPollInterval = null;
    this.knownFiles = new Set();
    this.knownDirs = new Set();
    this.pendingFlushes = new Map();
    this.generation = 0;
  }

  watch(dirPath) {
    this.stop();
    this.currentRoot = dirPath;
    const generation = ++this.generation;

    try {
      this.watcher = fs.watch(dirPath, { recursive: true, persistent: true }, (eventType, filename) => {
        this._onRawEvent(generation, filename);
      });
      this.watcher.on('error', (err) => console.error('FileWatcher: watch error:', err.message));
    } catch (err) {
      console.error('FileWatcher: failed to watch', dirPath, '-', err.message);
      this.watcher = null;
    }

    // Seed the known-path sets so later events can distinguish add from
    // change/unlink. No events are emitted for existing paths (the old
    // ignoreInitial behavior).
    this._crawl(dirPath, dirPath, generation).catch((err) => {
      console.error('FileWatcher: initial scan error:', err.message);
    });

    this._pollGitStatus();
    this.gitPollInterval = setInterval(() => this._pollGitStatus(), 10000);
  }

  revalidate() {
    if (this.currentRoot && !this.fileService.isAllowedPath(this.currentRoot)) {
      this.stop();
    }
  }

  // Kept promise-returning: exit paths that skip will-quit (app.exit) await it
  // before teardown. Closing a recursive fs.watch handle is synchronous.
  stop() {
    this.generation++;
    if (this.watcher) {
      try {
        this.watcher.close();
      } catch (err) {
        console.error('FileWatcher: close error:', err.message);
      }
      this.watcher = null;
    }
    for (const timer of this.pendingFlushes.values()) clearTimeout(timer);
    this.pendingFlushes.clear();
    this.knownFiles.clear();
    this.knownDirs.clear();
    if (this.gitPollInterval) {
      clearInterval(this.gitPollInterval);
      this.gitPollInterval = null;
    }
    this.currentRoot = null;
    return Promise.resolve();
  }

  _watchable(relPath) {
    if (!relPath) return false;
    if (IGNORED_DIRS.test(relPath)) return false;
    return relPath.split(/[\\/]/).length <= MAX_DEPTH_SEGMENTS;
  }

  async _crawl(root, dirPath, generation) {
    if (generation !== this.generation) return;
    let entries;
    try {
      entries = await fsp.readdir(dirPath, { withFileTypes: true });
    } catch {
      return; // directory vanished mid-scan or is unreadable
    }
    const subdirs = [];
    for (const entry of entries) {
      const absPath = path.join(dirPath, entry.name);
      if (!this._watchable(path.relative(root, absPath))) continue;
      if (entry.isDirectory()) {
        this.knownDirs.add(absPath);
        subdirs.push(absPath);
      } else if (entry.isFile()) {
        this.knownFiles.add(absPath);
      }
    }
    await Promise.all(subdirs.map((sub) => this._crawl(root, sub, generation)));
  }

  _onRawEvent(generation, filename) {
    if (generation !== this.generation || !this.currentRoot) return;
    if (!filename || !this._watchable(filename)) return;

    const absPath = path.join(this.currentRoot, filename);
    const existing = this.pendingFlushes.get(absPath);
    if (existing) clearTimeout(existing);
    this.pendingFlushes.set(
      absPath,
      setTimeout(() => this._flush(generation, absPath), SETTLE_MS)
    );
  }

  // Classify a settled raw event against the known-path sets: a path that
  // exists and was known is a change (covers in-place writes and the
  // write-temp-then-rename saves editors do), unknown is an add, and a known
  // path that no longer exists is an unlink.
  async _flush(generation, absPath) {
    if (generation !== this.generation) return;
    this.pendingFlushes.delete(absPath);

    let stats = null;
    try {
      stats = await fsp.stat(absPath);
    } catch {
      stats = null;
    }
    if (generation !== this.generation) return;

    if (stats?.isFile()) {
      const type = this.knownFiles.has(absPath) ? 'change' : 'add';
      this.knownFiles.add(absPath);
      this._emitChanged(type, absPath);
    } else if (stats?.isDirectory()) {
      if (!this.knownDirs.has(absPath)) {
        this.knownDirs.add(absPath);
        this._emitChanged('addDir', absPath);
      }
    } else if (this.knownFiles.delete(absPath)) {
      this._emitChanged('unlink', absPath);
    } else if (this.knownDirs.delete(absPath)) {
      this._emitChanged('unlinkDir', absPath);
    }
  }

  async _pollGitStatus() {
    if (!this.currentRoot) return;
    if (!this.fileService.isAllowedPath(this.currentRoot)) {
      this.stop();
      return;
    }

    const root = this.currentRoot;
    // Root deleted/moved mid-session: stop rather than spam git-status errors
    // every 10s against a path that no longer exists. isAllowedPath still
    // passes (it's a configured devRoot) so we check the filesystem directly.
    try {
      await fsp.stat(root);
    } catch (err) {
      if (err.code === 'ENOENT') {
        this.stop();
        return;
      }
    }
    if (this.currentRoot !== root) return; // project switched while we stat'd

    const status = await this.fileService.gitStatus(root);
    if (this.currentRoot !== root) return; // project switched while git ran
    this.emit('gitStatus', status);
  }

  _emitChanged(type, filePath) {
    if (!this.currentRoot) return;
    if (!this.fileService.isAllowedPath(this.currentRoot)) {
      this.stop();
      return;
    }
    if (!this.fileService.isAllowedPath(filePath)) return;
    this.emit('changed', { type, path: filePath });
  }
}

module.exports = FileWatcher;
module.exports.IGNORED_DIRS = IGNORED_DIRS;
