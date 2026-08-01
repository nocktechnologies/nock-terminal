const { execFile } = require('child_process');
const { promisify } = require('util');
const { normalizeHarnessSeat } = require('./harness-seat-utils');

const execFileAsync = promisify(execFile);
const SNAPSHOT_TIMEOUT_MS = 8000;
const SNAPSHOT_MAX_BUFFER = 512 * 1024;
const LAUNCH_MODES = new Set(['console', 'watch', 'shell']);
const CONTROL_ACTIONS = new Set([
  'status',
  'pause',
  'resume',
  'cancel-turn',
  'queue-retry',
  'queue-acknowledge',
]);
const PULSE_DISPOSITIONS = new Set([
  'working',
  'ready',
  'quiescent',
  'paused',
  'held',
  'blocked',
  'degraded',
  'stalled',
]);
const PULSE_INITIATIVE_STATES = new Set([
  'owed',
  'queued',
  'working',
  'waiting',
  'blocked',
  'held',
  'paused',
  'clear',
  'attention_required',
]);
const MAX_PULSE_EPOCH_SECONDS = 4102444800;

function boundedText(value, limit) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function epochSeconds(value) {
  const number = finiteNumber(value);
  return number !== null && number >= 0 && number <= MAX_PULSE_EPOCH_SECONDS
    ? number
    : null;
}

function sanitizePulseAction(action, kind) {
  if (action === null || action === undefined) return null;
  if (!action || typeof action !== 'object' || Array.isArray(action)) return null;
  const clean = {
    id: boundedText(action.id, 200),
    source: boundedText(action.source, 80),
    title: boundedText(action.title, 500),
  };
  if (!clean.id || !clean.title) return null;
  if (kind === 'current') clean.startedAt = epochSeconds(action.startedAt);
  if (kind === 'next') clean.status = boundedText(action.status, 80);
  return clean;
}

function sanitizePulseOutcome(outcome) {
  if (outcome === null || outcome === undefined) return null;
  if (!outcome || typeof outcome !== 'object' || Array.isArray(outcome)) return null;
  const selected = outcome.selectedCandidate
    && typeof outcome.selectedCandidate === 'object'
    && !Array.isArray(outcome.selectedCandidate)
    ? {
        id: boundedText(outcome.selectedCandidate.id, 200),
        title: boundedText(outcome.selectedCandidate.title, 500),
      }
    : null;
  const evidence = Array.isArray(outcome.evidence)
    ? outcome.evidence.slice(0, 20).map((item) => boundedText(item, 500)).filter(Boolean)
    : [];
  return {
    verified: outcome.verified === true,
    observedAt: epochSeconds(outcome.observedAt),
    snapshotId: boundedText(outcome.snapshotId, 200) || null,
    transition: boundedText(outcome.transition, 80).toUpperCase(),
    selectedCandidate: selected?.id ? selected : null,
    summary: boundedText(outcome.summary, 1500),
    evidence,
  };
}

function sanitizeAgentPulse(pulse) {
  if (!pulse || typeof pulse !== 'object' || Array.isArray(pulse)) return null;
  const disposition = boundedText(pulse.disposition, 40).toLowerCase();
  const reason = pulse.reason && typeof pulse.reason === 'object' && !Array.isArray(pulse.reason)
    ? pulse.reason
    : null;
  const initiative = pulse.initiative
    && typeof pulse.initiative === 'object'
    && !Array.isArray(pulse.initiative)
    ? pulse.initiative
    : null;
  if (pulse.schemaVersion !== 1 || !PULSE_DISPOSITIONS.has(disposition) || !reason || !initiative) {
    return null;
  }
  const reasonCode = boundedText(reason.code, 80).toUpperCase();
  const initiativeReason = boundedText(initiative.reasonCode, 80).toUpperCase();
  const initiativeState = boundedText(initiative.state, 80).toLowerCase();
  if (!reasonCode || !initiativeReason || !PULSE_INITIATIVE_STATES.has(initiativeState)) return null;
  return {
    schemaVersion: 1,
    updatedAt: epochSeconds(pulse.updatedAt),
    disposition,
    reason: {
      code: reasonCode,
      summary: boundedText(reason.summary, 1500),
    },
    objective: boundedText(pulse.objective, 500) || null,
    currentAction: sanitizePulseAction(pulse.currentAction, 'current'),
    nextAction: sanitizePulseAction(pulse.nextAction, 'next'),
    initiative: {
      state: initiativeState,
      reasonCode: initiativeReason,
      attentionRequired: initiative.attentionRequired === true,
      wakeId: Number.isSafeInteger(initiative.wakeId) && initiative.wakeId > 0
        ? initiative.wakeId
        : null,
      nextJudgmentAt: epochSeconds(initiative.nextJudgmentAt),
    },
    lastOutcome: sanitizePulseOutcome(pulse.lastOutcome),
  };
}

