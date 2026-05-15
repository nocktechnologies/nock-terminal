const { execSync } = require('child_process');
const EventEmitter = require('events');
const { matchAgentProcesses } = require('./agent-adapters');

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
    for (const [tabId, ptyProcess] of this.terminalManager.terminals) {
      try {
        const output = execSync(`pgrep -P ${ptyProcess.pid} -a 2>/dev/null || true`, {
          encoding: 'utf-8',
          timeout: 3000,
        });
        const activeAgents = matchAgentProcesses(output.split('\n').filter(Boolean));
        this.emit('status', {
          tabId,
          activeAgents,
          hasClaude: activeAgents.includes('claude'),
        });
      } catch {
        this.emit('status', { tabId, activeAgents: [], hasClaude: false });
      }
    }
  }
}

module.exports = ProcessDetector;
