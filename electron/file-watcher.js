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

// fseventsd can wedge (observed on macOS 26.5 with fseventsd at high CPU/RSS):
// fs.watch(recursive) opens fine, reports no error, and never delivers a
// single event. The only way to tell is to prove delivery: write a probe file
// into the watched root and wait for its raw event. Probe files use this
// prefix and are invisible to consumers.
const PROBE_PREFIX = '.nock-terminal-watch-probe-';
const VERIFY_TIMEOUT_MS = 2000;
const POLL_INTERVAL_MS = 2000;

// One recursive fs.watch per project root. On macOS libuv backs this with
// FSEvents (a single fd per watch); the previous per-file kqueue fallback via
// chokidar 4 opened one fd per watched file, which put the main process at
// ~20k fds on large projects and broke all child-process spawning (EBADF).
// When the native watcher proves silent (see PROBE_PREFIX above) we fall back
// to a bounded mtime-polling scan — one interval timer and one readdir at a
// time, never per-file watchers, so the fd ceiling holds in both modes.
class FileWatcher extends EventEmitter {
  constructor(fileService, options = {}) {
    super();
    this.fileService = fileService;
    this.watcher = null;
    this.currentRoot = null;
    this.gitPollInterval = null;
    this.knownFiles = new Set();
    this.knownDirs = new Set();
    this.pendingFlushes = new Map();
    this.generation = 0;
    // 'native' (recursive fs.watch) or 'poll' (mtime scan fallback).
    this.mode = null;
    // Escape hatch for hosts where fseventsd is known-degraded.
    this.forcePolling = options.forcePolling ?? process.env.NOCK_TERMINAL_FORCE_POLL === '1';
    this.verifyTimeoutMs = options.verifyTimeoutMs ?? VERIFY_TIMEOUT_MS;
    this.pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
    this.pollInterval = null;
    this.pollSnapshot = null;
    this.pollScanning = false;
    this.probeEventSeen = false;
    this.watchStartTs = 0;
    this.crawlPromise = Promise.resolve();
  }

  watch(dirPath) {
    this.stop();
    this.currentRoot = dirPath;
    const generation = ++this.generation;
    this.watchStartTs = Date.now();
    this.probeEventSeen = false;

    let nativeStarted = false;
    if (!this.forcePolling) {
      try {
        this.watcher = fs.watch(dirPath, { recursive: true, persistent: true }, (eventType, filename) => {
          this._onRawEvent(generation, filename);
        });
        this.watcher.on('error', (err) => console.error('FileWatcher: watch error:', err.message));
        this.mode = 'native';
        nativeStarted = true;
      } catch (err) {
        console.error('FileWatcher: failed to watch', dirPath, '-', err.message);
        this.watcher = null;
      }
    }

    // Seed the known-path sets so later events can distinguish add from
    // change/unlink. No events are emitted for existing paths (the old
    // ignoreInitial behavior).
    this.crawlPromise = this._crawl(dirPath, dirPath, generation).catch((err) => {
      console.error('FileWatcher: initial scan error:', err.message);
    });

    if (nativeStarted) {
      this._verifyNativeWatcher(dirPath, generation).catch((err) => {
        console.error('FileWatcher: watch self-test error:', err.message);
      });
    } else {
      this._startPolling(generation);
    }

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
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.pollSnapshot = null;
    this.mode = null;
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
    if (!filename) return;
    // Probe traffic proves the watcher delivers; it is never surfaced.
    if (path.basename(filename).startsWith(PROBE_PREFIX)) {
      this.probeEventSeen = true;
      return;
    }
    if (!this._watchable(filename)) return;

    const absPath = path.join(this.currentRoot, filename);
    const existing = this.pendingFlushes.get(absPath);
    if (existing) clearTimeout(existing);
    this.pendingFlushes.set(
      absPath,
      setTimeout(() => this._flush(generation, absPath), SETTLE_MS)
    );
  }

