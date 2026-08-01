const { execFile } = require('child_process');
const { promisify } = require('util');
const { normalizeHarnessSeat } = require('./harness-seat-utils');

const execFileAsync = promisify(execFile);
const SNAPSHOT_TIMEOUT_MS = 8000;
const SNAPSHOT_MAX_BUFFER = 512 * 1024;
const LAUNCH_MODES = new Set(['console', 'watch', 'shell']);

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
    `printf '%s\\n' '__NOCK_MANIFEST__'`,
    `cat -- ${manifestPath} 2>/dev/null || true`,
  ].join('; ');

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

function parseHarnessSnapshot(output, seat) {
  const statusText = section(String(output || ''), 'STATUS', 'QUEUE');
  const queueText = section(String(output || ''), 'QUEUE', 'MANIFEST');
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
    manifest: parseManifest(manifestText),
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

  launch(input, mode, options) {
    return buildHarnessLaunchDescriptor(input, mode, options);
  }
}

module.exports = {
  HarnessSeatService,
  buildHarnessLaunchDescriptor,
  parseHarnessSnapshot,
  snapshotSshArgs,
};
