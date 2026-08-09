'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const {
  AGENT_ID_RE,
  AUTH_PLACEHOLDER,
  CONSOLE_PROTOCOL_HASH,
  ManagedAgentError,
  PERMISSION_PRESETS,
  PLIST_LABEL_PREFIX,
  SUPPORTED_MODELS,
  authFingerprint,
  boundedText,
  buildCapsuleCompiler,
  buildCapsuleSource,
  buildLaunchdPlist,
  buildManifest,
  buildMetadata,
  buildSettings,
  buildWrapper,
  isAbsolute,
  isPlainObject,
  isWithin,
  normalizeDraft,
  normalizeId,
  posixCommand,
  sanitizeAuthStatus,
  shellQuote,
} = require('./managed-agent-blueprint');
const { ResidentControlClient } = require('./resident-control-client');

const MAX_METADATA_BYTES = 128 * 1024;
const CONTROL_ACTIONS = new Set(['status', 'pause', 'resume', 'restart', 'rotate', 'steer']);
const LIVE_STATES = new Set(['starting', 'running', 'paused', 'terminal_failed']);
const ATTACHABLE_STATES = new Set(['running', 'paused', 'terminal_failed']);

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function parseVersion(output) {
  return String(output || '').match(/\b\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\b/)?.[0] || '';
}

function executableExists(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() && (process.platform === 'win32' || (stat.mode & 0o111) !== 0);
  } catch {
    return false;
  }
}

