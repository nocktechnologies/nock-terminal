const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

class SessionDiscovery {
  constructor() {
    this.claudeDir = path.join(os.homedir(), '.claude');
    this.projectsDir = path.join(this.claudeDir, 'projects');
    // Cache git status results: { projectPath: { branch, dirty, cachedAt } }
    this.gitCache = new Map();
    this.gitCacheTTL = 15000; // 15 seconds
  }

  async discover() {
    const sessions = [];

    try {
      // Check projects dir exists
      try {
        await fsp.access(this.projectsDir);
      } catch {
        return sessions;
      }

      const entries = await fsp.readdir(this.projectsDir, { withFileTypes: true });
      const projectDirs = entries.filter(d => d.isDirectory());

      // Parse projects with bounded concurrency (avoid subprocess spikes on big workspaces)
      const results = await this._mapLimit(projectDirs, 5, (dir) =>
        this._parseProject(path.join(this.projectsDir, dir.name), dir.name)
      );

      for (const session of results) {
        if (session) sessions.push(session);
      }
    } catch (err) {
      console.error('Session discovery error:', err.message);
    }

    // Sort by last activity, most recent first
    sessions.sort((a, b) => b.lastActivity - a.lastActivity);
    return sessions;
  }

  // Bounded-concurrency Promise.all: runs at most `limit` tasks in parallel
  async _mapLimit(items, limit, fn) {
    const results = new Array(items.length);
    let index = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (true) {
        const i = index++;
        if (i >= items.length) return;
        results[i] = await fn(items[i]);
      }
    });
    await Promise.all(workers);
    return results;
  }

  async _parseProject(projectPath, dirName) {
    try {
      const decodedPath = this._decodeDirName(dirName);
      const projectName = path.basename(decodedPath);

      // Find newest mtime among files in the .claude/projects/<dir> folder
      const files = await fsp.readdir(projectPath);
      let lastActivity = 0;

      const stats = await Promise.all(
        files.map(async (file) => {
          try {
            return await fsp.stat(path.join(projectPath, file));
          } catch {
            return null;
          }
        })
      );

      for (const stat of stats) {
        if (stat && stat.mtimeMs > lastActivity) {
          lastActivity = stat.mtimeMs;
        }
      }

      // Get git info (branch + dirty) — cached and async
      const gitInfo = await this._getGitInfo(decodedPath);

      // Status based on last activity
      const now = Date.now();
      const minutesAgo = (now - lastActivity) / 60000;
      let status = 'inactive';
      if (minutesAgo < 5) {
        status = 'active';
      } else if (minutesAgo < 60) {
        status = 'recent';
      }

      return {
        id: dirName,
        name: projectName,
        path: decodedPath,
        branch: gitInfo.branch,
        status,
        lastActivity,
        lastActivityFormatted: this._formatTime(lastActivity),
        dirty: gitInfo.dirty,
      };
    } catch {
      return null;
    }
  }

  _decodeDirName(name) {
    if (process.platform === 'win32') {
      let decoded = name;
      if (decoded.startsWith('-')) {
        decoded = decoded.substring(1);
      }
      decoded = decoded.replace('--', ':\\');
      decoded = decoded.replace(/-/g, '\\');
      return decoded;
    }
    return '/' + name.replace(/-/g, '/').replace(/^\/+/, '');
  }

  async _getGitInfo(projectPath) {
    // Check cache first
    const cached = this.gitCache.get(projectPath);
    if (cached && Date.now() - cached.cachedAt < this.gitCacheTTL) {
      return { branch: cached.branch, dirty: cached.dirty };
    }

    const info = { branch: null, dirty: false };

    // Try to read branch from .git/HEAD (fast, no subprocess)
    try {
      const headFile = path.join(projectPath, '.git', 'HEAD');
      const content = await fsp.readFile(headFile, 'utf-8');
      const trimmed = content.trim();
      if (trimmed.startsWith('ref: refs/heads/')) {
        info.branch = trimmed.replace('ref: refs/heads/', '');
      } else {
        info.branch = trimmed.substring(0, 8);
      }
    } catch {
      // Not a git repo or unreadable
      this.gitCache.set(projectPath, { ...info, cachedAt: Date.now() });
      return info;
    }

    // Get dirty status via async exec
    try {
      const { stdout } = await execAsync('git status --porcelain', {
        cwd: projectPath,
        timeout: 3000,
        windowsHide: true,
      });
      info.dirty = stdout.trim().length > 0;
    } catch {
      info.dirty = false;
    }

    this.gitCache.set(projectPath, { ...info, cachedAt: Date.now() });
    return info;
  }

  _formatTime(timestamp) {
    if (!timestamp) return 'Unknown';
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  }
}

module.exports = SessionDiscovery;
