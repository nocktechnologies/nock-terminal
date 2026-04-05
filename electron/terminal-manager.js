const EventEmitter = require('events');
const os = require('os');

class TerminalManager extends EventEmitter {
  constructor() {
    super();
    this.terminals = new Map();
    this.pty = null;
    // Lazy-load node-pty to handle missing native module gracefully
    try {
      this.pty = require('node-pty');
    } catch (err) {
      console.error('node-pty not available:', err.message);
    }
  }

  create(id, cwd, shellPath) {
    if (!this.pty) {
      return { success: false, error: 'node-pty not available' };
    }

    if (this.terminals.has(id)) {
      this.destroy(id);
    }

    const shell = shellPath || this._defaultShell();
    const args = this._defaultArgs(shell);

    try {
      const ptyProcess = this.pty.spawn(shell, args, {
        name: 'xterm-256color',
        cols: 120,
        rows: 30,
        cwd: cwd || os.homedir(),
        env: { ...process.env, TERM: 'xterm-256color' },
      });

      ptyProcess.onData((data) => {
        this.emit('data', id, data);
      });

      ptyProcess.onExit(({ exitCode }) => {
        this.terminals.delete(id);
        this.emit('exit', id, exitCode);
      });

      this.terminals.set(id, ptyProcess);
      return { success: true, id, pid: ptyProcess.pid };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  write(id, data) {
    const term = this.terminals.get(id);
    if (term) {
      term.write(data);
    }
  }

  resize(id, cols, rows) {
    const term = this.terminals.get(id);
    if (term) {
      try {
        term.resize(cols, rows);
      } catch {
        // Ignore resize errors on dead processes
      }
    }
  }

  destroy(id) {
    const term = this.terminals.get(id);
    if (term) {
      try {
        term.kill();
      } catch {
        // Process may already be dead
      }
      this.terminals.delete(id);
    }
  }

  destroyAll() {
    for (const [id] of this.terminals) {
      this.destroy(id);
    }
  }

  getActiveCount() {
    return this.terminals.size;
  }

  _defaultShell() {
    if (process.platform === 'win32') {
      return process.env.COMSPEC || 'powershell.exe';
    }
    return process.env.SHELL || '/bin/bash';
  }

  _defaultArgs(shell) {
    if (process.platform === 'win32') {
      if (shell.toLowerCase().includes('powershell')) {
        return ['-NoLogo'];
      }
      return [];
    }
    return [];
  }
}

module.exports = TerminalManager;