function quotePosix(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function localShellKind(shell, platform) {
  const executable = String(shell || '').split(/[\\/]/).pop().toLowerCase();
  if (['powershell', 'powershell.exe', 'pwsh', 'pwsh.exe'].includes(executable)) return 'powershell';
  if (['cmd', 'cmd.exe'].includes(executable)) return 'cmd';
  if (!executable && platform === 'win32') return 'cmd';
  return 'posix';
}

function quoteForLocalShell(value, shell, platform) {
  const kind = localShellKind(shell, platform);
  if (kind === 'powershell') return `'${String(value).replace(/'/g, "''")}'`;
  if (kind === 'cmd') return `"${String(value).replace(/"/g, '""')}"`;
  return quotePosix(value);
}

function sshDestination(seat) {
  return `${seat.user}@${seat.host}`;
}

function snapshotSshArgs(seat) {
  const agent = quotePosix(seat.agent);
  const manifestPath = quotePosix(`seats/${seat.agent}.json`);
  const remoteCommand = [
    `cd -- ${quotePosix(seat.enginePath)} || exit 71`,
    `printf '%s\\n' '__NOCK_STATUS__'`,
    `./scripts/status ${agent} 2>&1 || true`,
    `printf '%s\\n' '__NOCK_QUEUE__'`,
    `./scripts/queue ${agent} list 2>&1 || true`,
    `printf '%s\\n' '__NOCK_CONTROL__'`,
    `if [ -x ./scripts/control ]; then ./scripts/control ${agent} 'status' 2>/dev/null || true; fi`,
    `printf '%s\\n' '__NOCK_MANIFEST__'`,
    `cat -- ${manifestPath} 2>/dev/null || true`,
  ].join('; ');

  return baseSshArgs(seat, remoteCommand);
}

function baseSshArgs(seat, remoteCommand) {
  return [
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=5',
    '-o', 'LogLevel=ERROR',
    '-p', String(seat.port),
    '--', sshDestination(seat), remoteCommand,
  ];
}

function section(output, name, nextName) {
  const startMarker = `__NOCK_${name}__`;
  const start = output.indexOf(startMarker);
  if (start === -1) return '';
  const bodyStart = start + startMarker.length;
  const end = nextName ? output.indexOf(`__NOCK_${nextName}__`, bodyStart) : -1;
  return output.slice(bodyStart, end === -1 ? undefined : end).trim();
}

function parseCounts(text) {
  const counts = {};
  const countPattern = /['"]([A-Za-z_]+)['"]\s*:\s*(\d+)/g;
  let match = countPattern.exec(text);
  while (match) {
    counts[match[1]] = Number(match[2]);
    match = countPattern.exec(text);
  }
  return counts;
}

function parseQueue(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^#\s*(\d+)\s+(\S+)\s+([^/\s]+)\/(\S+)\s+a=(\d+)\s+.*?::\s*(.*)$/);
    if (!match) continue;
    rows.push({
      id: Number(match[1]),
      state: match[2].slice(0, 40),
      class: match[3].slice(0, 40),
      source: match[4].slice(0, 80),
      attempts: Number(match[5]),
      summary: match[6].slice(0, 500),
    });
    if (rows.length >= 50) break;
  }
  return rows;
}

function parseManifest(text) {
  try {
    const manifest = JSON.parse(text);
    const budget = manifest?.turn_budget && typeof manifest.turn_budget === 'object'
      ? manifest.turn_budget
      : {};
    return {
      runtime: String(manifest?.runtime || '').slice(0, 80),
      model: String(manifest?.model || '').slice(0, 160),
      home: String(manifest?.home || '').slice(0, 1000),
      workDir: String(manifest?.work_dir || '').slice(0, 1000),
      turnBudget: {
        enabled: budget.enabled === true,
        hardSeconds: Number.isFinite(budget.hard_s) ? budget.hard_s : null,
      },
    };
  } catch {
    return {
      runtime: '',
      model: '',
      home: '',
      workDir: '',
      turnBudget: { enabled: false, hardSeconds: null },
    };
  }
}

function emptyControlState() {
  return {
    available: false,
    seatState: 'unknown',
    paused: false,
    turn: { active: false, id: '', batch: null, class: '', steerable: false },
    capabilities: {
      pause: false,
      resume: false,
      cancelTurn: false,
      queueRetry: false,
      queueAcknowledge: false,
    },
    pulse: null,
  };
}

function sanitizeControlPayloadState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return null;
  const turn = state.turn && typeof state.turn === 'object' && !Array.isArray(state.turn)
    ? state.turn
    : {};
  const capabilities = state.capabilities
    && typeof state.capabilities === 'object'
    && !Array.isArray(state.capabilities)
    ? state.capabilities
    : {};
  return {
    seatState: String(state.seatState || 'unknown').slice(0, 80),
    paused: state.paused === true,
    turn: {
      active: turn.active === true,
      id: String(turn.id || '').slice(0, 160),
      batch: Number.isSafeInteger(turn.batch) ? turn.batch : null,
      class: String(turn.class || '').slice(0, 80),
      steerable: turn.steerable === true,
    },
    capabilities: {
      pause: capabilities.pause === true,
      resume: capabilities.resume === true,
      cancelTurn: capabilities.cancelTurn === true,
      queueRetry: capabilities.queueRetry === true,
      queueAcknowledge: capabilities.queueAcknowledge === true,
    },
    pulse: sanitizeAgentPulse(state.pulse),
  };
}