function executableCandidates(names, configured = '') {
  const candidates = configured ? [configured] : [];
  for (const entry of String(process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    for (const name of names) candidates.push(path.join(entry, name));
  }
  for (const root of ['/usr/bin', '/opt/homebrew/bin', '/usr/local/bin']) {
    for (const name of names) candidates.push(path.join(root, name));
  }
  return unique(candidates.map(candidate => path.resolve(candidate))).filter(executableExists);
}

function findExecutable(names, configured = '') {
  return executableCandidates(names, configured)[0] || '';
}

function ensureDirectory(directory, mode = 0o700) {
  fs.mkdirSync(directory, { recursive: true, mode });
  try { fs.chmodSync(directory, mode); } catch {}
}

function writeAtomic(filePath, content, mode = 0o600) {
  const directory = path.dirname(filePath);
  ensureDirectory(directory);
  const tempPath = path.join(directory, `.${path.basename(filePath)}.${crypto.randomUUID()}.tmp`);
  try {
    const fd = fs.openSync(tempPath, 'wx', mode);
    try {
      fs.writeFileSync(fd, content, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.chmodSync(tempPath, mode);
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try { fs.rmSync(tempPath, { force: true }); } catch {}
    throw error;
  }
}

function writeJsonAtomic(filePath, value, mode = 0o600) {
  writeAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`, mode);
}

function readJson(filePath) {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_METADATA_BYTES) {
    throw new ManagedAgentError(`Unreadable managed metadata: ${path.basename(filePath)}`, 'INVALID_SEAT');
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function socketExists(filePath) {
  try {
    const stat = fs.lstatSync(filePath);
    return !stat.isSymbolicLink() && stat.isSocket();
  } catch {
    return false;
  }
}

class ManagedAgentService {
  constructor(options = {}) {
    this.homeDir = path.resolve(options.homeDir || os.homedir());
    this.agentsRoot = this._absoluteOption(options.agentsRoot, path.join(this.homeDir, '.nock', 'agents'), 'agentsRoot');
    this.runRoot = this._absoluteOption(options.runRoot, path.join(this.homeDir, '.nock', 'run'), 'runRoot');
    this.launchAgentsRoot = this._absoluteOption(options.launchAgentsRoot, path.join(this.homeDir, 'Library', 'LaunchAgents'), 'launchAgentsRoot');
    this.platform = options.platform || process.platform;
    this.engineRoot = this._engineRoot(options.engineRoot);
    this.configuredPython = options.runtimePython || '';
    this.configuredTmux = options.tmuxPath || '';
    this.configuredClaude = options.claudePath || '';
    this.launchctlPath = options.launchctlPath || '/bin/launchctl';
    this.supportedModels = [...(options.supportedModels?.length ? options.supportedModels : SUPPORTED_MODELS)];
    this.probes = isPlainObject(options.probes) ? options.probes : {};
    this.runCommand = options.runCommand || this._execFile.bind(this);
    const controlTimeoutMs = Number.isFinite(options.controlTimeoutMs) ? Math.max(100, options.controlTimeoutMs) : 2500;
    this.controlClient = new ResidentControlClient({ socketFactory: options.net, timeoutMs: controlTimeoutMs });
    this.randomUUID = options.randomUUID || crypto.randomUUID;
    this.uid = Number.isInteger(options.uid) ? options.uid : (typeof process.getuid === 'function' ? process.getuid() : 0);
  }

  _absoluteOption(value, fallback, field) {
    const candidate = value || fallback;
    if (!isAbsolute(candidate)) throw new ManagedAgentError(`${field} must be absolute`, 'CONFIGURATION_ERROR');
    return path.resolve(candidate);
  }

  _engineRoot(configured) {
    const candidate = configured || process.env.NOCK_RESIDENT_ENGINE_ROOT || path.join(this.homeDir, 'Dev', 'nock-agent-harness-tmux');
    return isAbsolute(candidate) ? path.resolve(candidate) : '';
  }

  _execFile(file, args, options) {
    return new Promise(resolve => {
      execFile(file, args, options, (error, stdout, stderr) => {
        resolve({
          error: error || null,
          status: error ? (Number.isInteger(error.code) ? error.code : null) : 0,
          stdout: stdout || '',
          stderr: stderr || '',
        });
      });
    });
  }

  async _run(file, args, options = {}) {
    try {
      return await this.runCommand(file, args, {
        shell: false,
        encoding: 'utf8',
        timeout: options.timeout ?? 1500,
        env: options.env,
        cwd: options.cwd,
      });
    } catch (error) {
      return { error, status: null, stdout: '', stderr: '' };
    }
  }

  async _probeExecutable(file, args, parser) {
    if (!file || !isAbsolute(file) || !executableExists(file)) {
      return { path: file || '', available: false, version: '', error: 'missing' };
    }
    const result = await this._run(file, args, { timeout: 5000 });
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;
    if (result.error || result.status !== 0) return { path: file, available: false, version: '', error: 'probe-failed' };
    return { path: file, available: true, version: parser(output), error: '' };
  }

  async _probePython(file) {
    if (this.probes.runtimePython) return { path: file, ...await this.probes.runtimePython(file) };
    const version = await this._probeExecutable(file, ['--version'], parseVersion);
    if (!version.available || !/^3\./.test(version.version)) {
      return { path: file || '', available: false, version: version.version, jsonschema: false, error: 'python3-missing' };
    }
    const dependency = await this._run(file, ['-c', 'import jsonschema; print(jsonschema.__version__)'], { timeout: 5000 });
    const jsonschema = !dependency.error && dependency.status === 0 && Boolean(String(dependency.stdout || '').trim());
    return { path: file, available: jsonschema, version: version.version, jsonschema, error: jsonschema ? '' : 'jsonschema-missing' };
  }

  async _runtimePythonProbe() {
    const candidates = executableCandidates(['python3'], this.configuredPython);
    let fallback = { path: this.configuredPython || '', available: false, version: '', jsonschema: false, error: 'missing' };
    for (const candidate of candidates) {
      const probe = await this._probePython(candidate);
      if (!fallback.path) fallback = probe;
      if (probe.available && probe.jsonschema) return probe;
    }
    return fallback;
  }

  async _probeSnapshot() {
    const tmuxPath = findExecutable(['tmux'], this.configuredTmux);
    const claudePath = findExecutable(['claude'], this.configuredClaude);
    const [runtimePython, tmux, claude] = await Promise.all([
      this._runtimePythonProbe(),
      this.probes.tmux
        ? Promise.resolve(this.probes.tmux(tmuxPath)).then(result => ({ path: tmuxPath, ...result }))
        : this._probeExecutable(tmuxPath, ['-V'], parseVersion),
      this.probes.claude
        ? Promise.resolve(this.probes.claude(claudePath)).then(result => ({ path: claudePath, ...result }))
        : this._probeExecutable(claudePath, ['--version'], parseVersion),
    ]);
    return {
      runtimePython,
      tmux,
      claude,
    };
  }

  async prerequisites() {
    const probes = await this._probeSnapshot();
    const engineAvailable = Boolean(
      this.engineRoot
      && fs.existsSync(path.join(this.engineRoot, 'runtime', 'seat.py'))
      && fs.existsSync(path.join(this.engineRoot, 'seats', 'manifest.schema.json')),
    );
    const launchdAvailable = this.platform === 'darwin' && executableExists(this.launchctlPath);
    const items = [
      { id: 'engine', label: 'Resident engine', available: engineAvailable, reason: engineAvailable ? '' : 'Resident engine checkout is missing.' },
      { id: 'python', label: 'Python runtime', available: probes.runtimePython.available && probes.runtimePython.jsonschema, reason: probes.runtimePython.available ? '' : 'Python 3 with jsonschema is required.' },
      { id: 'tmux', label: 'tmux', available: probes.tmux.available, reason: probes.tmux.available ? '' : 'tmux is not available.' },
      { id: 'claude', label: 'Claude Code', available: probes.claude.available && Boolean(probes.claude.version), reason: probes.claude.available && probes.claude.version ? '' : 'Claude Code is unavailable or did not report a version.' },
      { id: 'launchd', label: 'macOS launchd', available: launchdAvailable, reason: launchdAvailable ? '' : 'Managed residents currently require macOS launchd.' },
    ];
    return {
      success: true,
      ready: items.every(item => item.available),
      missing: items.filter(item => !item.available).map(item => item.label),
      items,
      supportedModels: [...this.supportedModels],
      engineRoot: this.engineRoot || null,
      roots: { agents: this.agentsRoot, run: this.runRoot, launchAgents: this.launchAgentsRoot },
      runtimePython: { path: probes.runtimePython.path || null, version: probes.runtimePython.version || null, jsonschema: probes.runtimePython.jsonschema === true },
      tmux: { path: probes.tmux.path || null, version: probes.tmux.version || null },
      claude: { path: probes.claude.path || null, version: probes.claude.version || null },
      launchd: { available: launchdAvailable, path: launchdAvailable ? this.launchctlPath : null },
    };
  }

  async _requirePrerequisites() {
    const result = await this.prerequisites();
    if (!result.ready) {
      throw new ManagedAgentError(`managed resident prerequisites missing: ${result.missing.join(', ')}`, 'PREREQUISITES_MISSING');
    }
    return {
      runtimePython: { path: result.runtimePython.path, version: result.runtimePython.version },
      tmux: { path: result.tmux.path, version: result.tmux.version },
      claude: { path: result.claude.path, version: result.claude.version },
    };
  }

  _paths(agentId) {
    const residence = path.join(this.agentsRoot, agentId);
    const runtimeDir = path.join(this.runRoot, agentId);
    const stateDir = path.join(residence, 'state', 'resident');
    const configDir = path.join(residence, 'config', 'claude');
    return {
      residence,
      runtimeDir,
      stateDir,
      configDir,
      manifest: path.join(residence, 'seat.json'),
      metadata: path.join(residence, 'nock-agent.json'),
      identitySource: path.join(residence, 'identity', 'agent.md'),
      capsuleCompiler: path.join(residence, 'bin', 'compile-capsule.py'),
      wrapper: path.join(residence, 'bin', 'run-resident.sh'),
      settings: path.join(configDir, 'settings.json'),
      tmuxSocket: path.join(runtimeDir, 'tmux.sock'),
      controlSocket: path.join(runtimeDir, 'control.sock'),
      tmuxSession: `nock-resident-${agentId}`,
      presenceDir: path.join(stateDir, 'presence'),
      outboxJournal: path.join(stateDir, 'outbox.jsonl'),
      supervisorState: path.join(residence, 'state', 'nock-supervisor.json'),
      stdoutLog: path.join(residence, 'logs', 'residentd.out.log'),
      stderrLog: path.join(residence, 'logs', 'residentd.err.log'),
      plist: path.join(this.launchAgentsRoot, `${PLIST_LABEL_PREFIX}${agentId}.plist`),
    };
  }

  _assertDirectory(directory, label) {
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new ManagedAgentError(`${label} is not a trusted directory`, 'INVALID_SEAT');
    }
  }

  _validateManifest(seat) {
    const { manifest, paths } = seat;
    const exactPaths = [
      ['home', manifest.home, paths.residence],
      ['state_dir', manifest.state_dir, paths.stateDir],
      ['config_dir', manifest.config_dir, paths.configDir],
      ['control_socket', manifest.control_socket, paths.controlSocket],
      ['tmux.socket', manifest.tmux?.socket, paths.tmuxSocket],
      ['tmux.session', manifest.tmux?.session, paths.tmuxSession],
      ['presence_dir', manifest.presence_dir, paths.presenceDir],
      ['outbox_journal', manifest.outbox_journal, paths.outboxJournal],
      ['capsule_source_root', manifest.capsule_source_root, paths.residence],
      ['capsule_command[1]', manifest.capsule_command?.[1], paths.capsuleCompiler],
    ];
    for (const [field, actual, expected] of exactPaths) {
      if (actual !== expected) throw new ManagedAgentError(`managed manifest ${field} is not trusted`, 'INVALID_SEAT');
    }
    if (!isAbsolute(manifest.work_dir)
      || !Array.isArray(manifest.workspaces?.allowed_roots)
      || !manifest.workspaces.allowed_roots.some(root => isAbsolute(root) && isWithin(root, manifest.work_dir))) {
      throw new ManagedAgentError('managed manifest work directory is outside its allowed roots', 'INVALID_SEAT');
    }
    if (!isAbsolute(manifest.runtime?.binary) || !executableExists(manifest.runtime.binary)) {
      throw new ManagedAgentError('managed manifest runtime binary is unavailable', 'INVALID_SEAT');
    }
    if (!isAbsolute(manifest.capsule_command?.[0]) || !executableExists(manifest.capsule_command[0])) {
      throw new ManagedAgentError('managed manifest capsule runtime is unavailable', 'INVALID_SEAT');
    }
  }

  _seat(agentId) {
    const id = normalizeId(agentId);
    const paths = this._paths(id);
    if (!isWithin(this.agentsRoot, paths.residence) || !isWithin(this.runRoot, paths.runtimeDir)) {
      throw new ManagedAgentError('managed residence path escaped its root', 'INVALID_SEAT');
    }
    try {
      for (const directory of [
        paths.residence,
        path.join(paths.residence, 'identity'),
        path.join(paths.residence, 'bin'),
        path.join(paths.residence, 'config'),
        paths.configDir,
        path.join(paths.residence, 'state'),
        paths.stateDir,
        paths.runtimeDir,
      ]) this._assertDirectory(directory, path.basename(directory));
      const metadata = readJson(paths.metadata);
      const manifest = readJson(paths.manifest);
      if (!isPlainObject(metadata) || metadata.managed !== true || metadata.id !== id || manifest?.agent !== id) {
        throw new ManagedAgentError(`managed seat ${id} is invalid`, 'INVALID_SEAT');
      }
      const seat = { id, paths, metadata, manifest };
      this._validateManifest(seat);
      return seat;
    } catch (error) {
      if (error instanceof ManagedAgentError) throw error;
      throw new ManagedAgentError(`managed seat ${id} is invalid`, 'INVALID_SEAT');
    }
  }

  _invalidRow(entryName, residence, reason) {
    const safeId = AGENT_ID_RE.test(entryName)
      ? entryName
      : `invalid-${crypto.createHash('sha256').update(entryName).digest('hex').slice(0, 12)}`;
    return {
      id: `managed:${safeId}`,
      agentId: safeId,
      kind: 'agent',
      name: entryName,
      displayName: entryName,
      path: residence,
      home: residence,
      status: 'invalid',
      agent: { name: safeId, runtime: 'resident', lifecycle: 'invalid', managed: true },
      managed: true,
      failureReason: reason,
      capabilities: Object.fromEntries([
        'authenticate', 'validate', 'edit', 'start', 'stop', 'attach', 'pause', 'resume', 'restart', 'rotate', 'steer',
      ].map(action => [action, false])),
    };
  }

  _launchDescriptor(seat, status, tmuxPath) {
    const resolvedTmuxPath = tmuxPath === undefined
      ? findExecutable(['tmux'], this.configuredTmux)
      : tmuxPath;
    const argv = resolvedTmuxPath ? [resolvedTmuxPath, '-S', seat.paths.tmuxSocket, 'attach', '-t', `=${seat.paths.tmuxSession}`] : [];
    const canLaunch = Boolean(argv.length && socketExists(seat.paths.tmuxSocket) && ATTACHABLE_STATES.has(status));
    return {
      mode: 'terminal',
      action: 'attach',
      actionLabel: 'Attach',
      capability: 'resident-live-attach',
      command: argv.length ? posixCommand(argv) : '',
      argv,
      cwd: seat.paths.residence,
      canLaunch,
      disabledReason: canLaunch ? '' : 'Resident tmux session is not reachable',
    };
  }

  _row(seat, snapshot = {}, { tmuxPath } = {}) {
    const status = snapshot.status || seat.metadata.status || 'invalid';
    const controlReachable = snapshot.controlReachable === true;
    const serviceLoaded = snapshot.serviceLoaded === true;
    const launch = this._launchDescriptor(seat, status, tmuxPath);
    const authReady = seat.manifest.runtime.auth_identity !== AUTH_PLACEHOLDER;
    const offlineEditable = !controlReachable && !serviceLoaded && ['needs_auth', 'stopped'].includes(status);
    const capabilities = {
      authenticate: offlineEditable,
      validate: offlineEditable,
      edit: offlineEditable,
      start: status === 'stopped' && authReady && !controlReachable,
      stop: serviceLoaded || LIVE_STATES.has(status),
      attach: launch.canLaunch,
      pause: controlReachable && status === 'running',
      resume: controlReachable && status === 'paused',
      restart: controlReachable && ['running', 'paused'].includes(status),
      rotate: controlReachable && status === 'running',
      steer: controlReachable && status === 'running',
    };
    return {
      id: `managed:${seat.id}`,
      agentId: seat.id,
      kind: 'agent',
      name: seat.metadata.displayName,
      displayName: seat.metadata.displayName,
      path: seat.paths.residence,
      home: seat.paths.residence,
      status,
      failureReason: snapshot.failureReason || '',
      agent: {
        name: seat.id,
        displayName: seat.metadata.displayName,
        enabled: true,
        lifecycle: status,
        runtime: 'resident',
        launchType: 'resident',
        model: seat.metadata.runtime?.model || seat.manifest.runtime.model,
        workingDirectory: seat.manifest.work_dir,
        permissionPreset: seat.metadata.permissionPreset,
        permissions: seat.metadata.permissions,
        managed: true,
        residence: seat.paths.residence,
        tmuxSocket: seat.paths.tmuxSocket,
        tmuxSession: seat.paths.tmuxSession,
        controlSocket: seat.paths.controlSocket,
        authIdentity: seat.manifest.runtime.auth_identity,
      },
      metadata: seat.metadata,
      launch,
      sessionContract: {
        adapterId: 'managed-resident',
        liveAttach: { state: launch.canLaunch ? 'supported' : 'conditional', command: launch.command, evidence: 'managed-resident-manifest' },
        residentControl: { state: controlReachable ? 'supported' : 'conditional', controlSocket: seat.paths.controlSocket },
        resumeCommand: { state: 'unsupported' },
      },
      supervisor: {
        loaded: serviceLoaded,
        exitCode: snapshot.exitCode ?? null,
        stdoutLog: seat.paths.stdoutLog,
        stderrLog: seat.paths.stderrLog,
      },
      managed: true,
      capabilities,
    };
  }

  _launchctlTarget(agentId) {
    return `gui/${this.uid}/${PLIST_LABEL_PREFIX}${agentId}`;
  }

  async _launchdLoaded(agentId) {
    if (this.platform !== 'darwin' || !executableExists(this.launchctlPath)) return false;
    const result = await this._run(this.launchctlPath, ['print', this._launchctlTarget(agentId)], { timeout: 3000 });
    return !result.error && result.status === 0;
  }

  _supervisorReceipt(seat) {
    try {
      const receipt = readJson(seat.paths.supervisorState);
      return Number.isInteger(receipt.exitCode) ? receipt : null;
    } catch {
      return null;
    }
  }

  async _statusSnapshot(seat) {
    if (socketExists(seat.paths.controlSocket)) {
      try {
        const frame = await this.controlClient.send(seat.paths.controlSocket, 'status', {}, String(this.randomUUID()));
        const state = frame.ok === true ? frame.result?.state : '';
        if (['running', 'paused', 'terminal-failed'].includes(state)) {
          const status = state === 'terminal-failed' ? 'terminal_failed' : state;
          return {
            status,
            controlReachable: true,
            serviceLoaded: await this._launchdLoaded(seat.id),
            failureReason: status === 'terminal_failed' ? String(frame.result?.terminal_reason || 'Resident entered terminal-failed state.') : '',
          };
        }
      } catch {}
    }

    const serviceLoaded = await this._launchdLoaded(seat.id);
    const receipt = this._supervisorReceipt(seat);
    let status = seat.metadata.status;
    let failureReason = '';
    if (receipt?.exitCode === 3) {
      status = 'terminal_failed';
      failureReason = `Resident exited terminal-failed. See ${seat.paths.stderrLog}`;
    } else if (receipt?.exitCode === 78) {
      status = 'invalid';
      failureReason = `Resident configuration failed validation. See ${seat.paths.stderrLog}`;
    } else if (status === 'needs_auth') {
      status = 'needs_auth';
    } else if (serviceLoaded && LIVE_STATES.has(status)) {
      status = 'starting';
    } else if (!serviceLoaded && status !== 'invalid') {
      status = 'stopped';
    }
    if (seat.metadata.status !== status) {
      seat.metadata = { ...seat.metadata, status };
      writeJsonAtomic(seat.paths.metadata, seat.metadata);
    }
    return { status, controlReachable: false, serviceLoaded, exitCode: receipt?.exitCode, failureReason };
  }

  async list() {
    try {
      if (!fs.existsSync(this.agentsRoot)) return [];
      const entries = fs.readdirSync(this.agentsRoot, { withFileTypes: true }).filter(item => item.isDirectory());
      const tmuxPath = findExecutable(['tmux'], this.configuredTmux);
      return Promise.all(entries.map(async entry => {
        const residence = path.join(this.agentsRoot, entry.name);
        try {
          const seat = this._seat(entry.name);
          return this._row(seat, await this._statusSnapshot(seat), { tmuxPath });
        } catch (error) {
          return this._invalidRow(entry.name, residence, error.message);
        }
      }));
    } catch {
      return [this._invalidRow('managed-agents-root', this.agentsRoot, 'Managed agent inventory is unreadable.')];
    }
  }

  _residencePaths(residence, paths) {
    return {
      ...paths,
      metadata: path.join(residence, 'nock-agent.json'),
      manifest: path.join(residence, 'seat.json'),
      identitySource: path.join(residence, 'identity', 'agent.md'),
      capsuleCompiler: path.join(residence, 'bin', 'compile-capsule.py'),
      wrapper: path.join(residence, 'bin', 'run-resident.sh'),
      settings: path.join(residence, 'config', 'claude', 'settings.json'),
    };
  }

  _writeResidence(residence, draft, paths, manifest, metadata, probes) {
    for (const directory of [
      path.join(residence, 'identity'),
      path.join(residence, 'bin'),
      path.join(residence, 'config', 'claude'),
      path.join(residence, 'state', 'resident', 'presence'),
      path.join(residence, 'logs'),
    ]) ensureDirectory(directory);
    const targets = this._residencePaths(residence, paths);
    writeJsonAtomic(targets.metadata, metadata);
    writeJsonAtomic(targets.manifest, manifest);
    writeAtomic(targets.identitySource, buildCapsuleSource(metadata));
    writeAtomic(targets.capsuleCompiler, buildCapsuleCompiler(), 0o700);
    writeAtomic(targets.wrapper, buildWrapper(this.engineRoot, probes.runtimePython.path, paths), 0o700);
    writeJsonAtomic(targets.settings, buildSettings(draft.permissionPreset));
  }

  _plistContent(id, paths, probes) {
    return buildLaunchdPlist(`${PLIST_LABEL_PREFIX}${id}`, paths, this.engineRoot, probes.runtimePython.path, probes.tmux.path, probes.claude.path);
  }

  async _preflight(manifestPath, probes) {
    const result = await this._run(
      probes.runtimePython.path,
      ['-m', 'runtime.seat', '--manifest', manifestPath, '--check'],
      { timeout: 30_000, cwd: this.engineRoot, env: process.env },
    );
    if (result.error || result.status !== 0) {
      const detail = String(result.stderr || result.stdout || '').trim().slice(0, 500);
      throw new ManagedAgentError(`resident blueprint preflight failed${detail ? `: ${detail}` : ''}`, 'PREFLIGHT_FAILED');
    }
  }

  async create(draft) {
    const id = normalizeId(draft?.agentId ?? draft?.id);
    const paths = this._paths(id);
    const normalized = normalizeDraft(draft, {
      agentId: id,
      defaultWorkDirectory: paths.residence,
      supportedModels: this.supportedModels,
    });
    const probes = await this._requirePrerequisites();
    ensureDirectory(this.agentsRoot);
    ensureDirectory(this.runRoot);
    ensureDirectory(this.launchAgentsRoot);
    if (fs.existsSync(paths.residence) || fs.existsSync(paths.runtimeDir) || fs.existsSync(paths.plist)) {
      throw new ManagedAgentError(`managed seat ${id} already exists`, 'ALREADY_EXISTS');
    }

    const residenceTemp = path.join(this.agentsRoot, `.${id}.${this.randomUUID()}.tmp`);
    const runtimeTemp = path.join(this.runRoot, `.${id}.${this.randomUUID()}.tmp`);
    const plistTemp = path.join(this.launchAgentsRoot, `.${PLIST_LABEL_PREFIX}${id}.${this.randomUUID()}.tmp`);
    const metadata = buildMetadata(normalized, paths);
    const manifest = buildManifest(normalized, paths, probes, AUTH_PLACEHOLDER);
    const installed = [];
    try {
      ensureDirectory(residenceTemp);
      this._writeResidence(residenceTemp, normalized, paths, manifest, metadata, probes);
      ensureDirectory(runtimeTemp);
      writeAtomic(plistTemp, this._plistContent(id, paths, probes));
      await this._preflight(path.join(residenceTemp, 'seat.json'), probes);
      for (const [source, target] of [
        [residenceTemp, paths.residence],
        [runtimeTemp, paths.runtimeDir],
        [plistTemp, paths.plist],
      ]) {
        fs.renameSync(source, target);
        installed.push(target);
      }
    } catch (error) {
      for (const candidate of [residenceTemp, runtimeTemp, plistTemp]) {
        try { fs.rmSync(candidate, { recursive: true, force: true }); } catch {}
      }
      for (const target of installed.reverse()) {
        try { fs.rmSync(target, { recursive: true, force: true }); } catch {}
      }
      if (error.code === 'EEXIST') throw new ManagedAgentError(`managed seat ${id} already exists`, 'ALREADY_EXISTS');
      if (error instanceof ManagedAgentError) throw error;
      throw new ManagedAgentError(`managed seat creation failed: ${error.message}`, 'CREATE_FAILED');
    }
    return this._row({ id, paths, metadata, manifest }, { status: 'needs_auth', controlReachable: false, serviceLoaded: false });
  }

  _draftFromSeat(seat) {
    return {
      agentId: seat.id,
      displayName: seat.metadata.displayName,
      model: seat.metadata.runtime?.model,
      permissionPreset: seat.metadata.permissionPreset,
      workDirectory: seat.manifest.work_dir,
      identity: seat.metadata.identity,
      purpose: seat.metadata.purpose,
      allowedRoots: seat.metadata.workspaces?.allowedRoots,
      deniedRoots: seat.metadata.workspaces?.deniedRoots,
    };
  }

  async _replaceFiles(entries, validate) {
    const staged = entries.map(entry => ({
      ...entry,
      staged: `${entry.target}.${this.randomUUID()}.next`,
      backup: `${entry.target}.${this.randomUUID()}.backup`,
      backedUp: false,
      promoted: false,
    }));
    let committed = false;
    try {
      for (const entry of staged) writeAtomic(entry.staged, entry.content, entry.mode);
      await validate?.(staged);
      for (const entry of staged) {
        if (fs.existsSync(entry.target)) {
          fs.renameSync(entry.target, entry.backup);
          entry.backedUp = true;
        }
      }
      for (const entry of staged) {
        fs.renameSync(entry.staged, entry.target);
        entry.promoted = true;
      }
      committed = true;
    } catch (error) {
      let rollbackFailed = false;
      for (const entry of [...staged].reverse()) {
        if (entry.promoted) try { fs.rmSync(entry.target, { force: true }); } catch {}
        if (entry.backedUp) {
          try {
            fs.renameSync(entry.backup, entry.target);
            entry.backedUp = false;
          } catch {
            rollbackFailed = true;
          }
        }
      }
      if (rollbackFailed) {
        throw new ManagedAgentError(`managed file transaction failed and preserved recovery backups: ${error.message}`, 'UPDATE_ROLLBACK_FAILED');
      }
      throw error;
    } finally {
      for (const entry of staged) {
        try { fs.rmSync(entry.staged, { force: true }); } catch {}
        if (committed || !entry.backedUp) try { fs.rmSync(entry.backup, { force: true }); } catch {}
      }
    }
  }

  async _requireOffline(seat, operation, { unloaded = false } = {}) {
    const snapshot = await this._statusSnapshot(seat);
    if (snapshot.controlReachable || LIVE_STATES.has(snapshot.status) || (unloaded && snapshot.serviceLoaded)) {
      throw new ManagedAgentError(`managed seat ${seat.id} is live; stop it before ${operation}`, 'LIVE_SEAT');
    }
    return snapshot;
  }

  async update(agentId, draft) {
    const seat = this._seat(agentId);
    await this._requireOffline(seat, 'updating', { unloaded: true });
    const base = this._draftFromSeat(seat);
    const merged = {
      ...base,
      ...draft,
      agentId: seat.id,
      identity: { ...base.identity, ...(isPlainObject(draft.identity) ? draft.identity : {}) },
    };
    const normalized = normalizeDraft(merged, {
      agentId: seat.id,
      defaultWorkDirectory: seat.paths.residence,
      supportedModels: this.supportedModels,
    });
    const probes = await this._requirePrerequisites();
    const authIdentity = seat.manifest.runtime.auth_identity;
    const status = authIdentity === AUTH_PLACEHOLDER ? 'needs_auth' : 'stopped';
    const metadata = buildMetadata(normalized, seat.paths, { previous: seat.metadata, authIdentity, status });
    const manifest = buildManifest(normalized, seat.paths, probes, authIdentity);
    const entries = [
      { target: seat.paths.metadata, content: `${JSON.stringify(metadata, null, 2)}\n`, mode: 0o600 },
      { target: seat.paths.manifest, content: `${JSON.stringify(manifest, null, 2)}\n`, mode: 0o600, manifest: true },
      { target: seat.paths.identitySource, content: buildCapsuleSource(metadata), mode: 0o600 },
      { target: seat.paths.capsuleCompiler, content: buildCapsuleCompiler(), mode: 0o700 },
      { target: seat.paths.wrapper, content: buildWrapper(this.engineRoot, probes.runtimePython.path, seat.paths), mode: 0o700 },
      { target: seat.paths.settings, content: `${JSON.stringify(buildSettings(normalized.permissionPreset), null, 2)}\n`, mode: 0o600 },
      { target: seat.paths.plist, content: this._plistContent(seat.id, seat.paths, probes), mode: 0o600 },
    ];
    try {
      await this._replaceFiles(entries, async staged => {
        const manifestEntry = staged.find(entry => entry.manifest);
        await this._preflight(manifestEntry.staged, probes);
      });
    } catch (error) {
      if (error instanceof ManagedAgentError) throw error;
      throw new ManagedAgentError(`managed seat update failed: ${error.message}`, 'UPDATE_FAILED');
    }
    return this._row({ ...seat, metadata, manifest }, { status, controlReachable: false, serviceLoaded: false });
  }

  async validate(agentId) {
    const seat = this._seat(agentId);
    await this._requireOffline(seat, 'validating authentication');
    const result = await this._run(seat.manifest.runtime.binary, ['auth', 'status', '--json'], {
      timeout: 30_000,
      env: { ...process.env, CLAUDE_CONFIG_DIR: seat.paths.configDir },
    });
    if (result.error || result.status !== 0) throw new ManagedAgentError('Claude auth status probe failed', 'AUTH_STATUS_FAILED');
    let status;
    try {
      const output = String(result.stdout || '');
      if (Buffer.byteLength(output, 'utf8') > MAX_METADATA_BYTES) throw new Error('too large');
      status = JSON.parse(output);
    } catch {
      throw new ManagedAgentError('Claude auth status was not valid JSON', 'AUTH_STATUS_INVALID');
    }
    const sanitized = sanitizeAuthStatus(status);
    const authIdentity = sanitized.loggedIn ? sanitized.authIdentity : AUTH_PLACEHOLDER;
    const nextStatus = sanitized.loggedIn ? 'stopped' : 'needs_auth';
    const manifest = { ...seat.manifest, runtime: { ...seat.manifest.runtime, auth_identity: authIdentity } };
    const metadata = { ...seat.metadata, status: nextStatus, runtime: { ...seat.metadata.runtime, authIdentity } };
    await this._replaceFiles([
      { target: seat.paths.manifest, content: `${JSON.stringify(manifest, null, 2)}\n`, mode: 0o600 },
      { target: seat.paths.metadata, content: `${JSON.stringify(metadata, null, 2)}\n`, mode: 0o600 },
    ]);
    return { success: true, agentId: seat.id, status: nextStatus, loggedIn: sanitized.loggedIn, authIdentity: sanitized.loggedIn ? authIdentity : null };
  }

  async authLaunch(agentId) {
    const seat = this._seat(agentId);
    await this._requireOffline(seat, 'authenticating');
    const command = `CLAUDE_CONFIG_DIR=${shellQuote(seat.paths.configDir)} ${posixCommand([seat.manifest.runtime.binary, 'auth', 'login', '--claudeai'])}`;
    return {
      success: true,
      agentId: seat.id,
      cwd: seat.paths.residence,
      title: `Authenticate ${seat.metadata.displayName}`,
      launchCommand: command,
      command,
      mode: 'terminal',
      action: 'authenticate',
      capability: 'resident-auth',
    };
  }

  async _launchctl(args) {
    const result = await this._run(this.launchctlPath, args, { timeout: 10_000 });
    if (result.error || result.status !== 0) {
      const detail = String(result.stderr || '').trim().slice(0, 240);
      throw new ManagedAgentError(`launchd operation failed${detail ? `: ${detail}` : ''}`, 'SUPERVISION_FAILED');
    }
  }

  async supervise(agentId, action) {
    const seat = this._seat(agentId);
    const verb = boundedText(action, 'action', { max: 16, required: true });
    if (!['start', 'stop'].includes(verb)) throw new ManagedAgentError('supervise action must be start or stop', 'VALIDATION_ERROR');
    if (this.platform !== 'darwin') throw new ManagedAgentError('launchd supervision is only available on macOS', 'UNSUPPORTED_PLATFORM');

    const snapshot = await this._statusSnapshot(seat);
    const domain = `gui/${this.uid}`;
    const target = this._launchctlTarget(seat.id);
    if (verb === 'start') {
      if (snapshot.controlReachable || ATTACHABLE_STATES.has(snapshot.status)) {
        throw new ManagedAgentError(`managed seat ${seat.id} is already live`, 'LIVE_SEAT');
      }
      if (snapshot.status !== 'stopped' || seat.manifest.runtime.auth_identity === AUTH_PLACEHOLDER) {
        throw new ManagedAgentError('validate the dedicated Claude authentication before starting this resident', 'AUTH_REQUIRED');
      }
      try { fs.rmSync(seat.paths.supervisorState, { force: true }); } catch {}
      if (!snapshot.serviceLoaded) await this._launchctl(['bootstrap', domain, seat.paths.plist]);
      await this._launchctl(['kickstart', '-k', target]);
      seat.metadata = { ...seat.metadata, status: 'starting' };
      writeJsonAtomic(seat.paths.metadata, seat.metadata);
      return this._row(seat, { status: 'starting', controlReachable: false, serviceLoaded: true });
    }

    if (snapshot.serviceLoaded) await this._launchctl(['bootout', target]);
    seat.metadata = { ...seat.metadata, status: 'stopped' };
    writeJsonAtomic(seat.paths.metadata, seat.metadata);
    return this._row(seat, { status: 'stopped', controlReachable: false, serviceLoaded: false });
  }

  _controlParams(action, params) {
    if (!CONTROL_ACTIONS.has(action)) throw new ManagedAgentError('control action is not supported', 'VALIDATION_ERROR');
    if (!isPlainObject(params)) throw new ManagedAgentError('control params must be an object', 'VALIDATION_ERROR');
    if (action === 'steer') return { text: boundedText(params.text, 'params.text', { required: true, multiline: true }) };
    if (Object.keys(params).length) throw new ManagedAgentError(`${action} does not accept params`, 'VALIDATION_ERROR');
    return {};
  }

  async control(agentId, action, params = {}) {
    const seat = this._seat(agentId);
    const verb = boundedText(action, 'action', { max: 16, required: true });
    const requestId = String(this.randomUUID());
    const frame = await this.controlClient.send(seat.paths.controlSocket, verb, this._controlParams(verb, params), requestId);
    if (frame.ok !== true) {
      return {
        success: false,
        agentId: seat.id,
        action: verb,
        requestId,
        error: boundedText(frame.error || 'resident refused the control action', 'control error', { max: 500 }),
        code: 'CONTROL_REFUSED',
        reason: frame.reason,
        evidence: frame.evidence,
      };
    }
    return {
      success: true,
      agentId: seat.id,
      action: verb,
      requestId,
      result: frame.result,
      replay: frame.replay === true,
      evidence: frame.evidence,
    };
  }
}

ManagedAgentService.AGENT_ID_RE = AGENT_ID_RE;
ManagedAgentService.PERMISSION_PRESETS = PERMISSION_PRESETS;
ManagedAgentService.SUPPORTED_MODELS = SUPPORTED_MODELS;
ManagedAgentService.CONSOLE_PROTOCOL_HASH = CONSOLE_PROTOCOL_HASH;
ManagedAgentService.authFingerprint = authFingerprint;
ManagedAgentService.sanitizeAuthStatus = sanitizeAuthStatus;
ManagedAgentService.shellQuote = shellQuote;

module.exports = { ManagedAgentService };
