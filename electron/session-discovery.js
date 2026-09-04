const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const { promisify } = require('util');
const { getAgentSessionContract } = require('./agent-adapters');

const execAsync = promisify(exec);
const UNTRUSTED_AGENT_LAUNCH_REASON = 'Agent launch command requires confirmation before it can run.';
const CODEX_ROLLOUT_HEAD_BYTES = 16 * 1024;
const CODEX_ROLLOUT_RECENCY_DAYS = 45;
const CODEX_ROLLOUT_SCAN_LIMIT = 500;
const CODEX_ROLLOUT_MAX_DEPTH = 6;
const GEMINI_PROJECTS_BYTES = 256 * 1024;
const GEMINI_LOGS_BYTES = 512 * 1024;
// ~/.gemini/tmp entries that are never per-project session dirs: the bundled
// `bin/`, plus credential/account/history names guarded against by the allowlist.
const GEMINI_RESERVED_SLUGS = new Set(['bin', 'history', 'oauth_creds', 'google_accounts']);
const RESIDENT_PRESENCE_BYTES = 64 * 1024;
const RESIDENT_MANIFEST_BYTES = 256 * 1024;
const RESIDENT_PRESENCE_LIFECYCLES = {
  starting: 'running',
  working: 'running',
  waiting: 'idle',
  idle: 'idle',
  compacting: 'running',
  ended: 'offline',
  capsule_failed: 'offline',
  unknown: 'offline',
};

class SessionDiscovery {
  constructor(opts = {}) {
    this.claudeDir = opts.claudeDir || path.join(os.homedir(), '.claude');
    this.projectsDir = path.join(this.claudeDir, 'projects');
    this.codexSessionsDir = opts.codexSessionsDir || path.join(os.homedir(), '.codex', 'sessions');
    this.codexRolloutHeadBytes = this._positiveInteger(opts.codexRolloutHeadBytes, CODEX_ROLLOUT_HEAD_BYTES);
    this.codexRolloutRecencyDays = this._positiveInteger(opts.codexRolloutRecencyDays, CODEX_ROLLOUT_RECENCY_DAYS);
    this.codexRolloutScanLimit = this._positiveInteger(opts.codexRolloutScanLimit, CODEX_ROLLOUT_SCAN_LIMIT);
    this.geminiDir = opts.geminiDir || path.join(os.homedir(), '.gemini');
    this.geminiProjectsPath = path.join(this.geminiDir, 'projects.json');
    this.geminiTmpDir = path.join(this.geminiDir, 'tmp');
    this.geminiProjectsBytes = this._positiveInteger(opts.geminiProjectsBytes, GEMINI_PROJECTS_BYTES);
    this.geminiLogsBytes = this._positiveInteger(opts.geminiLogsBytes, GEMINI_LOGS_BYTES);
    this.fileBusRoot = opts.fileBusRoot || this._defaultFileBusRoot();
    this.managedAgentsRoot = opts.managedAgentsRoot === null
      ? null
      : (opts.managedAgentsRoot || path.join(os.homedir(), '.nock', 'agents'));
    // Dev root directories to scan for git projects (merged with sessions)
    this.defaultDevRoots = Array.isArray(opts.defaultDevRoots)
      ? opts.defaultDevRoots
      : this._defaultDevRoots();
    this.devRoots = this._effectiveDevRoots(opts.devRoots);
    // Project names to hide from dashboard (case-insensitive)
    this.skipList = (opts.skipList || []).map(s => s.toLowerCase());
    // Cache git status results: { projectPath: { branch, dirty, cachedAt } }
    this.gitCache = new Map();
    this.gitCacheTTL = 15000; // 15 seconds
  }

  setConfig({ devRoots, skipList }) {
    if (Array.isArray(devRoots)) this.devRoots = this._effectiveDevRoots(devRoots);
    if (Array.isArray(skipList)) this.skipList = skipList.map(s => s.toLowerCase());
  }

  _defaultDevRoots() {
    if (process.platform === 'win32') {
      return ['C:\\Dev'];
    }
    const home = os.homedir();
    return [
      path.join(home, 'Dev'),
      path.join(home, 'dev'),
      path.join(home, 'Projects'),
    ];
  }

  _effectiveDevRoots(devRoots) {
    const configuredRoots = Array.isArray(devRoots)
      ? devRoots
        .map(root => this._safeString(root, 1000))
        .filter(Boolean)
      : [];
    const roots = configuredRoots.length > 0 ? configuredRoots : this.defaultDevRoots;
    return [...new Set(
      roots
        .map(root => this._safeString(root, 1000))
        .filter(Boolean)
    )];
  }

  _defaultFileBusRoot() {
    if (process.env.CRM_ROOT) return process.env.CRM_ROOT;
    const instanceId = process.env.CRM_INSTANCE_ID || 'default';
    return path.join(os.homedir(), '.claude-remote', instanceId);
  }

