const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { isPathWithinRoots, sanitizeDevRoots } = require('./security-utils');

class FileService {
  constructor(store) {
    this.store = store;
    this.grantedRoots = [];
  }

  setGrantedRoots(roots) {
    this.grantedRoots = sanitizeDevRoots(roots || []);
  }

  tree(dirPath, depth = 0) {
    if (depth > 8) return [];
    if (!this._isAllowedPath(dirPath)) return [];

    const IGNORED = new Set([
      'node_modules', '.git', '__pycache__', 'dist', 'build',
      '.next', '.nuxt', '.cache', '.parcel-cache', 'coverage',
      '.venv', 'venv', 'env', '.env', '.DS_Store', 'Thumbs.db',
    ]);

    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      const result = [];

      for (const entry of entries) {
        if (IGNORED.has(entry.name)) continue;
        if (entry.name.startsWith('.') && entry.name !== '.claude') continue;

        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          result.push({
            name: entry.name,
            path: fullPath,
            type: 'dir',
            children: this.tree(fullPath, depth + 1),
          });
        } else if (entry.isFile()) {
          result.push({
            name: entry.name,
            path: fullPath,
            type: 'file',
          });
        }
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
      const size = stat.size;
      const readOnly = size > 1024 * 1024;

      let fd;
      try {
        fd = fs.openSync(filePath, 'r');
        const buf = Buffer.alloc(Math.min(8192, size));
        fs.readSync(fd, buf, 0, buf.length, 0);
        if (buf.includes(0)) {
          return { error: 'Binary file — cannot open in editor' };
        }
      } finally {
        if (fd !== undefined) fs.closeSync(fd);
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      return { content, size, readOnly };
    } catch (err) {
      return { error: err.message };
    }
  }

  write(filePath, content) {
    if (!this._isAllowedPath(filePath)) {
      return { success: false, error: 'Path not allowed' };
    }

    try {
      const tmpPath = filePath + '.nock-tmp';
      fs.writeFileSync(tmpPath, content, 'utf-8');
      fs.renameSync(tmpPath, filePath);
      return { success: true };
    } catch (err) {
      try { fs.unlinkSync(filePath + '.nock-tmp'); } catch { /* ignore */ }
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

  gitStatus(dirPath) {
    if (!this.isAllowedPath(dirPath)) return {};

    try {
      const output = execSync('git status --porcelain', {
        cwd: dirPath,
        encoding: 'utf-8',
        timeout: 5000,
        windowsHide: true,
      });

      const status = {};
      for (const line of output.split('\n')) {
        if (!line.trim()) continue;
        const code = line.substring(0, 2).trim();
        const file = line.substring(3).trim();
        if (file) status[file] = code;
      }
      return status;
    } catch (err) {
      const msg = err.message || '';
      if (!msg.includes('not a git repository')) {
        console.warn(`FileService.gitStatus error for ${dirPath}:`, msg);
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
