'use strict';

const path = require('path');
const defaultFs = require('fs');
const { execFile: defaultExecFile } = require('child_process');

const VERSION_PROBE_OPTIONS = {
  timeout: 3000,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
};

function firstLine(value) {
  if (!value) return '';
  return value.toString().split('\n')[0].trim();
}

function execFilePromise(execFile, command, args, options) {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function readCommandOutput(execFile, command, args, options) {
  try {
    const { stdout } = await execFilePromise(execFile, command, args, {
      ...options,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return firstLine(stdout);
  } catch (err) {
    return firstLine(err.stdout);
  }
}

async function commandProbe(execFile, command, args, options) {
  try {
    const { stdout } = await execFilePromise(execFile, command, args, {
      ...options,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { found: true, output: firstLine(stdout) };
  } catch (err) {
    return {
      found: err.code !== 'ENOENT',
      output: firstLine(err.stdout),
    };
  }
}

async function pathExists(fs, filePath) {
  if (fs.promises?.access) {
    try {
      await fs.promises.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
  return fs.existsSync(filePath);
}

async function realpath(fs, filePath) {
  if (fs.promises?.realpath) {
    return fs.promises.realpath(filePath);
  }
  return fs.realpathSync(filePath);
}

async function listWindowsShells({ fs, execFile, env }) {
  const powerShellOptions = {
    timeout: 5000,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  };

  const cmdPath = env.ComSpec || env.COMSPEC || 'C:\\Windows\\System32\\cmd.exe';
  const [pwsh, windowsPowerShell, cmdExists, wsl] = await Promise.all([
    commandProbe(execFile, 'pwsh', [
      '-NoProfile',
      '-Command',
      '$PSVersionTable.PSVersion.ToString()',
    ], powerShellOptions),
    commandProbe(execFile, 'powershell', [
      '-NoProfile',
      '-Command',
      '$PSVersionTable.PSVersion.ToString()',
    ], powerShellOptions),
    pathExists(fs, cmdPath),
    commandProbe(execFile, 'wsl', ['--status'], powerShellOptions),
  ]);

  const shells = [];
  if (pwsh.found) {
    shells.push({ name: 'PowerShell 7', path: 'pwsh', version: pwsh.output });
  }
  if (windowsPowerShell.found) {
    shells.push({ name: 'Windows PowerShell', path: 'powershell', version: windowsPowerShell.output });
  }
  if (cmdExists) {
    shells.push({ name: 'Command Prompt', path: cmdPath, version: '' });
  }

  for (const gitBashPath of [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
  ]) {
    if (await pathExists(fs, gitBashPath)) {
      shells.push({ name: 'Git Bash', path: gitBashPath, version: '' });
      break;
    }
  }

  if (wsl.found) {
    shells.push({ name: 'WSL', path: 'wsl', version: '' });
  }

  return shells;
}

async function listPosixShells({ fs, execFile, env }) {
  const candidates = [];
  if (env.SHELL) {
    const base = path.basename(env.SHELL);
    candidates.push({ name: base.charAt(0).toUpperCase() + base.slice(1), path: env.SHELL });
  }

  for (const { name, paths } of [
    { name: 'Zsh', paths: ['/bin/zsh', '/usr/bin/zsh', '/usr/local/bin/zsh', '/opt/homebrew/bin/zsh'] },
    { name: 'Bash', paths: ['/bin/bash', '/usr/bin/bash', '/usr/local/bin/bash', '/opt/homebrew/bin/bash'] },
    { name: 'Fish', paths: ['/usr/bin/fish', '/usr/local/bin/fish', '/opt/homebrew/bin/fish'] },
    { name: 'Dash', paths: ['/bin/dash', '/usr/bin/dash'] },
  ]) {
    for (const shellPath of paths) {
      candidates.push({ name, path: shellPath });
    }
  }

  const resolved = await Promise.all(candidates.map(async (candidate) => {
    if (!await pathExists(fs, candidate.path)) return null;
    try {
      return {
        ...candidate,
        canonical: await realpath(fs, candidate.path),
      };
    } catch {
      return null;
    }
  }));

  const seen = new Set();
  const unique = [];
  for (const candidate of resolved) {
    if (!candidate || seen.has(candidate.canonical)) continue;
    seen.add(candidate.canonical);
    unique.push(candidate);
  }

  const versions = await Promise.all(unique.map((candidate) => (
    readCommandOutput(execFile, candidate.path, ['--version'], VERSION_PROBE_OPTIONS)
  )));

  return unique.map((candidate, index) => ({
    name: candidate.name,
    path: candidate.path,
    version: versions[index],
  }));
}

async function listAvailableShells({
  platform = process.platform,
  env = process.env,
  fs = defaultFs,
  execFile = defaultExecFile,
} = {}) {
  if (platform === 'win32') {
    return listWindowsShells({ fs, execFile, env });
  }
  return listPosixShells({ fs, execFile, env });
}

module.exports = {
  listAvailableShells,
};
