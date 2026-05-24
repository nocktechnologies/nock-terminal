import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  createSmokeOutputInspector,
  createSmokeEnvironment,
  findPackagedExecutable,
  getNpxCommand,
  parseSmokeReadyLine,
  SMOKE_READY_PREFIX,
} from '../scripts/package-smoke.mjs';

async function withTempDir(callback) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nock-package-smoke-test-'));
  try {
    return await callback(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('locates macOS app bundle executable in unpacked dist output', async () => {
  await withTempDir(async (distDir) => {
    const executable = path.join(distDir, 'mac-arm64', 'Nock Terminal.app', 'Contents', 'MacOS', 'Nock Terminal');
    await fs.mkdir(path.dirname(executable), { recursive: true });
    await fs.writeFile(executable, '');

    assert.equal(await findPackagedExecutable({ distDir, platform: 'darwin' }), executable);
  });
});

test('locates Windows and Linux unpacked executables', async () => {
  await withTempDir(async (distDir) => {
    const winExecutable = path.join(distDir, 'win-unpacked', 'Nock Terminal.exe');
    const linuxExecutable = path.join(distDir, 'linux-unpacked', 'nock-terminal');
    await fs.mkdir(path.dirname(winExecutable), { recursive: true });
    await fs.mkdir(path.dirname(linuxExecutable), { recursive: true });
    await fs.writeFile(winExecutable, '');
    await fs.writeFile(linuxExecutable, '');

    assert.equal(await findPackagedExecutable({ distDir, platform: 'win32' }), winExecutable);
    assert.equal(await findPackagedExecutable({ distDir, platform: 'linux' }), linuxExecutable);
  });
});

test('parses smoke ready marker payloads', () => {
  const payload = { isPackaged: true, url: 'file:///app/index.html', bodyHasBrand: true };
  const parsed = parseSmokeReadyLine(`${SMOKE_READY_PREFIX}${JSON.stringify(payload)}`);

  assert.deepEqual(parsed, payload);
  assert.equal(parseSmokeReadyLine('ordinary app log'), null);
});

test('buffers smoke ready markers split across output chunks', () => {
  const payloads = [];
  const originalStdoutWrite = process.stdout.write;
  process.stdout.write = () => true;
  try {
    const inspector = createSmokeOutputInspector({
      onPayload(payload) {
        payloads.push(payload);
      },
    });

    inspector.inspect(Buffer.from(`${SMOKE_READY_PREFIX}{\"isPack`), 'stdout');
    inspector.inspect(Buffer.from('aged\":true,\"renderer\":{\"bodyHasDashboard\":true}}\n'), 'stdout');

    assert.deepEqual(payloads, [
      { isPackaged: true, renderer: { bodyHasDashboard: true } },
    ]);
  } finally {
    process.stdout.write = originalStdoutWrite;
  }
});

test('creates isolated smoke environment and platform npx command', () => {
  const env = createSmokeEnvironment({
    baseEnv: { PATH: '/bin', HOME: '/tmp/home' },
    userDataDir: '/tmp/nock-smoke-user-data',
  });

  assert.equal(env.PATH, '/bin');
  assert.equal(env.NOCK_TERMINAL_PACKAGED_SMOKE, '1');
  assert.equal(env.NOCK_TERMINAL_USER_DATA_DIR, '/tmp/nock-smoke-user-data');
  assert.equal(env.CSC_IDENTITY_AUTO_DISCOVERY, 'false');
  assert.equal(getNpxCommand('win32'), 'npx.cmd');
  assert.equal(getNpxCommand('linux'), 'npx');
});
