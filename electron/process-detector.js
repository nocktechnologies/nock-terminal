const { execSync } = require('child_process');
const EventEmitter = require('events');

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
        const hasClaude = this._hasClaudeInTree(rootPid, processes);
        this.emit('status', { tabId, hasClaude });
      }
    } catch (err) {
      // Silently fail
    }
  }

  _hasClaudeInTree(rootPid, processes) {
    const claudeNames = ['claude.exe', 'claude.cmd', 'claude'];
    const visited = new Set();
    const queue = [rootPid];

    while (queue.length > 0) {
      const pid = queue.shift();
      if (visited.has(pid)) continue;
      visited.add(pid);

      for (const proc of processes) {
        if (proc.ppid === pid) {
          if (claudeNames.some(name => proc.name.toLowerCase() === name.toLowerCase())) {
            return true;
          }
          queue.push(proc.pid);
        }
      }
    }
    return false;
  }

  _detectUnix() {
    for (const [tabId, ptyProcess] of this.terminalManager.terminals) {
      try {
        const output = execSync(`pgrep -P ${ptyProcess.pid} -a 2>/dev/null || true`, {
          encoding: 'utf-8',
          timeout: 3000,
        });
        const hasClaude = /claude/i.test(output);
        this.emit('status', { tabId, hasClaude });
      } catch {
        this.emit('status', { tabId, hasClaude: false });
      }
    }
  }
}

module.exports = ProcessDetector;