  async discover() {
    // 1. Parse transcript sessions (authoritative cwd + activity timestamps)
    const sessions = [
      ...(await this._discoverSessions()),
      ...(await this._discoverCodexSessions()),
      ...(await this._discoverGeminiSessions()),
    ];

    // 2. Scan dev roots for git repos — adds projects without sessions
    const devProjects = await this._discoverDevProjects();

    // 3. Scan existing agent folders. These are not repos: opening them means
    // launching or inspecting that local agent persona.
    const agentFolders = await this._discoverAgentFolders(sessions.map(session => session.path));

    // 4. Merge by path (case-insensitive on Windows); session data wins for
    // generic project records, while agent folder metadata upgrades matching
    // Claude transcript rows into first-class agent rows.
    const byPath = new Map();
    for (const s of sessions) {
      const key = this._pathKey(s.path);
      const existing = byPath.get(key);
      if (!existing || (s.lastActivity || 0) >= (existing.lastActivity || 0)) {
        byPath.set(key, s);
      }
    }
    for (const p of devProjects) {
      const key = this._pathKey(p.path);
      if (!byPath.has(key)) {
        byPath.set(key, p);
      }
    }
    for (const a of agentFolders) {
      const key = this._pathKey(a.path);
      const existing = byPath.get(key);
      if (!existing) {
        byPath.set(key, a);
        continue;
      }
      const lastActivity = Math.max(existing.lastActivity || 0, a.lastActivity || 0);
      byPath.set(key, {
        ...existing,
        ...a,
        branch: a.branch || existing.branch,
        dirty: Boolean(existing.dirty || a.dirty),
        lastActivity,
        lastActivityFormatted: this._formatTime(lastActivity),
        status: this._strongestStatus(existing.status, a.status),
        claudeSessionId: existing.kind === 'agent' ? existing.claudeSessionId : existing.id,
      });
    }

    // 5. Apply skip list (match against basename) and drop ephemeral agent
    // worktree checkouts — transcript cwds inside .claude/worktrees or
    // .worktrees are session scratch space, not operator targets.
    const all = [...byPath.values()].filter(
      s => !this.skipList.includes(s.name.toLowerCase())
        && !this._isEphemeralWorktreePath(s.path)
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

  _strongestStatus(a, b) {
    const rank = { active: 3, recent: 2, inactive: 1 };
    return (rank[a] || 0) >= (rank[b] || 0) ? a : b;
  }

  _isEphemeralWorktreePath(p) {
    const normalized = String(p || '').replace(/\\/g, '/');
    return normalized.includes('/.claude/worktrees/') || normalized.includes('/.worktrees/');
  }

  _pathKey(p) {
    return process.platform === 'win32' ? p.toLowerCase() : p;
  }

  async _discoverSessions() {
    const sessions = [];
    try {
      await fsp.access(this.projectsDir);
    } catch (err) {
      this._debugDiscovery('Claude projects directory unavailable', { path: this.projectsDir, error: err });
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

  async _discoverCodexSessions() {
    const rolloutFiles = await this._collectCodexRolloutFiles();
    if (rolloutFiles.length === 0) return [];

    const cutoff = Date.now() - this.codexRolloutRecencyDays * 24 * 60 * 60 * 1000;
    const recentFiles = rolloutFiles
      .filter(file => file.mtimeMs >= cutoff)
      .sort((a, b) => b.mtimeMs - a.mtimeMs);

    const skippedByRecency = rolloutFiles.length - recentFiles.length;
    if (skippedByRecency > 0) {
      this._debugDiscovery('Skipped stale Codex rollouts', {
        count: skippedByRecency,
        recencyDays: this.codexRolloutRecencyDays,
      });
    }

    const scanFiles = recentFiles.slice(0, this.codexRolloutScanLimit);
    if (recentFiles.length > scanFiles.length) {
      this._debugDiscovery('Capped Codex rollout scan', {
        scanned: scanFiles.length,
        available: recentFiles.length,
      });
    }

    const results = await this._mapLimit(scanFiles, 8, file =>
      this._parseCodexRollout(file)
    );
    return this._dedupeCodexSessions(results.filter(Boolean));
  }

  async _collectCodexRolloutFiles() {
    try {
      await fsp.access(this.codexSessionsDir);
    } catch (err) {
      this._debugDiscovery('Codex sessions directory unavailable', {
        path: this.codexSessionsDir,
        error: err,
      });
      return [];
    }

    const files = [];
    const stack = [{ dir: this.codexSessionsDir, depth: 0 }];
    while (stack.length > 0) {
      const { dir, depth } = stack.pop();
      let entries = [];
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch (err) {
        this._debugDiscovery('Codex sessions directory scan failed', { path: dir, error: err });
        continue;
      }

      for (const entry of entries) {
        const entryPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (depth < CODEX_ROLLOUT_MAX_DEPTH && !entry.name.startsWith('.')) {
            stack.push({ dir: entryPath, depth: depth + 1 });
          }
          continue;
        }
        if (!entry.isFile() || !/^rollout-.*\.jsonl$/i.test(entry.name)) continue;

        try {
          const stat = await fsp.stat(entryPath);
          if (stat.isFile()) {
            files.push({ path: entryPath, mtimeMs: stat.mtimeMs });
          }
        } catch (err) {
          this._debugDiscovery('Codex rollout stat failed', { path: entryPath, error: err });
        }
      }
    }
    return files;
  }

  async _parseCodexRollout(rolloutFile) {
    const filePath = rolloutFile.path;
    try {
      const text = await this._readFileHead(filePath, this.codexRolloutHeadBytes);
      if (!text.trim()) {
        this._debugDiscovery('Codex rollout cwd unavailable', { path: filePath, reason: 'empty' });
        return null;
      }

      let sessionId = '';
      let cliVersion = '';
      let projectPath = '';
      let cwdSource = '';
      let eventTimestamp = 0;

      for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;

        let event;
        try {
          event = JSON.parse(line);
        } catch (err) {
          this._debugDiscovery('Codex rollout JSON parse failed', { path: filePath, error: err });
          continue;
        }

        if (!event || typeof event !== 'object' || Array.isArray(event)) continue;
        const payload = event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
          ? event.payload
          : {};
        eventTimestamp = this._timestampFromEvent(event, payload) || eventTimestamp;

        if (event.type === 'session_meta') {
          sessionId = this._safeString(payload.id || sessionId, 200);
          cliVersion = this._safeString(payload.cli_version || payload.cliVersion || cliVersion, 120);
          const cwd = this._safeProjectPath(payload.cwd);
          if (cwd) {
            projectPath = cwd;
            cwdSource = 'session_meta';
          }
        } else if (event.type === 'turn_context' && !projectPath) {
          const cwd = this._safeProjectPath(payload.cwd);
          if (cwd) {
            projectPath = cwd;
            cwdSource = 'turn_context';
          }
        }

        if (projectPath && sessionId) break;
      }

      if (!projectPath) {
        this._debugDiscovery('Codex rollout cwd unavailable', { path: filePath, reason: 'missing-cwd' });
        return null;
      }

      const sessionContract = getAgentSessionContract('codex');
      sessionContract.adapterId = 'codex';
      sessionContract.transcriptDiscovery = {
        ...(sessionContract.transcriptDiscovery || {}),
        filePath,
        sessionId,
        cliVersion,
        cwdSource,
      };

      // `codex resume <SESSION_ID>` takes the rollout UUID directly, so a
      // safe session id becomes a per-session resume launch in the project cwd.
      const resumable = /^[A-Za-z0-9-]{8,}$/.test(sessionId);
      let resumeLaunch;
      if (resumable) {
        const command = `codex resume ${sessionId}`;
        sessionContract.resumeCommand = {
          state: 'supported',
          command,
          notes: 'Resumes this Codex rollout session by id in the project working directory.',
        };
        resumeLaunch = this._buildResumeLaunch(command, projectPath);
      }

      const gitInfo = this._canInspectLocalPath(projectPath)
        ? await this._getGitInfo(projectPath)
        : { branch: null, dirty: false };
      const lastActivity = eventTimestamp || rolloutFile.mtimeMs || 0;

      return {
        id: `codex:${sessionId || path.basename(filePath, '.jsonl')}`,
        name: this._projectNameFromPath(projectPath),
        path: projectPath,
        branch: gitInfo.branch,
        status: this._statusFromActivity(lastActivity),
        lastActivity,
        lastActivityFormatted: this._formatTime(lastActivity),
        dirty: gitInfo.dirty,
        sessionContract,
        ...(resumable ? { codexSessionId: sessionId, launch: resumeLaunch } : {}),
      };
    } catch (err) {
      this._debugDiscovery('Codex rollout parse failed', { path: filePath, error: err });
      return null;
    }
  }

  // Shared shape for a transcript-derived resume launch (Claude/Codex/Gemini).
  // The row only resumes from an explicit affordance, never a plain click —
  // shouldRunSessionLaunch gates action:'resume' behind options.resume.
  _buildResumeLaunch(command, cwd) {
    return {
      mode: 'terminal',
      action: 'resume',
      actionLabel: 'Resume',
      capability: 'resume-command',
      canLaunch: true,
      command,
      cwd,
    };
  }

  _dedupeCodexSessions(sessions) {
    const byPath = new Map();
    for (const session of sessions) {
      const key = this._pathKey(session.path);
      const existing = byPath.get(key);
      if (!existing || (session.lastActivity || 0) >= (existing.lastActivity || 0)) {
        byPath.set(key, session);
      }
    }
    return [...byPath.values()];
  }

  async _discoverGeminiSessions() {
    const projects = await this._readGeminiProjectEntries();
    if (projects.length === 0) return [];

    const results = await this._mapLimit(projects, 5, project =>
      this._parseGeminiProject(project)
    );
    return this._dedupeGeminiSessions(results.filter(Boolean));
  }

  async _readGeminiProjectEntries() {
    const parsed = await this._readJsonFileCapped(
      this.geminiProjectsPath,
      this.geminiProjectsBytes,
      'Gemini projects file'
    );
    const projects = parsed?.value?.projects;
    if (!projects || typeof projects !== 'object' || Array.isArray(projects)) {
      if (parsed?.value) {
        this._debugDiscovery('Gemini projects file has unsupported shape', { path: this.geminiProjectsPath });
      }
      return [];
    }

    const entries = [];
    for (const [rawProjectPath, rawSlug] of Object.entries(projects)) {
      const projectPath = this._safeProjectPath(rawProjectPath);
      const slug = this._safeGeminiSlug(rawSlug);
      if (!slug) {
        this._debugDiscovery('Gemini project entry skipped', {
          path: rawProjectPath,
          slug: rawSlug,
          reason: 'invalid-slug',
        });
        continue;
      }
      entries.push({ projectPath, slug });
    }
    return entries;
  }

  async _parseGeminiProject({ projectPath, slug }) {
    if (!(await this._geminiSlugDirIsSafe(slug))) {
      this._debugDiscovery('Gemini slug dir skipped', { slug, reason: 'missing-or-symlinked' });
      return null;
    }
    const projectRootPath = await this._readGeminiProjectRoot(slug);
    const confirmedProjectPath = projectPath || projectRootPath;
    if (!confirmedProjectPath) {
      this._debugDiscovery('Gemini project cwd unavailable', { slug, reason: 'missing-project-path' });
      return null;
    }
    // A project keyed to the home directory itself is never a useful cockpit
    // row; exclude it structurally rather than relying on empty logs.
    if (this._pathKey(confirmedProjectPath) === this._pathKey(os.homedir())) {
      this._debugDiscovery('Gemini project skipped', { slug, reason: 'home-directory' });
      return null;
    }
    const promptLogPath = this._geminiPromptLogPath(slug);
    const promptLog = await this._readGeminiPromptLog(promptLogPath);
    if (!promptLog) return null;

    const sessionContract = getAgentSessionContract('gemini');
    sessionContract.adapterId = 'gemini';
    sessionContract.transcriptDiscovery = {
      ...(sessionContract.transcriptDiscovery || {}),
      projectPath: confirmedProjectPath,
      projectSlug: slug,
      projectRootPath,
      promptLogPath,
      sessionId: promptLog.sessionId,
      sessionCount: promptLog.sessionCount,
      lastActivitySource: promptLog.lastActivitySource,
    };

    // Gemini resumes by recency/index ("latest"), not by the session id we
    // recover — so we honestly offer "resume the latest session in this
    // project," which is the session this row already represents (max
    // activity). We never claim to resume a specific arbitrary session.
    const command = 'gemini --resume latest';
    sessionContract.resumeCommand = {
      state: 'conditional',
      evidence: 'gemini-latest-session',
      command,
      notes: 'Gemini resumes by recency, not session id; this resumes the most recent Gemini session in the project cwd.',
    };

    const gitInfo = this._canInspectLocalPath(confirmedProjectPath)
      ? await this._getGitInfo(confirmedProjectPath)
      : { branch: null, dirty: false };

    return {
      id: `gemini:${slug}:${promptLog.sessionId}`,
      name: this._projectNameFromPath(confirmedProjectPath),
      path: confirmedProjectPath,
      branch: gitInfo.branch,
      status: this._statusFromActivity(promptLog.lastActivity),
      lastActivity: promptLog.lastActivity,
      lastActivityFormatted: this._formatTime(promptLog.lastActivity),
      dirty: gitInfo.dirty,
      sessionContract,
      launch: this._buildResumeLaunch(command, confirmedProjectPath),
    };
  }

  async _readGeminiProjectRoot(slug) {
    const projectRootPath = this._geminiProjectRootPath(slug);
    try {
      return this._safeProjectPath(await fsp.readFile(projectRootPath, 'utf-8'));
    } catch (err) {
      this._debugDiscovery('Gemini project root unavailable', { path: projectRootPath, slug, error: err });
      return '';
    }
  }

  async _readGeminiPromptLog(promptLogPath) {
    const parsed = await this._readJsonFileCapped(
      promptLogPath,
      this.geminiLogsBytes,
      'Gemini prompt log'
    );
    if (!parsed) return null;
    if (!Array.isArray(parsed.value)) {
      this._debugDiscovery('Gemini prompt log has unsupported shape', { path: promptLogPath });
      return null;
    }

    const sessionIds = new Set();
    let latest = null;
    let firstSessionId = '';

    for (const record of parsed.value) {
      if (!record || typeof record !== 'object' || Array.isArray(record)) continue;
      const sessionId = this._safeGeminiSessionId(record.sessionId);
      if (!sessionId) continue;
      if (!firstSessionId) firstSessionId = sessionId;
      sessionIds.add(sessionId);

      const timestamp = this._timestampFromText(record.timestamp)
        || this._timestampFromText(record.created_at)
        || this._timestampFromText(record.createdAt);
      if (!timestamp) continue;
      if (!latest || timestamp > latest.timestamp) {
        latest = { sessionId, timestamp };
      }
    }

    if (sessionIds.size === 0) {
      this._debugDiscovery('Gemini prompt log has no session records', { path: promptLogPath });
      return null;
    }

    if (!latest) {
      const fallbackActivity = parsed.stat?.mtimeMs || 0;
      if (!fallbackActivity) {
        this._debugDiscovery('Gemini prompt log has no usable timestamps', { path: promptLogPath });
        return null;
      }
      return {
        sessionId: firstSessionId,
        sessionCount: sessionIds.size,
        lastActivity: fallbackActivity,
        lastActivitySource: 'mtime',
      };
    }

    return {
      sessionId: latest.sessionId,
      sessionCount: sessionIds.size,
      lastActivity: latest.timestamp,
      lastActivitySource: 'timestamp',
    };
  }

  async _readJsonFileCapped(filePath, byteLimit, label) {
    let stat;
    try {
      stat = await fsp.stat(filePath);
    } catch (err) {
      this._debugDiscovery(`${label} unavailable`, { path: filePath, error: err });
      return null;
    }
    if (!stat.isFile()) {
      this._debugDiscovery(`${label} skipped because path is not a file`, { path: filePath });
      return null;
    }
    if (stat.size > byteLimit) {
      this._debugDiscovery(`${label} skipped by size cap`, {
        path: filePath,
        size: stat.size,
        byteLimit,
      });
      return null;
    }

    let content;
    try {
      content = await fsp.readFile(filePath, 'utf-8');
    } catch (err) {
      this._debugDiscovery(`${label} unreadable`, { path: filePath, error: err });
      return null;
    }
    if (!content.trim()) {
      this._debugDiscovery(`${label} empty`, { path: filePath });
      return null;
    }

    try {
      return { value: JSON.parse(content), stat };
    } catch (err) {
      this._debugDiscovery(`${label} JSON parse failed`, { path: filePath, error: err });
      return null;
    }
  }

  _geminiProjectRootPath(slug) {
    return path.join(this.geminiTmpDir, slug, '.project_root');
  }

  _geminiPromptLogPath(slug) {
    return path.join(this.geminiTmpDir, slug, 'logs.json');
  }

  _safeGeminiSlug(value) {
    const slug = this._safeString(value, 200);
    if (!slug || slug === '.' || slug === '..') return '';
    if (slug.includes('/') || slug.includes('\\')) return '';
    if (GEMINI_RESERVED_SLUGS.has(slug.toLowerCase())) return '';
    return /^[A-Za-z0-9._-]+$/.test(slug) ? slug : '';
  }

  // The slug dir must be a real directory inside ~/.gemini/tmp, never a
  // symlink — a symlinked slug would let prompt-log reads escape the tmp tree.
  async _geminiSlugDirIsSafe(slug) {
    try {
      const stat = await fsp.lstat(path.join(this.geminiTmpDir, slug));
      return stat.isDirectory() && !stat.isSymbolicLink();
    } catch {
      return false;
    }
  }

  _safeGeminiSessionId(value) {
    const sessionId = this._safeString(value, 200);
    return /^[A-Za-z0-9._:-]+$/.test(sessionId) ? sessionId : '';
  }

  _dedupeGeminiSessions(sessions) {
    const byPath = new Map();
    for (const session of sessions) {
      const key = this._pathKey(session.path);
      const existing = byPath.get(key);
      if (!existing || (session.lastActivity || 0) >= (existing.lastActivity || 0)) {
        byPath.set(key, session);
      }
    }
    return [...byPath.values()];
  }

  async _discoverDevProjects() {
    const projects = [];
    for (const root of this.devRoots) {
      try {
        await fsp.access(root);
      } catch (err) {
        this._debugDiscovery('Dev root unavailable', { path: root, error: err });
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
          } catch (err) {
            this._debugDiscovery('Skipping non-git dev project', {
              path: projectPath,
              marker: path.join(projectPath, '.git'),
              error: err,
            });
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

  async _discoverAgentFolders(sessionPaths = []) {
    const configPaths = new Set();
    const configPathSources = new Map();
    const residentManifestPaths = new Set();
    const sessionConfigPaths = new Set();
    for (const sessionPath of sessionPaths) {
      const normalizedPath = this._safeString(sessionPath, 1000);
      if (!normalizedPath || !path.isAbsolute(normalizedPath)) continue;
      sessionConfigPaths.add(path.join(normalizedPath, 'config.json'));
    }
    await this._mapLimit([...sessionConfigPaths], 5, (configPath) =>
      this._addConfigIfReadable(configPaths, configPath, { source: 'session-path', sources: configPathSources })
    );

    if (this.managedAgentsRoot) {
      await this._addManagedResidentManifests(residentManifestPaths, this.managedAgentsRoot);
    }

    for (const root of this.devRoots) {
      try {
        await fsp.access(root);
      } catch (err) {
        this._debugDiscovery('Agent dev root unavailable', { path: root, error: err });
        continue;
      }
      for (const configPath of await this._candidateAgentConfigPaths(root)) {
        configPaths.add(configPath);
        if (!configPathSources.has(configPath)) configPathSources.set(configPath, 'dev-root');
      }
      for (const manifestPath of await this._candidateResidentManifestPaths(root)) {
        residentManifestPaths.add(manifestPath);
      }
    }

    const [configResults, residentResults] = await Promise.all([
      this._mapLimit([...configPaths], 5, (configPath) =>
        this._parseAgentFolder(configPath, { discoverySource: configPathSources.get(configPath) || 'dev-root' })
      ),
      this._mapLimit([...residentManifestPaths], 5, (manifestPath) =>
        this._parseResidentSeatManifest(manifestPath)
      ),
    ]);
    return this._dedupeAgentFolders([...configResults, ...residentResults].filter(Boolean));
  }

  _dedupeAgentFolders(agentFolders) {
    const byName = new Map();
    for (const agent of agentFolders) {
      const key = agent.agent?.name || agent.path;
      const existing = byName.get(key);
      if (!existing || this._agentFolderPriority(agent) > this._agentFolderPriority(existing)) {
        byName.set(key, agent);
      }
    }
    return [...byName.values()];
  }

  _agentFolderPriority(agent) {
    let score = 0;
    const normalizedPath = String(agent.path || '').replace(/\\/g, '/');
    if (agent.agent?.runtime === 'resident') score += 3000;
    if (agent.discoverySource === 'session-path') score += 1500;
    if (/\/claude-remote-manager\/agents\/[^/]+$/i.test(normalizedPath)) score += 1000;
    if (agent.launch?.canLaunch === true) score += 100;
    if (agent.agent?.enabled === true) score += 50;
    if (agent.agent?.lifecycle && agent.agent.lifecycle !== 'disabled') score += 25;
    const lastActivity = Number(agent.lastActivity) || 0;
    if (lastActivity > 0) {
      const ageHours = Math.floor((Date.now() - lastActivity) / (60 * 60 * 1000));
      score += Math.max(0, 24 - Math.max(0, ageHours));
    }
    return score;
  }

  async _candidateAgentConfigPaths(root) {
    const configs = new Set();
    if (this._isDispatchWorkspaceName(path.basename(root))) {
      return [];
    }

    await this._addConfigIfReadable(configs, path.join(root, 'config.json'));
    await this._addAgentConfigsFromRoot(configs, root);
    await this._addAgentConfigsFromRoot(configs, path.join(root, 'agents'));

    let entries = [];
    try {
      entries = await fsp.readdir(root, { withFileTypes: true });
    } catch (err) {
      this._debugDiscovery('Agent config candidate scan failed', { path: root, error: err });
      return [...configs];
    }

    const ignored = new Set(['.git', 'node_modules', 'dist', 'dist-react', 'build']);
    await this._mapLimit(
      entries.filter(entry =>
        entry.isDirectory()
        && !entry.name.startsWith('.')
        && !ignored.has(entry.name)
        && !this._isDispatchWorkspaceName(entry.name)
      ),
      5,
      async (entry) => {
        await this._addAgentConfigsFromRoot(configs, path.join(root, entry.name, 'agents'));
      }
    );

    return [...configs];
  }

  async _candidateResidentManifestPaths(root) {
    const manifests = new Set();
    if (this._isDispatchWorkspaceName(path.basename(root))) {
      return [];
    }

    await this._addResidentManifestsFromRoot(manifests, path.join(root, 'seats'));

    let entries = [];
    try {
      entries = await fsp.readdir(root, { withFileTypes: true });
    } catch (err) {
      this._debugDiscovery('Resident manifest candidate scan failed', { path: root, error: err });
      return [...manifests];
    }

    const ignored = new Set(['.git', 'node_modules', 'dist', 'dist-react', 'build']);
    await this._mapLimit(
      entries.filter(entry =>
        entry.isDirectory()
        && !entry.name.startsWith('.')
        && !ignored.has(entry.name)
        && !this._isDispatchWorkspaceName(entry.name)
      ),
      5,
      async (entry) => {
        await this._addResidentManifestsFromRoot(manifests, path.join(root, entry.name, 'seats'));
      }
    );

    return [...manifests];
  }

  _isDispatchWorkspaceName(name) {
    return /(?:^|-)dispatch$/i.test(String(name || ''));
  }

  async _addAgentConfigsFromRoot(configs, agentsRoot) {
    let entries = [];
    try {
      entries = await fsp.readdir(agentsRoot, { withFileTypes: true });
    } catch (err) {
      this._debugDiscovery('Agent config root scan failed', { path: agentsRoot, error: err });
      return;
    }

    await this._mapLimit(
      entries.filter(entry => entry.isDirectory() && !entry.name.startsWith('.')),
      5,
      async (entry) => {
        await this._addConfigIfReadable(configs, path.join(agentsRoot, entry.name, 'config.json'));
      }
    );
  }

  async _addResidentManifestsFromRoot(manifests, seatsRoot) {
    let entries = [];
    try {
      entries = await fsp.readdir(seatsRoot, { withFileTypes: true });
    } catch (err) {
      this._debugDiscovery('Resident manifest root scan failed', { path: seatsRoot, error: err });
      return;
    }

    await this._mapLimit(
      entries.filter(entry => entry.isFile() && /\.json$/i.test(entry.name)),
      5,
      async (entry) => {
        await this._addResidentManifestIfReadable(manifests, path.join(seatsRoot, entry.name));
      }
    );
  }

  async _addManagedResidentManifests(manifests, agentsRoot) {
    let entries = [];
    try {
      entries = await fsp.readdir(agentsRoot, { withFileTypes: true });
    } catch (err) {
      this._debugDiscovery('Managed agent root scan failed', { path: agentsRoot, error: err });
      return;
    }

    await this._mapLimit(
      entries.filter(entry => entry.isDirectory() && /^[a-z][a-z0-9-]{1,63}$/.test(entry.name)),
      5,
      async (entry) => {
        await this._addResidentManifestIfReadable(manifests, path.join(agentsRoot, entry.name, 'seat.json'));
      }
    );
  }

  async _addConfigIfReadable(configs, configPath, { source = '', sources = null } = {}) {
    try {
      const config = JSON.parse(await fsp.readFile(configPath, 'utf-8'));
      if (this._agentNameFromConfig(config)) {
        configs.add(configPath);
        if (sources && source && !sources.has(configPath)) sources.set(configPath, source);
        return;
      }
      this._debugIgnoredAgentConfig(configPath, 'missing valid agent_name');
    } catch (err) {
      if (!['ENOENT', 'ENOTDIR'].includes(err?.code)) {
        this._debugIgnoredAgentConfig(configPath, 'unreadable or invalid JSON');
      }
    }
  }

  async _addResidentManifestIfReadable(manifests, manifestPath) {
    try {
      const manifest = JSON.parse(await this._readFileHead(manifestPath, RESIDENT_MANIFEST_BYTES));
      if (this._residentAgentNameFromManifest(manifest)) {
        manifests.add(manifestPath);
        return;
      }
      this._debugDiscovery('Ignored resident manifest', { path: manifestPath, reason: 'missing resident seat fields' });
    } catch (err) {
      if (!['ENOENT', 'ENOTDIR'].includes(err?.code)) {
        this._debugDiscovery('Ignored resident manifest', { path: manifestPath, reason: 'unreadable or invalid JSON' });
      }
    }
  }

  async _parseAgentFolder(configPath, { discoverySource = 'dev-root' } = {}) {
    try {
      const agentPath = path.dirname(configPath);
      const dirName = path.basename(agentPath);
      const config = JSON.parse(await fsp.readFile(configPath, 'utf-8'));
      const agentName = this._agentNameFromConfig(config);
      if (!agentName) {
        this._debugIgnoredAgentConfig(configPath, 'missing valid agent_name');
        return null;
      }

      const enabled = config.enabled !== false;
      const agentRuntime = this._agentRuntimeFromConfig(config);
      const dispatchLaunch = await this._resolveDispatchLaunch(agentPath, config, agentName, agentRuntime);
      const launchCwd = dispatchLaunch?.cwd || this._resolveAgentLaunchCwd(config, agentPath);
      const crmAttachCommand = dispatchLaunch ? '' : this._resolveCrmAgentAttachCommand(agentPath, agentName);
      const launchCommand = dispatchLaunch
        ? ''
        : (enabled ? this._resolveAgentLaunchCommand(config, agentName, agentPath, crmAttachCommand) : '');
      const sessionContract = this._resolveAgentSessionContract({
        agentName,
        agentRuntime,
        agentPath,
        enabled,
        dispatchLaunch,
        launchCommand,
        launchCwd,
        crmAttachCommand,
      });
      const terminalLaunch = this._terminalLaunchDescriptor({
        agentName,
        agentPath,
        enabled,
        launchCommand,
        launchCwd,
        crmAttachCommand,
      });
      const runtime = await this._getAgentRuntimeState(agentName, dirName, config, enabled, Boolean(dispatchLaunch));
      const gitInfo = await this._getGitInfo(agentPath);
      const lastActivity = runtime.lastActivity || 0;

      return {
        id: `agent:${agentPath}`,
        kind: 'agent',
        name: this._formatAgentName(agentName),
        path: agentPath,
        branch: gitInfo.branch,
        status: this._statusFromAgentLifecycle(runtime.lifecycle),
        lastActivity,
        lastActivityFormatted: this._formatTime(lastActivity),
        dirty: gitInfo.dirty,
        discoverySource,
        agent: {
          name: agentName,
          enabled,
          lifecycle: runtime.lifecycle,
          runtime: agentRuntime,
          launchType: dispatchLaunch ? 'dispatch' : 'terminal',
          model: this._safeString(config.model, 120),
          workingDirectory: this._resolveAgentLaunchCwd(config, agentPath),
          cronCount: Array.isArray(config.crons) ? config.crons.length : 0,
          unreadCount: runtime.unreadCount,
          inflightCount: runtime.inflightCount,
          aliases: runtime.aliases,
          lastHeartbeat: runtime.lastHeartbeat,
        },
        launch: dispatchLaunch || {
          mode: 'terminal',
          command: launchCommand,
          cwd: launchCwd,
          canLaunch: terminalLaunch.canLaunch,
          disabledReason: terminalLaunch.disabledReason,
          action: terminalLaunch.action,
          actionLabel: terminalLaunch.actionLabel,
          capability: terminalLaunch.capability,
        },
        sessionContract,
      };
    } catch (err) {
      this._debugDiscovery('Agent folder parse failed', { path: configPath, error: err });
      return null;
    }
  }

  async _parseResidentSeatManifest(manifestPath) {
    try {
      const manifest = JSON.parse(await this._readFileHead(manifestPath, RESIDENT_MANIFEST_BYTES));
      const agentName = this._residentAgentNameFromManifest(manifest);
      if (!agentName) {
        this._debugDiscovery('Ignored resident manifest', { path: manifestPath, reason: 'missing resident seat fields' });
        return null;
      }

      const manifestDir = path.dirname(manifestPath);
      const homePath = this._resolveManifestPath(manifest.home || manifest.work_dir || manifest.workDir, manifestDir);
      const workDir = this._resolveManifestPath(manifest.work_dir || manifest.workDir || manifest.home, manifestDir);
      const stateDir = this._resolveManifestPath(
        manifest.state_dir || manifest.stateDir || (homePath ? path.join(homePath, 'state', 'resident') : ''),
        manifestDir
      );
      const presenceDir = this._resolveManifestPath(
        manifest.presence_dir || manifest.presenceDir || (stateDir ? path.join(stateDir, 'presence') : ''),
        manifestDir
      );
      const controlSocket = this._safeString(manifest.control_socket || manifest.controlSocket, 1000);
      const tmuxSocket = this._safeString(manifest.tmux?.socket, 1000);
      const journalPath = stateDir ? path.join(stateDir, 'journal.db') : '';
      const launchCwd = workDir || homePath || manifestDir;
      const attachCommand = this._resolveResidentTmuxAttachCommand(manifest);
      const [tmuxSocketReachable, controlSocketReachable] = await Promise.all([
        this._localPathReadable(tmuxSocket),
        this._localPathReadable(controlSocket),
      ]);
      const terminalLaunch = this._residentLaunchDescriptor(attachCommand, { tmuxSocketReachable });
      const presence = await this._readResidentPresence(presenceDir);
      const lifecycle = this._residentLifecycleFromPresenceStatus(presence.status);
      const runtime = manifest.runtime && typeof manifest.runtime === 'object' && !Array.isArray(manifest.runtime)
        ? manifest.runtime
        : {};
      const gitInfo = await this._getGitInfo(homePath || workDir || manifestDir);
      const lastActivity = presence.lastActivity || 0;
      const sessionContract = this._resolveResidentSessionContract({
        attachCommand,
        controlSocket,
        journalPath,
        manifestPath,
        presenceAvailable: presence.available,
        presencePath: presence.path,
        tmuxSession: this._safeString(manifest.tmux?.session, 200),
        tmuxSocket,
        tmuxSocketReachable,
        controlSocketReachable,
      });

      return {
        id: `resident:${manifestPath}`,
        kind: 'agent',
        name: this._formatAgentName(agentName),
        path: homePath || workDir || manifestDir,
        branch: gitInfo.branch,
        status: this._statusFromAgentLifecycle(lifecycle),
        lastActivity,
        lastActivityFormatted: this._formatTime(lastActivity),
        dirty: gitInfo.dirty,
        agent: {
          name: agentName,
          enabled: true,
          lifecycle,
          runtime: 'resident',
          launchType: 'resident',
          model: this._safeString(runtime.model, 120),
          workingDirectory: launchCwd,
          cronCount: 0,
          unreadCount: 0,
          inflightCount: 0,
          aliases: [agentName],
          lastHeartbeat: lastActivity || null,
          presenceStatus: presence.status,
          presenceLastEvent: presence.lastEvent,
          presenceSessionId: presence.sessionId,
          controlSocket,
          tmuxSocket,
          tmuxSession: this._safeString(manifest.tmux?.session, 200),
        },
        launch: {
          mode: 'terminal',
          command: attachCommand,
          cwd: launchCwd,
          canLaunch: terminalLaunch.canLaunch,
          disabledReason: terminalLaunch.disabledReason,
          action: terminalLaunch.action,
          actionLabel: terminalLaunch.actionLabel,
          capability: terminalLaunch.capability,
        },
        sessionContract,
      };
    } catch (err) {
      this._debugDiscovery('Resident manifest parse failed', { path: manifestPath, error: err });
      return null;
    }
  }

  _safeAgentName(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return /^[a-z0-9_-]{1,100}$/.test(normalized) ? normalized : '';
  }

  _agentNameFromConfig(config) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) return '';
    return this._safeAgentName(config.agent_name);
  }

  _residentAgentNameFromManifest(manifest) {
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return '';
    const agentName = this._safeAgentName(manifest.agent || manifest.agent_name);
    if (!agentName) return '';
    const runtime = manifest.runtime && typeof manifest.runtime === 'object' && !Array.isArray(manifest.runtime)
      ? manifest.runtime
      : {};
    const adapter = this._safeString(runtime.adapter, 120);
    const tmuxSocket = this._safeString(manifest.tmux?.socket, 1000);
    const tmuxSession = this._safeString(manifest.tmux?.session, 200);
    const controlSocket = this._safeString(manifest.control_socket || manifest.controlSocket, 1000);
    if (adapter !== 'claude-code-interactive') return '';
    if (!tmuxSocket || !tmuxSession || !controlSocket) return '';
    return agentName;
  }

  _debugIgnoredAgentConfig(configPath, reason) {
    this._debugDiscovery('Ignored agent config', { path: configPath, reason });
  }

  _debugDiscovery(message, context = {}) {
    if (process.env.NOCK_DEBUG_DISCOVERY !== '1') return;
    const details = Object.entries(context)
      .map(([key, value]) => {
        if (value == null || value === '') return '';
        if (value instanceof Error) return `${key}=${value.code || value.message}`;
        if (key === 'error' && value?.message) return `${key}=${value.code || value.message}`;
        return `${key}=${String(value)}`;
      })
      .filter(Boolean)
      .join(' ');
    console.debug(`[session-discovery] ${message}${details ? `: ${details}` : ''}`);
  }

  _safeString(value, maxLength = 500) {
    if (typeof value !== 'string') return '';
    return value.trim().slice(0, maxLength);
  }

  _positiveInteger(value, fallback) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }

  async _readFileHead(filePath, byteLimit) {
    const fd = await fsp.open(filePath, 'r');
    try {
      const buf = Buffer.alloc(byteLimit);
      const { bytesRead } = await fd.read(buf, 0, buf.length, 0);
      return buf.slice(0, bytesRead).toString('utf-8');
    } finally {
      await fd.close();
    }
  }

  _timestampFromEvent(event, payload = {}) {
    return this._timestampFromText(payload.timestamp)
      || this._timestampFromText(event.timestamp)
      || this._timestampFromText(event.created_at)
      || null;
  }

  _safeProjectPath(value) {
    const text = this._safeString(value, 2000);
    if (!text) return '';
    if (path.isAbsolute(text) || this._isWindowsAbsolutePath(text)) return text;
    return '';
  }

  _isWindowsAbsolutePath(value) {
    return /^[A-Za-z]:[\\/]/.test(String(value || '')) || /^\\\\[^\\]+\\[^\\]+/.test(String(value || ''));
  }

  _canInspectLocalPath(value) {
    const text = this._safeProjectPath(value);
    if (!text) return false;
    if (process.platform === 'win32') return true;
    return path.isAbsolute(text) && !this._isWindowsAbsolutePath(text);
  }

  _projectNameFromPath(value) {
    const trimmed = String(value || '').replace(/[\\/]+$/, '');
    const parts = trimmed.split(/[\\/]+/).filter(Boolean);
    return parts[parts.length - 1] || trimmed || 'Project';
  }

  _statusFromActivity(lastActivity) {
    if (!lastActivity) return 'inactive';
    const minutesAgo = (Date.now() - lastActivity) / 60000;
    if (minutesAgo < 5) return 'active';
    if (minutesAgo < 60) return 'recent';
    return 'inactive';
  }

  _formatAgentName(agentName) {
    return String(agentName || '')
      .split(/[-_]/)
      .filter(Boolean)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  _resolveAgentLaunchCommand(config, agentName, _agentPath = '', crmAttachCommand = '') {
    const candidates = [
      config.launch_command,
      config.launchCommand,
      config.command,
      config.start_command,
      config.startCommand,
      config.launch?.command,
    ];
    for (const candidate of candidates) {
      const command = this._safeString(candidate, 500);
      if (command) return command;
    }
    if (crmAttachCommand) return crmAttachCommand;
    return this._safeAgentName(agentName) || this._formatAgentName(agentName).replace(/\s+/g, '');
  }

  _terminalLaunchDescriptor({ agentName, agentPath, enabled, launchCommand, crmAttachCommand }) {
    if (!enabled || !launchCommand) {
      return {
        action: 'unavailable',
        actionLabel: 'Unavailable',
        capability: 'none',
        canLaunch: false,
        disabledReason: enabled ? 'Agent launch command is missing' : 'Agent is disabled',
      };
    }
    const attachCommand = crmAttachCommand || this._resolveCrmAgentAttachCommand(agentPath, agentName);
    if (attachCommand && launchCommand === attachCommand) {
      return {
        action: 'attach',
        actionLabel: 'Attach',
        capability: 'live-attach',
        canLaunch: true,
        disabledReason: '',
      };
    }
    return {
      action: 'launch',
      actionLabel: 'Launch',
      capability: 'folder-launch',
      canLaunch: false,
      disabledReason: UNTRUSTED_AGENT_LAUNCH_REASON,
    };
  }

  _resolveAgentSessionContract({
    agentName,
    agentRuntime,
    agentPath,
    enabled,
    dispatchLaunch,
    launchCommand,
    launchCwd,
    crmAttachCommand,
  }) {
    if (dispatchLaunch) {
      const contract = getAgentSessionContract('dispatch-agent');
      contract.adapterId = `${agentRuntime || 'dispatch'}-dispatch`;
      contract.dispatchRequest = {
        ...(contract.dispatchRequest || {}),
        state: dispatchLaunch.canLaunch ? 'supported' : 'unsupported',
        broker: dispatchLaunch.broker,
        dispatcher: dispatchLaunch.dispatcher,
        scriptPath: dispatchLaunch.scriptPath,
        aliasPath: dispatchLaunch.aliasPath,
        disabledReason: dispatchLaunch.disabledReason,
      };
      return contract;
    }

    const contract = getAgentSessionContract('local-agent-folder');
    contract.adapterId = 'local-agent-folder';
    const attachCommand = crmAttachCommand || this._resolveCrmAgentAttachCommand(agentPath, agentName);
    const canAttach = Boolean(enabled && launchCommand && attachCommand && launchCommand === attachCommand);
    contract.liveAttach = {
      ...(contract.liveAttach || {}),
      state: canAttach ? 'supported' : 'unsupported',
      command: canAttach ? launchCommand : '',
      evidence: canAttach ? 'crm-tmux-session-name' : '',
      disabledReason: canAttach ? '' : 'No deterministic live attach target was resolved for this agent folder.',
    };
    contract.resumeCommand = {
      ...(contract.resumeCommand || {}),
      state: canAttach ? 'supported' : 'unsupported',
      command: canAttach ? launchCommand : '',
      evidence: canAttach ? 'crm-tmux-session-name' : '',
      disabledReason: canAttach ? '' : 'No deterministic resume command was resolved for this agent folder.',
    };
    contract.folderLaunch = {
      ...(contract.folderLaunch || {}),
      state: enabled && launchCommand && !canAttach ? 'conditional' : 'unsupported',
      command: launchCommand || '',
      cwd: launchCwd || agentPath,
      disabledReason: enabled && launchCommand && !canAttach
        ? UNTRUSTED_AGENT_LAUNCH_REASON
        : 'No trusted folder launch command was resolved for this agent folder.',
    };
    return contract;
  }

  _resolveCrmAgentAttachCommand(agentPath, agentName) {
    if (process.platform === 'win32') return '';
    const safeAgent = this._safeAgentName(agentName);
    if (!safeAgent) return '';
    const normalizedPath = String(agentPath || '').replace(/\\/g, '/');
    if (!/\/claude-remote-manager\/agents\/[^/]+$/i.test(normalizedPath)) return '';
    const instanceId = this._safeAgentName(process.env.CRM_INSTANCE_ID || 'default') || 'default';
    return `tmux attach -t crm-${instanceId}-${safeAgent}`;
  }

  _resolveResidentTmuxAttachCommand(manifest) {
    if (process.platform === 'win32') return '';
    const socket = this._safeString(manifest?.tmux?.socket, 1000);
    const session = this._safeString(manifest?.tmux?.session, 200);
    if (!path.isAbsolute(socket) || !/^[A-Za-z0-9_.:-]{1,200}$/.test(session)) return '';
    return `tmux -S ${this._shellToken(socket)} attach -t ${this._shellToken(`=${session}`)}`;
  }

  _residentLaunchDescriptor(attachCommand, { tmuxSocketReachable = false } = {}) {
    if (!attachCommand) {
      return {
        action: 'unavailable',
        actionLabel: 'Unavailable',
        capability: 'none',
        canLaunch: false,
        disabledReason: 'Resident tmux attach target is missing or unsupported on this platform',
      };
    }
    if (!tmuxSocketReachable) {
      return {
        action: 'attach',
        actionLabel: 'Attach',
        capability: 'resident-live-attach',
        canLaunch: false,
        disabledReason: 'Resident tmux socket is not reachable from this machine.',
      };
    }
    return {
      action: 'attach',
      actionLabel: 'Attach',
      capability: 'resident-live-attach',
      canLaunch: true,
      disabledReason: '',
    };
  }

  _resolveResidentSessionContract({
    attachCommand,
    controlSocket,
    journalPath,
    manifestPath,
    presenceAvailable,
    presencePath,
    tmuxSession,
    tmuxSocket,
    tmuxSocketReachable,
    controlSocketReachable,
  }) {
    const contract = getAgentSessionContract('resident-agent');
    contract.adapterId = 'resident-agent';
    contract.liveAttach = {
      ...(contract.liveAttach || {}),
      state: attachCommand ? (tmuxSocketReachable ? 'supported' : 'conditional') : 'unsupported',
      command: attachCommand || '',
      evidence: attachCommand ? 'resident-tmux-manifest' : '',
      tmuxSocket: tmuxSocket || '',
      tmuxSession: tmuxSession || '',
      disabledReason: attachCommand
        ? (tmuxSocketReachable ? '' : 'Resident tmux socket is configured but not reachable from this machine.')
        : 'No deterministic resident tmux attach target was resolved.',
    };
    contract.resumeCommand = {
      ...(contract.resumeCommand || {}),
      state: 'unsupported',
      command: '',
      disabledReason: 'Resident seats do not use SDK wake/resume turns; use live attach or control-socket actions.',
    };
    contract.folderLaunch = {
      ...(contract.folderLaunch || {}),
      state: 'unsupported',
      command: '',
      disabledReason: 'Resident seats are supervised by residentd; Nock Terminal must not launch them as folder commands.',
    };
    contract.residentControl = {
      ...(contract.residentControl || {}),
      state: controlSocket ? (controlSocketReachable ? 'supported' : 'conditional') : 'unsupported',
      controlSocket: controlSocket || '',
      actions: ['status', 'receipt', 'pause', 'resume', 'restart', 'steer', 'rotate'],
      disabledReason: controlSocket && !controlSocketReachable
        ? 'Resident control socket is configured but not reachable from this machine.'
        : '',
      notes: 'Mutating resident control actions require non-empty request ids and are idempotent by effect ledger.',
    };
    contract.presence = {
      ...(contract.presence || {}),
      state: presencePath ? (presenceAvailable ? 'supported' : 'conditional') : 'unsupported',
      path: presencePath || '',
      notes: 'Presence is hook-derived liveness; do not infer state from process tables or pane scraping.',
    };
    contract.journal = {
      ...(contract.journal || {}),
      state: journalPath ? 'conditional' : 'unsupported',
      path: journalPath || '',
      access: 'read-only',
      notes: 'Resident journal is optional telemetry. It must be opened read-only and deduped by external id.',
    };
    contract.manifestPath = manifestPath;
    return contract;
  }

  _resolveAgentLaunchCwd(config, agentPath) {
    const raw = this._safeString(config.working_directory || config.workingDirectory, 1000);
    if (!raw) return agentPath;
    return path.isAbsolute(raw) ? raw : path.resolve(agentPath, raw);
  }

  _resolveManifestPath(value, baseDir) {
    const raw = this._safeString(value, 1000);
    if (!raw) return '';
    return path.isAbsolute(raw) ? raw : path.resolve(baseDir, raw);
  }

  _agentRuntimeFromConfig(config) {
    const runtime = this._safeString(
      config.agent_runtime || config.agentRuntime || config.runtime,
      80
    ).toLowerCase();
    return ['codex', 'deepseek'].includes(runtime) ? runtime : '';
  }

  async _resolveDispatchLaunch(agentPath, config, agentName, agentRuntime) {
    if (!agentRuntime) return null;

    const scriptName = agentRuntime === 'deepseek' ? 'dispatch-deepseek.sh' : 'dispatch-codex.sh';
    const dispatchRoot = await this._findDispatchRoot(agentPath, scriptName);
    const scriptPath = dispatchRoot ? path.join(dispatchRoot, 'core', 'scripts', scriptName) : '';
    const aliasPath = scriptPath ? await this._findDispatchAliasPath(agentPath, agentName) : '';
    const directScriptPath = aliasPath || scriptPath;
    const allowlist = scriptPath ? await this._readDispatchAllowlist(scriptPath) : [];
    const allowed = allowlist.includes(agentName);
    const disabledReason = !scriptPath
      ? `${scriptName} was not found for this agent runtime`
      : (allowed ? '' : `${agentName} is not allowlisted in ${scriptName}`);
    const aliasCommand = aliasPath
      ? path.relative(dispatchRoot || path.dirname(aliasPath), aliasPath)
      : `${scriptName} --agent ${agentName}`;

    return {
      mode: 'dispatch',
      command: '',
      cwd: dispatchRoot || this._resolveAgentLaunchCwd(config, agentPath),
      canLaunch: allowed,
      disabledReason,
      action: 'dispatch',
      actionLabel: 'Dispatch',
      capability: 'dispatch-request',
      broker: this._safeAgentName(config.broker_agent || config.brokerAgent) || 'mira-nockos',
      dispatcher: agentRuntime,
      runtime: agentRuntime,
      scriptPath,
      aliasPath,
      aliasCommand,
      directScriptPath,
      directAgentBound: Boolean(aliasPath),
      commandTemplate: directScriptPath
        ? `${this._shellToken(directScriptPath)}${aliasPath ? '' : ` --agent ${this._shellToken(agentName)}`} --payload-file <payload-file>`
        : '',
      directMode: scriptPath ? 'available' : 'missing-script',
    };
  }

  async _findDispatchAliasPath(agentPath, agentName) {
    const aliasPath = path.join(agentPath, 'scripts', `dispatch-${agentName}.sh`);
    try {
      await fsp.access(aliasPath);
      return aliasPath;
    } catch (err) {
      this._debugDiscovery('Dispatch alias unavailable', { path: aliasPath, agentName, error: err });
      return '';
    }
  }

  async _findDispatchRoot(agentPath, scriptName) {
    let current = agentPath;
    for (let i = 0; i < 10; i += 1) {
      const scriptPath = path.join(current, 'core', 'scripts', scriptName);
      try {
        await fsp.access(scriptPath);
        return current;
      } catch (err) {
        this._debugDiscovery('Dispatch root script unavailable', { path: scriptPath, scriptName, error: err });
        const parent = path.dirname(current);
        if (!parent || parent === current) return '';
        current = parent;
      }
    }
    return '';
  }

  async _readDispatchAllowlist(scriptPath) {
    try {
      const content = await fsp.readFile(scriptPath, 'utf-8');
      const match = content.match(/ALLOWED_AGENTS=\(([\s\S]*?)\)/);
      if (!match) return [];
      return (match[1].match(/"[^"]+"|'[^']+'|[^\s]+/g) || [])
        .map(token => token.replace(/^['"]|['"]$/g, ''))
        .map(token => this._safeAgentName(token))
        .filter(Boolean);
    } catch (err) {
      this._debugDiscovery('Dispatch allowlist unreadable', { path: scriptPath, error: err });
      return [];
    }
  }

  _shellToken(value) {
    const text = String(value || '');
    if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(text)) return text;
    return `'${text.replace(/'/g, `'\\''`)}'`;
  }

  async _getAgentRuntimeState(agentName, dirName, config, enabled, isDispatchAgent = false) {
    const aliases = this._agentAliases(agentName, dirName, config);
    if (isDispatchAgent) {
      return {
        aliases,
        lifecycle: 'dispatch',
        unreadCount: 0,
        inflightCount: 0,
        lastActivity: 0,
        lastHeartbeat: null,
      };
    }

    if (!enabled) {
      return {
        aliases,
        lifecycle: 'disabled',
        unreadCount: 0,
        inflightCount: 0,
        lastActivity: 0,
        lastHeartbeat: null,
      };
    }

    const [inbox, inflight, heartbeat, stats, livePid] = await Promise.all([
      this._countBusFiles('inbox', aliases),
      this._countBusFiles('inflight', aliases),
      this._latestHeartbeat(aliases),
      this._readAgentStats(aliases),
      this._hasLiveAgentPid(aliases),
    ]);
    const lastHeartbeat = heartbeat || stats.lastChecked || null;
    const lastActivity = Math.max(
      lastHeartbeat || 0,
      inbox.lastActivity || 0,
      inflight.lastActivity || 0
    );
    const thresholdMs = this._agentStaleThresholdMs(config);
    const heartbeatAge = lastHeartbeat ? Date.now() - lastHeartbeat : Infinity;

    let lifecycle = 'offline';
    if (lastHeartbeat && heartbeatAge <= thresholdMs) {
      lifecycle = stats.agentState === 'idle' ? 'idle' : 'running';
    } else if (livePid) {
      lifecycle = stats.agentState === 'idle' ? 'idle' : 'running';
    } else if (lastHeartbeat && heartbeatAge <= 24 * 60 * 60 * 1000) {
      lifecycle = 'stale';
    }

    return {
      aliases,
      lifecycle,
      unreadCount: inbox.count,
      inflightCount: inflight.count,
      lastActivity,
      lastHeartbeat,
    };
  }

  _agentAliases(agentName, dirName, config) {
    const aliases = new Set([agentName, this._safeAgentName(dirName)]);
    for (const key of ['nockcc_agent_name', 'nockccAgentName', 'surface', 'author_surface']) {
      const value = this._safeAgentName(config[key]);
      if (value) aliases.add(value);
    }
    // Mira is the renamed local folder/persona, while some NockCC substrate
    // surfaces still use the older mara-nockos id.
    if (aliases.has('mira')) aliases.add('mara-nockos');
    if (aliases.has('mara')) aliases.add('mara-chat');
    return [...aliases].filter(Boolean);
  }

  _agentStaleThresholdMs(config) {
    const seconds = Number(config.passive_frozen_threshold || config.stale_threshold_seconds || 1200);
    if (!Number.isFinite(seconds) || seconds <= 0) return 20 * 60 * 1000;
    return Math.max(5 * 60 * 1000, seconds * 1000);
  }

  _statusFromAgentLifecycle(lifecycle) {
    if (['running', 'idle', 'working', 'waiting', 'starting', 'compacting'].includes(lifecycle)) return 'active';
    if (lifecycle === 'stale') return 'recent';
    return 'inactive';
  }

  _residentLifecycleFromPresenceStatus(status) {
    const normalized = this._safeString(status, 80).toLowerCase();
    return RESIDENT_PRESENCE_LIFECYCLES[normalized] || 'offline';
  }

  async _readResidentPresence(presenceDir) {
    const presencePath = presenceDir ? path.join(presenceDir, 'presence.json') : '';
    const fallback = {
      status: 'unknown',
      lastActivity: 0,
      lastEvent: '',
      sessionId: '',
      path: presencePath,
      available: false,
    };
    if (!presencePath) return fallback;

    try {
      const stat = await fsp.stat(presencePath);
      if (!stat.isFile() || stat.size > RESIDENT_PRESENCE_BYTES) return fallback;
      const presence = JSON.parse(await fsp.readFile(presencePath, 'utf-8'));
      const status = this._safeString(presence.status, 80).toLowerCase() || 'unknown';
      const timestamp = this._timestampFromText(
        presence.updated_at || presence.updatedAt || presence.timestamp || presence.last_event_at || presence.lastEventAt
      );
      return {
        status: RESIDENT_PRESENCE_LIFECYCLES[status] ? status : 'unknown',
        lastActivity: timestamp || stat.mtimeMs || 0,
        lastEvent: this._safeString(presence.last_event || presence.lastEvent, 120),
        sessionId: this._safeString(presence.session_id || presence.sessionId, 200),
        path: presencePath,
        available: true,
      };
    } catch (err) {
      this._debugDiscovery('Resident presence unavailable', { path: presencePath, error: err });
      return fallback;
    }
  }

  async _localPathReadable(filePath) {
    const normalized = this._safeString(filePath, 1000);
    if (!normalized || !path.isAbsolute(normalized)) return false;
    try {
      await fsp.access(normalized);
      return true;
    } catch (err) {
      this._debugDiscovery('Local resident endpoint unavailable', { path: normalized, error: err });
      return false;
    }
  }

  async _countBusFiles(kind, aliases) {
    let count = 0;
    let lastActivity = 0;
    for (const alias of aliases) {
      const dir = path.join(this.fileBusRoot, kind, alias);
      try {
        const entries = await fsp.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isFile() || entry.name.startsWith('.')) continue;
          count += 1;
          try {
            const itemPath = path.join(dir, entry.name);
            const stat = await fsp.stat(itemPath);
            lastActivity = Math.max(lastActivity, stat.mtimeMs);
          } catch (err) {
            // File may have been processed between readdir and stat.
            this._debugDiscovery('File bus item stat failed', { path: path.join(dir, entry.name), error: err });
          }
        }
      } catch (err) {
        // Missing bus directories are normal for agents that have never run.
        this._debugDiscovery('File bus directory unavailable', { path: dir, kind, alias, error: err });
      }
    }
    return { count, lastActivity };
  }

  async _latestHeartbeat(aliases) {
    const names = [
      'fc-heartbeat',
      'nockcc-last-ok',
      'tg-bridge.heartbeat',
      'session-start',
      'fast-checker.pid',
      'stats.json',
    ];
    let latest = 0;
    for (const alias of aliases) {
      for (const name of names) {
        const filePath = path.join(this.fileBusRoot, 'state', `${alias}.${name}`);
        try {
          const [content, stat] = await Promise.all([
            fsp.readFile(filePath, 'utf-8').catch(() => ''),
            fsp.stat(filePath),
          ]);
          latest = Math.max(latest, this._timestampFromText(content) || stat.mtimeMs);
        } catch (err) {
          // Not every agent has every heartbeat file.
          this._debugDiscovery('Heartbeat file unavailable', { path: filePath, alias, error: err });
        }
      }
    }
    return latest || null;
  }

  async _readAgentStats(aliases) {
    for (const alias of aliases) {
      try {
        const filePath = path.join(this.fileBusRoot, 'state', `${alias}.stats.json`);
        const parsed = JSON.parse(await fsp.readFile(filePath, 'utf-8'));
        if (!parsed || typeof parsed !== 'object') continue;
        return {
          agentState: this._safeString(parsed.agent, 80).toLowerCase(),
          lastChecked: this._timestampFromText(parsed.checked),
        };
      } catch (err) {
        // Try the next alias.
        this._debugDiscovery('Agent stats unreadable', {
          path: path.join(this.fileBusRoot, 'state', `${alias}.stats.json`),
          alias,
          error: err,
        });
      }
    }
    return { agentState: '', lastChecked: null };
  }

  async _hasLiveAgentPid(aliases) {
    for (const alias of aliases) {
      for (const suffix of ['fast-checker.pid', 'mcp-children.pids']) {
        try {
          const content = await fsp.readFile(path.join(this.fileBusRoot, 'state', `${alias}.${suffix}`), 'utf-8');
          const pids = content
            .split(/\s+/)
            .map(value => Number(value))
            .filter(value => Number.isInteger(value) && value > 0);
          if (pids.some(pid => this._pidIsAlive(pid))) return true;
        } catch (err) {
          // Missing pid files are normal.
          this._debugDiscovery('Agent pid file unavailable', {
            path: path.join(this.fileBusRoot, 'state', `${alias}.${suffix}`),
            alias,
            error: err,
          });
        }
      }
    }
    return false;
  }

  _pidIsAlive(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch (err) {
      return err?.code === 'EPERM';
    }
  }

  _timestampFromText(value) {
    const text = String(value || '').trim();
    if (!text) return null;

    if (!/^\d+$/.test(text)) {
      const parsedDate = Date.parse(text);
      if (Number.isFinite(parsedDate)) return parsedDate;
    }

    const match = text.match(/\d{10,13}/);
    if (!match) return null;
    const numeric = Number(match[0]);
    if (!Number.isFinite(numeric)) return null;
    return numeric > 10_000_000_000 ? numeric : numeric * 1000;
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
          } catch (err) {
            this._debugDiscovery('Claude transcript file stat failed', {
              path: path.join(projectPath, file),
              error: err,
            });
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
      const sessionContract = getAgentSessionContract('claude');
      sessionContract.adapterId = 'claude';
      sessionContract.transcriptDiscovery = {
        ...(sessionContract.transcriptDiscovery || {}),
        projectPath,
      };

      // The newest transcript's filename is the Claude session id, which
      // `claude --resume <id>` accepts. Only ids matching the safe charset
      // become resume commands — anything else stays launch-less.
      const newestJsonl = jsonlFiles.reduce(
        (best, candidate) => (!best || candidate.mtime > best.mtime ? candidate : best),
        null
      );
      const latestSessionId = newestJsonl ? path.basename(newestJsonl.file, '.jsonl') : '';
      const resumable = /^[A-Za-z0-9-]{8,}$/.test(latestSessionId);
      if (resumable) {
        sessionContract.resumeCommand = {
          state: 'supported',
          command: `claude --resume ${latestSessionId}`,
          notes: 'Resumes the newest transcript session for this project in its working directory.',
        };
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
        sessionContract,
        ...(resumable ? {
          claudeSessionId: latestSessionId,
          launch: this._buildResumeLaunch(`claude --resume ${latestSessionId}`, decodedPath),
        } : {}),
      };
    } catch (err) {
      this._debugDiscovery('Claude project parse failed', { path: projectPath, dirName, error: err });
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
            } catch (err) {
              this._debugDiscovery('Claude transcript cwd JSON parse failed', { path: full, error: err });
              return match[1].replace(/\\\\/g, '\\');
            }
          }
        } finally {
          await fd.close();
        }
      } catch (err) {
        // Skip unreadable transcripts, try next
        this._debugDiscovery('Claude transcript unreadable', {
          path: path.join(projectPath, file),
          error: err,
        });
      }
    }
    return null;
  }

  _decodeDirName(name) {
    if (process.platform === 'win32') {
      // Encoded as `[-]<drive>--<rest>` where dashes in <rest> are path separators.
      // The previous implementation used String.replace('--', ':\\') which only
      // replaces the first match — fine — but then `replace(/-/g, '\\')` ran
      // before splitting and would also clobber dashes in legitimate folder
      // names. Slice explicitly at the first `--` to keep the rest intact.
      const stripped = name.replace(/^-/, '');
      const driveSep = stripped.indexOf('--');
      if (driveSep < 0) return stripped.replace(/-/g, '\\');
      const drive = stripped.slice(0, driveSep);
      const rest = stripped.slice(driveSep + 2).replace(/-/g, '\\');
      return `${drive}:\\${rest}`;
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

    const headFile = path.join(projectPath, '.git', 'HEAD');

    // Try to read branch from .git/HEAD (fast, no subprocess)
    try {
      const content = await fsp.readFile(headFile, 'utf-8');
      const trimmed = content.trim();
      if (trimmed.startsWith('ref: refs/heads/')) {
        info.branch = trimmed.replace('ref: refs/heads/', '');
      } else {
        info.branch = trimmed.substring(0, 8);
      }
    } catch (err) {
      // Not a git repo or unreadable
      this._debugDiscovery('Git HEAD unreadable', { path: headFile, projectPath, error: err });
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
    } catch (err) {
      this._debugDiscovery('Git dirty check failed', { path: projectPath, error: err });
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
