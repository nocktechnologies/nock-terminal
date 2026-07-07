import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SMOKE_READY_PREFIX = '[nock-terminal-smoke] ready ';

const DEFAULT_TIMEOUT_MS = 45_000;

function repoRootFromModule() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

export function getNpxCommand(platform = process.platform) {
  return platform === 'win32' ? 'npx.cmd' : 'npx';
}

export function createSmokeEnvironment({ baseEnv = process.env, userDataDir }) {
  return {
    ...baseEnv,
    CSC_IDENTITY_AUTO_DISCOVERY: 'false',
    ELECTRON_ENABLE_LOGGING: '1',
    NOCK_TERMINAL_PACKAGED_SMOKE: '1',
    NOCK_TERMINAL_USER_DATA_DIR: userDataDir,
  };
}

export function parseSmokeReadyLine(line) {
  const markerIndex = line.indexOf(SMOKE_READY_PREFIX);
  if (markerIndex === -1) return null;

  const rawPayload = line.slice(markerIndex + SMOKE_READY_PREFIX.length).trim();
  try {
    return JSON.parse(rawPayload);
  } catch {
    return null;
  }
}

export function createSmokeOutputInspector({ onPayload }) {
  const buffers = {
    stdout: '',
    stderr: '',
  };

  const processLine = (line) => {
    const payload = parseSmokeReadyLine(line);
    if (payload) onPayload(payload);
  };

  return {
    inspect(chunk, stream) {
      const text = chunk.toString();
      process[stream].write(text);
      buffers[stream] += text;
      const lines = buffers[stream].split(/\r?\n/);
      buffers[stream] = lines.pop() || '';
      for (const line of lines) {
        processLine(line);
      }
    },
    flush() {
      for (const stream of Object.keys(buffers)) {
        if (!buffers[stream]) continue;
        processLine(buffers[stream]);
        buffers[stream] = '';
      }
    },
  };
}

function parseArgs(argv) {
  const options = {
    skipBuild: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };

  for (const arg of argv) {
    if (arg === '--skip-build') {
      options.skipBuild = true;
      continue;
    }
    if (arg.startsWith('--timeout-ms=')) {
      const timeoutMs = Number.parseInt(arg.slice('--timeout-ms='.length), 10);
      if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
        options.timeoutMs = timeoutMs;
      }
    }
  }

  return options;
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function* walk(dir) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(entryPath);
    } else if (entry.isFile()) {
      yield entryPath;
    }
  }
}

async function findFirstExisting(paths) {
  for (const candidate of paths) {
    if (await pathExists(candidate)) return candidate;
  }
  return null;
}

export async function findPackagedExecutable({ distDir, platform = process.platform }) {
  if (platform === 'darwin') {
    const expected = await findFirstExisting([
      path.join(distDir, 'mac-arm64', 'Nock Terminal.app', 'Contents', 'MacOS', 'Nock Terminal'),
      path.join(distDir, 'mac', 'Nock Terminal.app', 'Contents', 'MacOS', 'Nock Terminal'),
      path.join(distDir, 'mac-universal', 'Nock Terminal.app', 'Contents', 'MacOS', 'Nock Terminal'),
    ]);
    if (expected) return expected;

    for await (const filePath of walk(distDir)) {
      if (filePath.endsWith(`${path.sep}Nock Terminal.app${path.sep}Contents${path.sep}MacOS${path.sep}Nock Terminal`)) {
        return filePath;
      }
    }
  }

  if (platform === 'win32') {
    const expected = await findFirstExisting([
      path.join(distDir, 'win-unpacked', 'Nock Terminal.exe'),
      path.join(distDir, 'win-ia32-unpacked', 'Nock Terminal.exe'),
      path.join(distDir, 'win-arm64-unpacked', 'Nock Terminal.exe'),
    ]);
    if (expected) return expected;

    for await (const filePath of walk(distDir)) {
      if (path.basename(filePath).toLowerCase() === 'nock terminal.exe') {
        return filePath;
      }
    }
  }

  const expected = await findFirstExisting([
    path.join(distDir, 'linux-unpacked', 'nock-terminal'),
    path.join(distDir, 'linux-arm64-unpacked', 'nock-terminal'),
    path.join(distDir, 'linux-unpacked', 'Nock Terminal'),
  ]);
  if (expected) return expected;

  for await (const filePath of walk(distDir)) {
    const base = path.basename(filePath);
    if (base === 'nock-terminal' || base === 'Nock Terminal') {
      return filePath;
    }
  }

  throw new Error(`Could not find packaged executable in ${distDir}`);
}