  // Prove the native watcher actually delivers events. A wedged fseventsd
  // yields a watcher that opens cleanly and stays silent forever, which would
  // silently kill file-tree refresh and external-edit detection.
  async _verifyNativeWatcher(dirPath, generation) {
    const probePath = path.join(dirPath, PROBE_PREFIX + process.pid + '-' + generation);
    try {
      await fsp.writeFile(probePath, '');
    } catch {
      // Can't self-test an unwritable root; assume the worst and poll.
      this._fallBackToPolling(generation, 'probe write failed');
      return;
    }
    const deadline = Date.now() + this.verifyTimeoutMs;
    while (!this.probeEventSeen && generation === this.generation && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await fsp.unlink(probePath).catch(() => {});
    if (generation !== this.generation || this.probeEventSeen) return;
    this._fallBackToPolling(generation, 'no events after self-test write');
  }

  _fallBackToPolling(generation, reason) {
    if (generation !== this.generation) return;
    console.warn(
      `FileWatcher: recursive fs.watch is silent (${reason}); ` +
        `falling back to mtime polling every ${this.pollIntervalMs}ms`
    );
    if (this.watcher) {
      try {
        this.watcher.close();
      } catch (err) {
        console.error('FileWatcher: close error:', err.message);
      }
      this.watcher = null;
    }
    this._startPolling(generation);
  }

  _startPolling(generation) {
    if (generation !== this.generation || !this.currentRoot) return;
    this.mode = 'poll';
    this.pollSnapshot = null;
    this._pollTick(generation);
    this.pollInterval = setInterval(() => this._pollTick(generation), this.pollIntervalMs);
  }

  async _pollTick(generation) {
    if (generation !== this.generation || this.pollScanning || !this.currentRoot) return;
    this.pollScanning = true;
    try {
      const baseline = !this.pollSnapshot;
      // The baseline diffs against the initial crawl's known-path sets; let
      // the crawl finish so an in-progress scan isn't mistaken for adds.
      if (baseline) await this.crawlPromise;
      if (generation !== this.generation || !this.currentRoot) return;
      const root = this.currentRoot;
      const snapshot = await this._scanTree(root, generation);
      if (generation !== this.generation) return;
      const prev = this.pollSnapshot;
      this.pollSnapshot = snapshot;
      const raw = (absPath) => this._onRawEvent(generation, path.relative(root, absPath));
      if (baseline || !prev) {
        // Nothing settled is emitted for already-known unchanged paths, but
        // anything that moved while the dead native watcher was being
        // verified must not be lost: files modified since watch() started,
        // paths the crawl never saw, and known paths already gone.
        for (const [absPath, info] of snapshot) {
          if (info.isDir) {
            if (!this.knownDirs.has(absPath)) raw(absPath);
          } else if (!this.knownFiles.has(absPath) || info.mtimeMs > this.watchStartTs) {
            raw(absPath);
          }
        }
        for (const absPath of this.knownFiles) {
          if (!snapshot.has(absPath)) raw(absPath);
        }
        for (const absPath of this.knownDirs) {
          if (!snapshot.has(absPath)) raw(absPath);
        }
      } else {
        for (const [absPath, info] of snapshot) {
          const seen = prev.get(absPath);
          if (!seen) raw(absPath);
          else if (!info.isDir && info.mtimeMs !== seen.mtimeMs) raw(absPath);
        }
        for (const absPath of prev.keys()) {
          if (!snapshot.has(absPath)) raw(absPath);
        }
      }
    } finally {
      this.pollScanning = false;
    }
  }

  // Sequential breadth-first stat scan under the same IGNORED_DIRS and depth
  // bounds as the crawl: one readdir handle open at a time, no per-file
  // watchers, so a poll tick can never recreate the old fd exhaustion.
  async _scanTree(root, generation) {
    const snapshot = new Map();
    const queue = [root];
    while (queue.length > 0) {
      if (generation !== this.generation) return snapshot;
      const dir = queue.shift();
      let entries;
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        continue; // directory vanished mid-scan or is unreadable
      }
      for (const entry of entries) {
        const absPath = path.join(dir, entry.name);
        if (entry.name.startsWith(PROBE_PREFIX)) continue;
        if (!this._watchable(path.relative(root, absPath))) continue;
        if (entry.isDirectory()) {
          snapshot.set(absPath, { isDir: true, mtimeMs: 0 });
          queue.push(absPath);
        } else if (entry.isFile()) {
          let stats;
          try {
            stats = await fsp.stat(absPath);
          } catch {
            continue; // deleted between readdir and stat
          }
          snapshot.set(absPath, { isDir: false, mtimeMs: stats.mtimeMs });
        }
      }
    }
    return snapshot;
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
module.exports.PROBE_PREFIX = PROBE_PREFIX;
