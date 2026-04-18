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
        // ConPTY's console list agent crashes with AttachConsole on Node 18+
        // (Electron 28). Disable it to use the stable winpty backend instead.
        useConpty: process.platform !== 'win32',
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
    if (!term) return;

    // ConPTY on Windows can drop or corrupt large inputs sent in a single write.
    // Chunk into 512-byte segments with 1ms spacing to stay within buffer limits.
    const CHUNK_SIZE = 512;
    if (data.length <= CHUNK_SIZE) {
      term.write(data);
      return;
    }

    let offset = 0;
    const writeChunk = () => {
      if (offset >= data.length || !this.terminals.has(id)) return;
      const chunk = data.slice(offset, offset + CHUNK_SIZE);
      term.write(chunk);
      offset += CHUNK_SIZE;
      if (offset < data.length) {
        setTimeout(writeChunk, 1);
      }
    };
    writeChunk();
  }

  resize(id, cols, rows) {
    const term = this.terminals.get(id);
    if (term && cols > 0 && rows > 0) {
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
      // Prefer PowerShell 7 (pwsh), fall back to Windows PowerShell 5.1, then cmd.
      // NEVER use COMSPEC first — it points to cmd.exe, which can't see user's
      // PowerShell profile functions (e.g. `cc`, `nockcc` wrappers).
      const fs = require('fs');
      const path = require('path');
      const { spawnSync } = require('child_process');

      // 1. Check standard install locations (fast, no subprocess)
      const candidates = [
        path.join(process.env.ProgramFiles || '', 'PowerShell', '7', 'pwsh.exe'),
        path.join(process.env['ProgramFiles(x86)'] || '', 'PowerShell', '7', 'pwsh.exe'),
        path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ];
      for (const candidate of candidates) {
        try {
          if (fs.existsSync(candidate)) return candidate;
        } catch { /* try next */ }
      }

      // 2. Resolve via PATH with `where` — catches winget, scoop, portable
      //    installs, and anything else on %PATH% (e.g. user-managed pwsh).
      for (const exe of ['pwsh.exe', 'powershell.exe']) {
        try {
          const res = spawnSync('where', [exe], {
            encoding: 'utf-8',
            windowsHide: true,
            timeout: 3000,
          });
          if (res.status === 0 && res.stdout) {
            const firstMatch = res.stdout.split(/\r?\n/).find(l => l.trim());
            if (firstMatch && fs.existsSync(firstMatch.trim())) {
              return firstMatch.trim();
            }
          }
        } catch { /* try next */ }
      }

      // 3. Last resort: cmd.exe (user loses PS profile but terminal still works)
      return process.env.COMSPEC || 'powershell.exe';
    }
    return process.env.SHELL || '/bin/bash';
  }

  _defaultArgs(shell) {
    if (process.platform === 'win32') {
      const lower = shell.toLowerCase();
      // -NoLogo suppresses the banner. We intentionally do NOT pass -NoProfile
      // so the user's $PROFILE loads (functions like `cc`, aliases, modules).
      if (lower.includes('powershell') || lower.includes('pwsh')) {
        return ['-NoLogo'];
      }
      return [];
    }
    // -i makes the shell interactive so ~/.zshrc / ~/.bashrc load (aliases like
    // cc, mara, kit live there). -l also makes it a login shell, so ~/.zprofile /
    // ~/.bash_profile run for PATH (Homebrew, etc.). Both are needed.
    const base = shell.split('/').pop();
    if (base === 'zsh' || base === 'bash') {
      return ['-i', '-l'];
    }
    return [];
  }
}

module.exports = TerminalManager;