function runCommand(command, args, { cwd, env }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: 'inherit',
      shell: false,
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} failed with ${signal || code}`));
    });
  });
}

function validateSmokePayload(payload) {
  if (!payload || payload.isPackaged !== true) {
    throw new Error('Packaged smoke did not run against an app.isPackaged build');
  }
  if (!payload.renderer?.bodyHasBrand && !payload.renderer?.bodyHasDashboard) {
    throw new Error('Packaged smoke renderer did not render the Nock Terminal shell');
  }
}

async function runPackagedAppSmoke({ executablePath, rootDir, platform, timeoutMs, baseEnv }) {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nock-terminal-package-smoke-'));
  let readyPayload = null;

  try {
    const env = createSmokeEnvironment({ baseEnv, userDataDir });
    const args = platform === 'linux' ? ['--no-sandbox'] : [];

    await new Promise((resolve, reject) => {
      const child = spawn(executablePath, args, {
        cwd: rootDir,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`Packaged smoke timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const outputInspector = createSmokeOutputInspector({
        onPayload(payload) {
          readyPayload = payload;
        },
      });

      child.stdout.on('data', (chunk) => outputInspector.inspect(chunk, 'stdout'));
      child.stderr.on('data', (chunk) => outputInspector.inspect(chunk, 'stderr'));
      child.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
      child.on('exit', (code, signal) => {
        clearTimeout(timeout);
        outputInspector.flush();
        if (code !== 0) {
          reject(new Error(`Packaged app exited with ${signal || code}`));
          return;
        }
        try {
          validateSmokePayload(readyPayload);
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });
  } finally {
    await fs.rm(userDataDir, { recursive: true, force: true });
  }

  return readyPayload;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const rootDir = repoRootFromModule();
  const distDir = path.join(rootDir, 'dist');
  const options = parseArgs(argv);
  const npx = getNpxCommand(process.platform);
  const buildEnv = {
    ...env,
    CSC_IDENTITY_AUTO_DISCOVERY: 'false',
  };

  if (!options.skipBuild) {
    const builderArgs = ['electron-builder', '--dir', '--publish', 'never'];
    if (process.platform === 'darwin') {
      // The release build config sets mac.notarize:true, which needs Apple
      // credentials. The smoke only needs a launchable bundle, so ad-hoc sign
      // (CSC_IDENTITY_AUTO_DISCOVERY=false, above) and skip notarization —
      // otherwise the build fails on CI / any machine without those secrets.
      builderArgs.push('-c.mac.notarize=false');
    }
    await runCommand(npx, ['vite', 'build'], { cwd: rootDir, env: buildEnv });
    await runCommand(npx, builderArgs, { cwd: rootDir, env: buildEnv });
  }

  const executablePath = await findPackagedExecutable({ distDir, platform: process.platform });
  console.log(`[package-smoke] Launching ${executablePath}`);
  const payload = await runPackagedAppSmoke({
    executablePath,
    rootDir,
    platform: process.platform,
    timeoutMs: options.timeoutMs,
    baseEnv: env,
  });
  console.log(`[package-smoke] PASS ${JSON.stringify(payload)}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`[package-smoke] FAIL ${err.message}`);
    process.exitCode = 1;
  });
}
