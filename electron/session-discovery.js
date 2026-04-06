const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

class SessionDiscovery {
  constructor(opts = {}) {
    this.claudeDir = path.join(os.homedir(), '.claude');
    this.projectsDir = path.join(this.claudeDir, 'projects');
    // Dev root directories to scan for git projects (merged with sessions)
    this.devRoots = opts.devRoots || this._defaultDevRoots();
    // Project names to hide from dashboard (case-insensitive)
    this.skipList = (opts.skipList || []).map(s => s.toLowerCase());
    // Cache git status results: { projectPath: { branch, dirty, cachedAt } }
    this.gitCache = new Map();
    this.gitCacheTTL = 15000; // 15 seconds
  }

  setConfig({ devRoots, skipList }) {
    if (Array.isArray(devRoots)) this.devRoots = devRoots;
    if (Array.isArray(skipList)) this.skipList = skipList.map(s => s.toLowerCase());
  }

  _defaultDevRoots() {
    if (process.platform === 'win32') {
      return ['C:\\Dev'];
    }
    return [
      path.join(os.homedir(), 'dev'),
      path.join(os.homedir(), 'Projects'),
    ];
  }

  async discover() {
    // 1. Parse Claude Code sessions (authoritative cwd + activity timestamps)
    const sessions = await this._discoverSessions();

    // 2. Scan dev roots for git repos — adds projects without sessions
    const devProjects = await this._discoverDevProjects();

    // 3. Merge by path (case-insensitive on Windows); session data wins
    const byPath = new Map();
    for (const s of sessions) {
      byPath.set(this._pathKey(s.path), s);
    }
    for (const p of devProjects) {
      const key = this._pathKey(p.path);
      if (!byPath.has(key)) {
        byPath.set(key, p);
      }
    }

    // 4. Apply skip list (match against basename)
    const all = [...byPath.values()].filter(
      s => !this.skipList.includes(s.name.toLowerCase())
    );

    // Sort: sessions with activity first (newest → oldest), then alphabetical for inactive
    all.sort((a, b) => {
      if (a.lastActivity && b.lastActivity) return b.lastActivity - a.lastActivity;
      if (a.lastActivity) return -1;
      if (b.lastActivity) return 1;
      return a.name.localeCompare(b.name);
    });
    return all;
  }

  _pathKey(p) {
    return process.platform === 'win32' ? p.toLowerCase() : p;
  }

  async _discoverSessions() {
    const sessions = [];
    try {
      await fsp.access(this.projectsDir);
    } catch {
      return sessions;
    }
    try {
      const entries = await fsp.readdir(this.projectsDir, { withFileTypes: true });
      const projectDirs = entries.filter(d => d.isDirectory());
      const results = await this._mapLimit(projectDirs, 5, (dir) =>
        this._parseProject(path.join(this.projectsDir, dir.name), dir.name)
      );
      for (const session of results) {
        if (session) sessions.push(session);
      }
    } catch (err) {
      console.error('Session discovery error:', err.message);
    }
    return sessions;
  }

  async _discoverDevProjects() {
    const projects = [];
    for (const root of this.devRoots) {
      try {
        await fsp.access(root);
      } catch {
        continue; // Root doesn't exist
      }
      try {
        const entries = await fsp.readdir(root, { withFileTypes: true });
        const dirs = entries.filter(d => d.isDirectory() && !d.name.startsWith('.'));
        const results = await this._mapLimit(dirs, 5, async (dir) => {
          const projectPath = path.join(root, dir.name);
          // Only include directories that are git repos
          try {
            await fsp.access(path.join(projectPath, '.git'));
          } catch {
            return null;
          }
          const gitInfo = await this._getGitInfo(projectPath);
          return {
            id: `dev:${projectPath}`,
            name: dir.name,
            path: projectPath,
            branch: gitInfo.branch,
            status: 'inactive', // No active Claude session
            lastActivity: 0,
            lastActivityFormatted: 'No session',
            dirty: gitInfo.dirty,
          };
        });
        for (const p of results) {
          if (p) projects.push(p);
        }
      } catch (err) {
        console.error(`Dev root scan error (${root}):`, err.message);
      }
    }
    return projects;
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
      // Find newest mtime AND collect .jsonl files in one pass
      const files = await fsp.readdir(projectPath);
      let lastActivity = 0;
      const jsonlFiles = [];

      const stats = await Promise.all(
        files.map(async (file) => {
          try {
            const stat = await fsp.stat(path.join(projectPath, file));
            if (file.endsWith('.jsonl') && stat.isFile()) {
              jsonlFiles.push({ file, mtime: stat.mtimeMs });
            }
            return stat;
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

      // Resolve real project path: prefer cwd from transcript JSONL (authoritative),
      // fall back to naive dash-decoding only when no transcript is readable.
      const decodedPath =
        (await this._cwdFromTranscripts(projectPath, jsonlFiles)) ||
        this._decodeDirName(dirName);
      const projectName = path.basename(decodedPath);

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

  // Read the cwd field from the newest transcript JSONL. Claude Code writes
  // the absolute cwd into every message event — this is the only reliable way
  // to recover the real project path, because dirName encoding is ambiguous
  // (dashes are both path separators AND legal filename characters).
  async _cwdFromTranscripts(projectPath, jsonlFiles) {
    if (!jsonlFiles || jsonlFiles.length === 0) return null;
    // Sort newest first so we pick the most recent authoritative cwd
    jsonlFiles.sort((a, b) => b.mtime - a.mtime);

    for (const { file } of jsonlFiles) {
      try {
        const full = path.join(projectPath, file);
        // Only read the first ~8KB — cwd appears in the very first user message
        const fd = await fsp.open(full, 'r');
        try {
          const buf = Buffer.alloc(8192);
          const { bytesRead } = await fd.read(buf, 0, buf.length, 0);
          const text = buf.slice(0, bytesRead).toString('utf-8');
          const match = text.match(/"cwd"\s*:\s*"((?:\\.|[^"\\])*)"/);
          if (match && match[1]) {
            // Unescape JSON string (handles \\ → \)
            try {
              return JSON.parse(`"${match[1]}"`);
            } catch {
              return match[1].replace(/\\\\/g, '\\');
            }
          }
        } finally {
          await fd.close();
        }
      } catch {
        // Skip unreadable transcripts, try next
      }
    }
    return null;
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
