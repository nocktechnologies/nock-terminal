const chokidar = require('chokidar');
const EventEmitter = require('events');

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
      ignored: [
        '**/node_modules/**',
        '**/.git/**',
        '**/__pycache__/**',
        '**/dist/**',
        '**/build/**',
        '**/.next/**',
        '**/.cache/**',
        '**/coverage/**',
      ],
      persistent: true,
      ignoreInitial: true,
      depth: 8,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    });

    this.watcher
      .on('add', (filePath) => this.emit('changed', { type: 'add', path: filePath }))
      .on('unlink', (filePath) => this.emit('changed', { type: 'unlink', path: filePath }))
      .on('addDir', (dirPath) => this.emit('changed', { type: 'addDir', path: dirPath }))
      .on('unlinkDir', (dirPath) => this.emit('changed', { type: 'unlinkDir', path: dirPath }));

    this._pollGitStatus();
    this.gitPollInterval = setInterval(() => this._pollGitStatus(), 10000);
  }

  stop() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.gitPollInterval) {
      clearInterval(this.gitPollInterval);
      this.gitPollInterval = null;
    }
    this.currentRoot = null;
  }

  _pollGitStatus() {
    if (!this.currentRoot) return;
    const status = this.fileService.gitStatus(this.currentRoot);
    this.emit('gitStatus', status);
  }
}

module.exports = FileWatcher;