function parseControlResponse(text) {
  const lines = String(text || '').trim().split(/\r?\n/).reverse();
  for (const line of lines) {
    const candidate = line.trim();
    if (!candidate.startsWith('{')) continue;
    try {
      const response = JSON.parse(candidate);
      if (response?.schemaVersion !== 1 || typeof response?.ok !== 'boolean') continue;
      return {
        schemaVersion: 1,
        ok: response.ok,
        action: String(response.action || '').slice(0, 40),
        code: String(response.code || '').slice(0, 80),
        message: String(response.message || '').slice(0, 500),
        state: sanitizeControlPayloadState(response.state),
      };
    } catch {
      // A bounded remote command can put a shell diagnostic before the JSON.
    }
  }
  return null;
}

function parseControlState(text) {
  const response = parseControlResponse(text);
  const state = response?.ok ? response.state : null;
  if (!state) return emptyControlState();
  return {
    available: true,
    ...state,
  };
}

function parseHarnessSnapshot(output, seat) {
  const statusText = section(String(output || ''), 'STATUS', 'QUEUE');
  const queueText = section(String(output || ''), 'QUEUE', 'CONTROL');
  const controlText = section(String(output || ''), 'CONTROL', 'MANIFEST');
  const manifestText = section(String(output || ''), 'MANIFEST');
  const daemon = statusText.match(/^[^\r\n]*-agentd\s*:\s*(\S+)/m);
  const context = statusText.match(
    /context\s*:\s*\[[^\]]*\]\s*([\d.]+)%\s*\(([\d,]+)\s*\/\s*([\d,]+)\s+tokens\)\s*warn\s+([\d.]+)%\s*[·.]\s*rotate\s+([\d.]+)%/i
  );
  const thread = statusText.match(/thread age\s*:\s*([\d.]+)h\s*\(routine rotate at\s*([\d.]+)h\)/i);
  const lastTurn = statusText.match(/last turn\s*:\s*(\S+)\s*\[([^\]]+)\]\s*(.*)$/im);
  const statusQueue = statusText.match(/queue\s*:\s*(\{[^\r\n]+\}|empty)/i);

  return {
    seatId: seat.id,
    connected: true,
    daemonStatus: daemon?.[1]?.slice(0, 40) || 'unknown',
    context: {
      ratio: context ? Number(context[1]) / 100 : 0,
      tokensUsed: context ? Number(context[2].replaceAll(',', '')) : 0,
      contextWindow: context ? Number(context[3].replaceAll(',', '')) : 0,
      warnRatio: context ? Number(context[4]) / 100 : 0,
      rotateRatio: context ? Number(context[5]) / 100 : 0,
    },
    threadAgeHours: thread ? Number(thread[1]) : 0,
    routineRotateHours: thread ? Number(thread[2]) : 0,
    queueCounts: parseCounts(statusQueue?.[1] || queueText),
    queue: parseQueue(queueText),
    lastTurn: lastTurn
      ? { status: lastTurn[1], source: lastTurn[2], age: lastTurn[3].trim().slice(0, 120) }
      : { status: 'none', source: '', age: '' },
    control: parseControlState(controlText),
    manifest: parseManifest(manifestText),
  };
}

