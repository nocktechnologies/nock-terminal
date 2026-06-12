const EventEmitter = require('events');
const os = require('os');

const WRITE_CHUNK_SIZE = 512;

// Environment variables that let a project profile run arbitrary code in the
// spawned shell — dynamic-loader injection and shell/runtime startup hooks.
// A project's profile must never be able to set these on a user's terminal.
const BLOCKED_ENV_VAR_NAMES = new Set([
  'NODE_OPTIONS',
  'BASH_ENV',
  'ENV',
  'PROMPT_COMMAND',
  'GLOBIGNORE',
  'PERL5OPT',
  'PYTHONSTARTUP',
]);
const BLOCKED_ENV_VAR_PREFIXES = ['LD_', 'DYLD_'];

function isBlockedEnvVar(key) {
  const upper = key.toUpperCase();
  if (BLOCKED_ENV_VAR_NAMES.has(upper)) return true;
  return BLOCKED_ENV_VAR_PREFIXES.some(prefix => upper.startsWith(prefix));
}

class TerminalManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.terminals = new Map();
    this.terminalMeta = new Map();
    // Stash for in-flight destroy() intent. Lets onExit emit with reason:'destroyed'
    // even when node-pty fires the exit event synchronously inside kill().
    this._destroyIntents = new Map();
    // Per-id write queues so chunked large writes don't interleave with each other.
    this._writeQueues = new Map();
    this.now = typeof options.now === 'function' ? options.now : () => Date.now();
    this.isPidAlive = typeof options.isPidAlive === 'function'
      ? options.isPidAlive
      : (pid) => this._pidIsAlive(pid);
    this.pty = null;
    // Lazy-load node-pty to handle missing native module gracefully
    try {
      this.pty = require('node-pty');
    } catch (err) {
      console.error('node-pty not available:', err.message);
    }
  }

  create(id, cwd, launchOptions = {}) {
    if (!this.pty) {
      return { success: false, error: 'node-pty not available' };
    }

    if (this.terminals.has(id)) {
      this.destroy(id);
    }

    const options = typeof launchOptions === 'string'
      ? { shell: launchOptions }
      : (launchOptions || {});
    const shell = options.shell || this._defaultShell();
    const args = [
      ...this._defaultArgs(shell),
      ...this._parseShellArgs(options.shellArgs),
    ];
    const envVars = this._parseEnvVars(options.envVars);

    try {
      const ptyProcess = this.pty.spawn(shell, args, {
        name: 'xterm-256color',
        cols: 120,
        rows: 30,
        cwd: cwd || os.homedir(),
        env: { ...process.env, ...envVars, TERM: 'xterm-256color' },
        // ConPTY's console list agent crashes with AttachConsole on Node 18+
        // (Electron 28). Disable it to use the stable winpty backend instead.
        useConpty: process.platform !== 'win32',
      });

      const startedAt = this.now();
      const metadata = {
        id,
        pid: ptyProcess.pid,
        cwd: cwd || os.homedir(),
        shell,
        createdAt: startedAt,
        lastDataAt: null,
        lastResizeAt: null,
        lastWriteAt: null,
      };

      ptyProcess.onData((data) => {
        this._touch(id, 'lastDataAt');
        this.emit('data', id, data);
      });

      ptyProcess.onExit(({ exitCode }) => {
        const intent = this._destroyIntents.get(id);
        this._destroyIntents.delete(id);
        if (intent) {
          this._finalizeTerminal(id, null, { pid: intent.pid, reason: intent.reason });
        } else {
          this._finalizeTerminal(id, exitCode, { reason: 'process-exit' });
        }
      });

      this.terminals.set(id, ptyProcess);
      this.terminalMeta.set(id, metadata);
      return { success: true, id, pid: ptyProcess.pid };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  write(id, data) {
    const term = this.terminals.get(id);
    if (!term || typeof data !== 'string' || data.length === 0) return;
    this._touch(id, 'lastWriteAt');

    // Fast path: small write and nothing already queued — write directly.
    // ConPTY on Windows can drop or corrupt large inputs sent in a single write,
    // so larger payloads go through the per-id chunked queue below.
    const queue = this._writeQueues.get(id);
    if (data.length <= WRITE_CHUNK_SIZE && !queue) {
      term.write(data);
      return;
    }

    if (queue) {
      queue.pending.push(data);
    } else {
      this._writeQueues.set(id, { pending: [data], draining: false });
    }
    this._drainWriteQueue(id);
  }

  _drainWriteQueue(id) {
    const queue = this._writeQueues.get(id);
    if (!queue || queue.draining) return;
    queue.draining = true;

    const step = () => {
      const queueRef = this._writeQueues.get(id);
      const term = this.terminals.get(id);
      if (!queueRef || !term) {
        this._writeQueues.delete(id);
        return;
      }
      if (queueRef.pending.length === 0) {
        this._writeQueues.delete(id);
        return;
      }

      const head = queueRef.pending[0];
      if (head.length <= WRITE_CHUNK_SIZE) {
        term.write(head);
        queueRef.pending.shift();
      } else {
        term.write(head.slice(0, WRITE_CHUNK_SIZE));
        queueRef.pending[0] = head.slice(WRITE_CHUNK_SIZE);
      }

      setTimeout(step, 1);
    };
    step();
  }

  resize(id, cols, rows) {
    const term = this.terminals.get(id);
    if (term && cols > 0 && rows > 0) {
      try {
        term.resize(cols, rows);
        this._touch(id, 'lastResizeAt');
      } catch {
        // Ignore resize errors on dead processes
      }
    }
  }

  destroy(id) {
    const term = this.terminals.get(id);
    if (!term) return;
    const metadata = this.terminalMeta.get(id);
    const pid = metadata?.pid ?? term.pid ?? null;

    // Stash intent BEFORE kill() so a synchronous onExit emits with the right reason.
    this._destroyIntents.set(id, { reason: 'destroyed', pid });
    try {
      term.kill();
    } catch {
      // Process may already be dead
    }
    // If onExit didn't fire synchronously, finalize now for deterministic teardown
    // (callers like destroyAll on app-quit rely on the exit event landing before
    // electron tears down). A later async onExit will be a no-op via the guard
    // in _finalizeTerminal.
    if (this.terminals.has(id)) {
      this._destroyIntents.delete(id);
      this._finalizeTerminal(id, null, { pid, reason: 'destroyed' });
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

  listTerminals() {
    return Array.from(this.terminalMeta.values()).map((metadata) => ({ ...metadata }));
  }

  reapStaleTerminals(options = {}) {
    const liveTerminalIds = new Set(
      Array.isArray(options.liveTerminalIds)
        ? options.liveTerminalIds.filter(id => typeof id === 'string' && id.length > 0)
        : []
    );
    const graceMs = Number.isFinite(options.graceMs)
      ? Math.max(0, options.graceMs)
      : 5_000;
    // When provided, only orphan-reap terminals that existed *before* the renderer
    // started — anything newer is presumed to be a freshly-opened tab the renderer
    // hasn't propagated to its `tabs` state yet. Dead-pid reaping is unconditional.
    const rendererStartedAt = Number.isFinite(options.rendererStartedAt)
      ? options.rendererStartedAt
      : null;
    const now = this.now();
    const reaped = [];

    for (const [id, term] of Array.from(this.terminals.entries())) {
      const metadata = this.terminalMeta.get(id);
      const pid = metadata?.pid ?? term.pid ?? null;

      if (!this.isPidAlive(pid)) {
        this.terminals.delete(id);
        this._finalizeTerminal(id, null, {
          pid,
          reason: 'dead-root-pid',
          reaped: true,
        });
        reaped.push({ id, pid, reason: 'dead-root-pid' });
        continue;
      }

      const createdAt = metadata?.createdAt ?? now;
      const ageMs = now - createdAt;
      const predatesRenderer = rendererStartedAt == null || createdAt < rendererStartedAt;
      if (!liveTerminalIds.has(id) && ageMs >= graceMs && predatesRenderer) {
        try {
          term.kill();
        } catch {
          // Process may already be dead; finalization below still clears state.
        }
        this._finalizeTerminal(id, null, {
          pid,
          reason: 'orphaned-renderer-tab',
          reaped: true,
        });
        reaped.push({ id, pid, reason: 'orphaned-renderer-tab' });
      }
    }

    return {
      success: true,
      reaped,
      activeCount: this.terminals.size,
    };
  }

  _touch(id, field) {
    const metadata = this.terminalMeta.get(id);
    if (metadata) {
      metadata[field] = this.now();
    }
  }

  _finalizeTerminal(id, exitCode, details = {}) {
    const hadTerminal = this.terminals.has(id);
    const hadMetadata = this.terminalMeta.has(id);
    if (!hadTerminal && !hadMetadata) return false;

    this.terminals.delete(id);
    this.terminalMeta.delete(id);
    this.emit('exit', id, exitCode ?? null, details);
    return true;
  }

  _pidIsAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (err) {
      return err?.code === 'EPERM';
    }
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

  _parseShellArgs(value) {
    if (typeof value !== 'string' || value.trim() === '') return [];
    if (value.length > 1000) return [];

    const args = [];
    let current = '';
    let quote = null;

    for (let i = 0; i < value.length; i += 1) {
      const char = value[i];
      const next = value[i + 1];
      if (char === '\\') {
        const escapesQuote = quote && next === quote;
        const escapesCommon = next === '\\' || next === '"' || next === "'";
        const escapesWhitespace = !quote && next && /\s/.test(next);
        if (next && (escapesQuote || escapesCommon || escapesWhitespace)) {
          current += next;
          i += 1;
        } else {
          current += char;
        }
        continue;
      }
      if (quote) {
        if (char === quote) {
          quote = null;
        } else {
          current += char;
        }
        continue;
      }
      if (char === '"' || char === "'") {
        quote = char;
        continue;
      }
      if (/\s/.test(char)) {
        if (current) {
          args.push(current);
          current = '';
        }
        continue;
      }
      current += char;
    }

    if (current) args.push(current);
    return args.slice(0, 50);
  }

  _parseEnvVars(value) {
    if (typeof value !== 'string' || value.trim() === '') return {};

    const env = {};
    for (const rawLine of value.split(/\r?\n/).slice(0, 100)) {
      if (!rawLine || /^\s*#/.test(rawLine)) continue;
      const separator = rawLine.indexOf('=');
      if (separator <= 0) continue;

      const key = rawLine.slice(0, separator);
      const envValue = rawLine.slice(separator + 1);
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
      if (key.length > 128 || envValue.length > 4000) continue;
      if (isBlockedEnvVar(key)) continue;

      env[key] = envValue;
    }
    return env;
  }
}

module.exports = TerminalManager;
