const { execSync, execFileSync } = require('child_process');
const EventEmitter = require('events');
const { matchAgentProcesses } = require('./agent-adapters');

// Parse a `ps -axo pid=,ppid=,command=` table into {pid, ppid, name} rows.
// `name` is the FULL command line (not just comm) so script/arg-based agents
// — e.g. `python3 .../deepseek-agent.py` — still match; matchAgentProcesses
// tokenizes it and extracts basenames.
function parseUnixProcessTable(output) {
  const processes = [];
  for (const line of String(output || '').split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
    if (!match) continue;
    processes.push({
      pid: parseInt(match[1], 10),
      ppid: parseInt(match[2], 10),
      name: match[3],
    });
  }
  return processes;
}

class ProcessDetector extends EventEmitter {
  constructor(terminalManager) {
    super();
    this.terminalManager = terminalManager;
    this.pollInterval = null;
  }

  start() {
    this.pollInterval = setInterval(() => this._detect(), 2000);
  }

  stop() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  _detect() {
    if (process.platform !== 'win32') {
      this._detectUnix();
      return;
    }

    try {
      const output = execSync(
        'powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Csv -NoTypeInformation"',
        { encoding: 'utf-8', timeout: 5000, windowsHide: true }
      );

      const processes = [];
      const lines = output.split('\n').slice(1);
      for (const line of lines) {
        const match = line.match(/"(\d+)","(\d+)","([^"]*)"/);
        if (match) {
          processes.push({
            pid: parseInt(match[1]),
            ppid: parseInt(match[2]),
            name: match[3],
          });
        }
      }

      for (const [tabId, ptyProcess] of this.terminalManager.terminals) {
        const rootPid = ptyProcess.pid;
        const activeAgents = this._agentsInTree(rootPid, processes);
        this.emit('status', {
          tabId,
          activeAgents,
          hasClaude: activeAgents.includes('claude'),
        });
      }
    } catch (err) {
      console.error('ProcessDetector: Windows detection failed:', err.message);
    }
  }

  _agentsInTree(rootPid, processes) {
    const visited = new Set();
    const queue = [rootPid];
    const matched = new Set();

    while (queue.length > 0) {
      const pid = queue.shift();
      if (visited.has(pid)) continue;
      visited.add(pid);

      for (const proc of processes) {
        if (proc.ppid === pid) {
          for (const agentId of matchAgentProcesses([proc.name])) {
            matched.add(agentId);
          }
          queue.push(proc.pid);
        }
      }
    }
    return [...matched];
  }

  _detectUnix() {
    // Snapshot the whole process table once, then walk each PTY's full subtree
    // with the same BFS the Windows path uses. The old `pgrep -P <pid>` only
    // saw DIRECT children, so an agent launched via a wrapper/login-shell (at
    // depth >= 2 — the common case on macOS) was silently reported as inactive.
    let processes;
    try {
      // execFileSync: no shell, no interpolation — ps args are passed directly.
      const output = execFileSync('ps', ['-axo', 'pid=,ppid=,command='], {
        encoding: 'utf-8',
        timeout: 5000,
      });
      processes = parseUnixProcessTable(output);
    } catch (err) {
      console.error('ProcessDetector: Unix detection failed:', err.message);
      // Fail closed: report no active agents rather than crash the poller.
      for (const [tabId] of this.terminalManager.terminals) {
        this.emit('status', { tabId, activeAgents: [], hasClaude: false });
      }
      return;
    }

    for (const [tabId, ptyProcess] of this.terminalManager.terminals) {
      const activeAgents = this._agentsInTree(ptyProcess.pid, processes);
      this.emit('status', {
        tabId,
        activeAgents,
        hasClaude: activeAgents.includes('claude'),
      });
    }
  }
}

module.exports = ProcessDetector;
module.exports.parseUnixProcessTable = parseUnixProcessTable;