function buildHarnessControlDescriptor(input, action, options = {}) {
  const seat = normalizeHarnessSeat(input);
  if (!seat || !CONTROL_ACTIONS.has(action)) {
    return {
      success: false,
      code: 'IPC_VALIDATION_ERROR',
      error: 'Harness control request did not match a configured seat and supported action.',
    };
  }
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    return {
      success: false,
      code: 'IPC_VALIDATION_ERROR',
      error: 'Harness control options must be an object.',
    };
  }

  const queueAction = action === 'queue-retry' || action === 'queue-acknowledge';
  const wakeId = options.wakeId;
  if (queueAction && (!Number.isSafeInteger(wakeId) || wakeId < 1)) {
    return {
      success: false,
      code: 'IPC_VALIDATION_ERROR',
      error: 'Queue controls require a positive wake id.',
    };
  }
  const note = typeof options.note === 'string' ? options.note.trim() : '';
  if (action === 'queue-acknowledge' && (note.length < 10 || note.length > 500)) {
    return {
      success: false,
      code: 'IPC_VALIDATION_ERROR',
      error: 'Acknowledging a wake requires a 10–500 character review note.',
    };
  }

  const command = ['./scripts/control', quotePosix(seat.agent), quotePosix(action)];
  if (queueAction) command.push('--wake-id', quotePosix(String(wakeId)));
  if (action === 'queue-acknowledge') command.push('--note', quotePosix(note));
  command.push('--operator', quotePosix('nock-terminal'));
  const remoteCommand = [
    `cd -- ${quotePosix(seat.enginePath)} || exit 71`,
    `${command.join(' ')} 2>/dev/null || true`,
  ].join('; ');

  return {
    success: true,
    seatId: seat.id,
    destination: sshDestination(seat),
    action,
    remoteCommand,
    sshArgs: baseSshArgs(seat, remoteCommand),
  };
}

