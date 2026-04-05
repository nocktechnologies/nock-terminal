const { spawn } = require('child_process');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

class ClaudeCodeClient {
  constructor(binaryPath) {
    this.binaryPath = binaryPath || this._detectBinary();
  }

  setBinaryPath(binaryPath) {
    this.binaryPath = binaryPath || this._detectBinary();
  }

  async chat(message, mode, cwd, maraBriefPath, onChunk) {
    const binary = this.binaryPath;
    if (!binary) {
      throw new Error('Claude Code binary not found');
    }

    // Build the prompt
    let prompt = message;
    if (mode === 'mara' && maraBriefPath) {
      try {
        const briefContent = await fsp.readFile(maraBriefPath, 'utf-8');
        prompt = `${briefContent}\n\n---\n\n${message}`;
      } catch (err) {
        console.error('Failed to read mara brief:', err.message);
      }
    }

    // Validate binary path — reject shell metacharacters to prevent injection
    if (/[&|;$`<>()\n\r"']/.test(binary)) {
      throw new Error('Invalid characters in Claude Code binary path');
    }

    return new Promise((resolve, reject) => {
      const args = ['-p', '--output-format', 'stream-json'];

      // On Windows, .cmd/.bat files cannot be spawned directly with shell:false
      // (Node 20+ CVE-2024-27980). Route through cmd.exe with array args (safe).
      let executable = binary;
      let spawnArgs = args;
      if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(binary)) {
        executable = process.env.COMSPEC || 'cmd.exe';
        spawnArgs = ['/d', '/s', '/c', binary, ...args];
      }

      const child = spawn(executable, spawnArgs, {
        cwd: cwd || process.cwd(),
        env: { ...process.env },
        shell: false,
        windowsHide: true,
      });

      // Settlement state — prevents late stdout/chunk events from firing
      // after the promise has resolved/rejected (timeout, error, early exit).
      let settled = false;
      let fullResponse = '';
      let buffer = '';

      const finish = (payload) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(payload);
      };
      const fail = (message) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        try { child.kill(); } catch { /* already dead */ }
        reject(new Error(message));
      };
      const emitChunk = (text) => {
        if (settled || !onChunk) return;
        onChunk(text);
      };

      // Timeout: kill hung process after 60 seconds (hard failure → reject)
      const timeout = setTimeout(() => {
        fail('Claude Code timed out after 60s');
      }, 60000);

      // Guard stdin — child may die immediately during spawn
      child.stdin.on('error', (err) => {
        console.error('Claude Code stdin error:', err.message);
      });
      try {
        child.stdin.write(prompt);
        child.stdin.end();
      } catch (err) {
        fail(`stdin write failed: ${err.message}`);
        return;
      }

      child.stdout.on('data', (data) => {
        if (settled) return;
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);
            if (event.type === 'content_block_delta' && event.delta?.text) {
              fullResponse += event.delta.text;
              emitChunk(event.delta.text);
            } else if (event.type === 'assistant' && event.message?.content) {
              for (const block of event.message.content) {
                if (block.type === 'text') {
                  fullResponse += block.text;
                  emitChunk(block.text);
                }
              }
            } else if (event.type === 'result' && event.result) {
              fullResponse = event.result;
              emitChunk(event.result);
            }
          } catch {
            if (line.trim()) {
              fullResponse += line;
              emitChunk(line);
            }
          }
        }
      });

      child.stderr.on('data', (data) => {
        // Log but don't fail — stderr often has progress info
        console.error('Claude Code stderr:', data.toString());
      });

      child.on('close', (code) => {
        if (settled) return;
        // Process remaining buffer — mirror the full branch set from stdout handler
        if (buffer.trim()) {
          try {
            const event = JSON.parse(buffer);
            if (event.type === 'content_block_delta' && event.delta?.text) {
              fullResponse += event.delta.text;
              emitChunk(event.delta.text);
            } else if (event.type === 'assistant' && event.message?.content) {
              for (const block of event.message.content) {
                if (block.type === 'text') {
                  fullResponse += block.text;
                  emitChunk(block.text);
                }
              }
            } else if (event.type === 'result' && event.result) {
              fullResponse = event.result;
              emitChunk(event.result);
            }
          } catch {
            fullResponse += buffer;
            emitChunk(buffer);
          }
        }
        // Non-zero exit with no content is a hard failure
        if (code !== 0 && !fullResponse) {
          fail(`Claude Code exited with code ${code}`);
          return;
        }
        finish({
          success: code === 0,
          content: fullResponse,
          mode,
          exitCode: code,
        });
      });

      child.on('error', (err) => {
        fail(`Failed to spawn Claude Code: ${err.message}`);
      });
    });
  }

  _detectBinary() {
    // Check absolute paths first; bare-command PATH fallback last
    const candidates = [];

    if (process.platform === 'win32') {
      candidates.push(
        path.join(process.env.APPDATA || '', 'npm', 'claude.cmd'),
        path.join(process.env.LOCALAPPDATA || '', 'Programs', 'claude', 'claude.exe'),
        'claude.cmd', // PATH fallback
        'claude',     // PATH fallback
      );
    } else {
      candidates.push(
        '/usr/local/bin/claude',
        path.join(process.env.HOME || '', '.local', 'bin', 'claude'),
        'claude', // PATH fallback
      );
    }

    for (const candidate of candidates) {
      try {
        // Absolute path: check existence before returning
        if (candidate.includes(path.sep) || candidate.includes('/')) {
          if (fs.existsSync(candidate)) return candidate;
        }
      } catch {
        continue;
      }
    }

    // No absolute path matched — fall back to bare command, spawn() will
    // resolve via PATH. On Windows prefer .cmd since npm installs it that way.
    return process.platform === 'win32' ? 'claude.cmd' : 'claude';
  }
}

module.exports = ClaudeCodeClient;
