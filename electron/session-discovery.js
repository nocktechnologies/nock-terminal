const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const { promisify } = require('util');
const { getAgentSessionContract } = require('./agent-adapters');

const execAsync = promisify(exec);

class SessionDiscovery {
  constructor(opts = {}) {
    this.claudeDir = opts.claudeDir || path.join(os.homedir(), '.claude');
    this.projectsDir = path.join(this.claudeDir, 'projects');
    this.fileBusRoot = opts.fileBusRoot || this._defaultFileBusRoot();
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
    // 1. Parse Claude Code sessions (authoritative cwd + activity timestamps)
    const sessions = await this._discoverSessions();

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
      byPath.set(this._pathKey(s.path), s);
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

    // 5. Apply skip list (match against basename)
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

  _strongestStatus(a, b) {
    const rank = { active: 3, recent: 2, inactive: 1 };
    return (rank[a] || 0) >= (rank[b] || 0) ? a : b;
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

  async _discoverAgentFolders(sessionPaths = []) {
    const configPaths = new Set();
    const sessionConfigPaths = new Set();
    for (const sessionPath of sessionPaths) {
      const normalizedPath = this._safeString(sessionPath, 1000);
      if (!normalizedPath || !path.isAbsolute(normalizedPath)) continue;
      sessionConfigPaths.add(path.join(normalizedPath, 'config.json'));
    }
    await this._mapLimit([...sessionConfigPaths], 5, (configPath) =>
      this._addConfigIfReadable(configPaths, configPath)
    );

    for (const root of this.devRoots) {
      try {
        await fsp.access(root);
      } catch {
        continue;
      }
      for (const configPath of await this._candidateAgentConfigPaths(root)) {
        configPaths.add(configPath);
      }
    }

    const results = await this._mapLimit([...configPaths], 5, (configPath) =>
      this._parseAgentFolder(configPath)
    );
    return this._dedupeAgentFolders(results.filter(Boolean));
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
    } catch {
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

  _isDispatchWorkspaceName(name) {
    return /(?:^|-)dispatch$/i.test(String(name || ''));
  }

  async _addAgentConfigsFromRoot(configs, agentsRoot) {
    let entries = [];
    try {
      entries = await fsp.readdir(agentsRoot, { withFileTypes: true });
    } catch {
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

  async _addConfigIfReadable(configs, configPath) {
    try {
      const config = JSON.parse(await fsp.readFile(configPath, 'utf-8'));
      if (this._agentNameFromConfig(config)) {
        configs.add(configPath);
        return;
      }
      this._debugIgnoredAgentConfig(configPath, 'missing valid agent_name');
    } catch (err) {
      if (!['ENOENT', 'ENOTDIR'].includes(err?.code)) {
        this._debugIgnoredAgentConfig(configPath, 'unreadable or invalid JSON');
      }
    }
  }

  async _parseAgentFolder(configPath) {
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
          canLaunch: Boolean(launchCommand),
          disabledReason: launchCommand ? '' : 'Agent launch command is missing',
          action: terminalLaunch.action,
          actionLabel: terminalLaunch.actionLabel,
          capability: terminalLaunch.capability,
        },
        sessionContract,
      };
    } catch {
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

  _debugIgnoredAgentConfig(configPath, reason) {
    if (process.env.NOCK_DEBUG_DISCOVERY === '1') {
      console.debug(`[session-discovery] Ignored agent config (${reason}): ${configPath}`);
    }
  }

  _safeString(value, maxLength = 500) {
    if (typeof value !== 'string') return '';
    return value.trim().slice(0, maxLength);
  }

  _formatAgentName(agentName) {
    return String(agentName || '')
      .split(/[-_]/)
      .filter(Boolean)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  _resolveAgentLaunchCommand(config, agentName, agentPath = '', crmAttachCommand = '') {
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
      };
    }
    const attachCommand = crmAttachCommand || this._resolveCrmAgentAttachCommand(agentPath, agentName);
    if (attachCommand && launchCommand === attachCommand) {
      return {
        action: 'attach',
        actionLabel: 'Attach',
        capability: 'live-attach',
      };
    }
    return {
      action: 'launch',
      actionLabel: 'Launch',
      capability: 'folder-launch',
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
      state: enabled && launchCommand ? 'supported' : 'unsupported',
      command: launchCommand || '',
      cwd: launchCwd || agentPath,
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

  _resolveAgentLaunchCwd(config, agentPath) {
    const raw = this._safeString(config.working_directory || config.workingDirectory, 1000);
    if (!raw) return agentPath;
    return path.isAbsolute(raw) ? raw : path.resolve(agentPath, raw);
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
    } catch {
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
      } catch {
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
    } catch {
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
    if (lifecycle === 'running' || lifecycle === 'idle') return 'active';
    if (lifecycle === 'stale') return 'recent';
    return 'inactive';
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
            const stat = await fsp.stat(path.join(dir, entry.name));
            lastActivity = Math.max(lastActivity, stat.mtimeMs);
          } catch {
            // File may have been processed between readdir and stat.
          }
        }
      } catch {
        // Missing bus directories are normal for agents that have never run.
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
        } catch {
          // Not every agent has every heartbeat file.
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
      } catch {
        // Try the next alias.
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
        } catch {
          // Missing pid files are normal.
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
      const sessionContract = getAgentSessionContract('claude');
      sessionContract.adapterId = 'claude';
      sessionContract.transcriptDiscovery = {
        ...(sessionContract.transcriptDiscovery || {}),
        projectPath,
      };

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
