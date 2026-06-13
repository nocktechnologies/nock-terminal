const chokidar = require('chokidar');
const EventEmitter = require('events');

// chokidar 4 dropped glob support; this regex covers the same paths the old
// '**/<dir>/**' globs did (anything inside these directories at any depth).
const IGNORED_DIRS = /(?:^|[\\/])(node_modules|\.git|__pycache__|dist|build|\.next|\.cache|coverage)[\\/]/;

class FileWatcher extends EventEmitter {
  constructor(fileService) {
    super();
    this.fileService = fileService;
    this.watcher = null;
    this.currentRoot = null;
    this.gitPollInterval = null;
  }

  watch(dirPath) {
    this.stop();
    this.currentRoot = dirPath;

    this.watcher = chokidar.watch(dirPath, {
      ignored: IGNORED_DIRS,
      persistent: true,
      ignoreInitial: true,
      depth: 8,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    });

    this.watcher
      .on('error', (err) => console.error('FileWatcher: chokidar error:', err.message))
      .on('add', (filePath) => this._emitChanged('add', filePath))
      .on('change', (filePath) => this._emitChanged('change', filePath))
      .on('unlink', (filePath) => this._emitChanged('unlink', filePath))
      .on('addDir', (dirPath) => this._emitChanged('addDir', dirPath))
      .on('unlinkDir', (dirPath) => this._emitChanged('unlinkDir', dirPath));

    this._pollGitStatus();
    this.gitPollInterval = setInterval(() => this._pollGitStatus(), 10000);
  }

  revalidate() {
    if (this.currentRoot && !this.fileService.isAllowedPath(this.currentRoot)) {
      this.stop();
    }
  }

  // Returns a promise that resolves once the chokidar watcher has closed, so
  // exit paths that skip will-quit (app.exit) can wait for fsevents teardown.
  stop() {
    let closed = null;
    if (this.watcher) {
      try {
        closed = this.watcher.close().catch((err) => {
          console.error('FileWatcher: close error:', err.message);
        });
      } catch (err) {
        console.error('FileWatcher: close error:', err.message);
      }
      this.watcher = null;
    }
    if (this.gitPollInterval) {
      clearInterval(this.gitPollInterval);
      this.gitPollInterval = null;
    }
    this.currentRoot = null;
    return closed || Promise.resolve();
  }

  _pollGitStatus() {
    if (!this.currentRoot) return;
    if (!this.fileService.isAllowedPath(this.currentRoot)) {
      this.stop();
      return;
    }

    const status = this.fileService.gitStatus(this.currentRoot);
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