function buildHarnessLaunchDescriptor(input, mode, { shell = '', platform = process.platform } = {}) {
  const seat = normalizeHarnessSeat(input);
  if (!seat || !LAUNCH_MODES.has(mode)) {
    return {
      success: false,
      code: 'IPC_VALIDATION_ERROR',
      error: 'Harness launch request did not match a configured seat and supported mode.',
    };
  }

  const remoteCommands = {
    console: `cd -- ${quotePosix(seat.enginePath)} && exec ./scripts/console ${quotePosix(seat.agent)}`,
    watch: `cd -- ${quotePosix(seat.enginePath)} && exec ./scripts/watch ${quotePosix(seat.agent)}`,
    shell: `cd -- ${quotePosix(seat.enginePath)} && exec \${SHELL:-/bin/bash} -l`,
  };
  const command = [
    'ssh -t',
    '-o BatchMode=yes',
    '-o ServerAliveInterval=20',
    '-o ServerAliveCountMax=3',
    `-p ${seat.port}`,
    '--',
    quoteForLocalShell(sshDestination(seat), shell, platform),
    quoteForLocalShell(remoteCommands[mode], shell, platform),
  ].join(' ');
  const labels = {
    console: 'Console',
    watch: 'Watch',
    shell: 'Engine Shell',
  };

  return {
    success: true,
    seatId: seat.id,
    mode,
    title: `${seat.label} · ${labels[mode]}`,
    command,
    destination: sshDestination(seat),
  };
}

async function defaultRunSsh(args, options) {
  return execFileAsync('ssh', args, options);
}

class HarnessSeatService {
  constructor({ runSsh = defaultRunSsh } = {}) {
    this.runSsh = runSsh;
  }

  async snapshot(input) {
    const seat = normalizeHarnessSeat(input);
    if (!seat) {
      return {
        success: false,
        code: 'IPC_VALIDATION_ERROR',
        error: 'Harness snapshot request did not match a valid SSH seat.',
      };
    }

    try {
      const { stdout = '' } = await this.runSsh(snapshotSshArgs(seat), {
        timeout: SNAPSHOT_TIMEOUT_MS,
        maxBuffer: SNAPSHOT_MAX_BUFFER,
        windowsHide: true,
      });
      return { success: true, snapshot: parseHarnessSnapshot(stdout, seat) };
    } catch (error) {
      const destination = sshDestination(seat);
      if (error?.killed || error?.signal === 'SIGTERM' || error?.code === 'ETIMEDOUT') {
        return {
          success: false,
          code: 'HARNESS_SSH_TIMEOUT',
          error: `Timed out connecting to ${destination}. Check the seat host and network.`,
        };
      }
      return {
        success: false,
        code: 'HARNESS_SSH_UNREACHABLE',
        error: `SSH could not reach ${destination}. Verify the host alias and key.`,
      };
    }
  }

  async control(input, action, options = {}) {
    const descriptor = buildHarnessControlDescriptor(input, action, options);
    if (!descriptor.success) return descriptor;

    try {
      const { stdout = '' } = await this.runSsh(descriptor.sshArgs, {
        timeout: SNAPSHOT_TIMEOUT_MS,
        maxBuffer: SNAPSHOT_MAX_BUFFER,
        windowsHide: true,
      });
      const control = parseControlResponse(stdout);
      if (!control) {
        return {
          success: false,
          code: 'HARNESS_CONTROL_UNAVAILABLE',
          error: 'This harness engine does not publish typed operator controls yet.',
        };
      }
      if (!control.ok) {
        return {
          success: false,
          code: control.code || 'HARNESS_CONTROL_REFUSED',
          error: control.message || 'The harness refused that control action.',
          control,
        };
      }
      return { success: true, control };
    } catch (error) {
      if (error?.killed || error?.signal === 'SIGTERM' || error?.code === 'ETIMEDOUT') {
        return {
          success: false,
          code: 'HARNESS_SSH_TIMEOUT',
          error: `Timed out connecting to ${descriptor.destination}. The control action was not confirmed.`,
        };
      }
      return {
        success: false,
        code: 'HARNESS_SSH_UNREACHABLE',
        error: `SSH could not reach ${descriptor.destination}. The control action was not confirmed.`,
      };
    }
  }

  launch(input, mode, options) {
    return buildHarnessLaunchDescriptor(input, mode, options);
  }
}

module.exports = {
  CONTROL_ACTIONS,
  HarnessSeatService,
  buildHarnessControlDescriptor,
  buildHarnessLaunchDescriptor,
  parseHarnessSnapshot,
  snapshotSshArgs,
};
