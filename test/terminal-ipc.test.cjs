const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { registerTerminalIPC } = require('../electron/terminal-ipc');

function createIpcHarness() {
  const handlers = new Map();
  const listeners = new Map();
  return {
    ipcMain: {
      handle(channel, handler) {
        handlers.set(channel, handler);
      },
      on(channel, listener) {
        listeners.set(channel, listener);
      },
    },
    invoke(channel, ...args) {
      const handler = handlers.get(channel);
      assert.ok(handler, `Expected ${channel} to be registered`);
      return handler({}, ...args);
    },
    send(channel, ...args) {
      const listener = listeners.get(channel);
      assert.ok(listener, `Expected ${channel} to be registered`);
      return listener({}, ...args);
    },
    registeredHandleChannels() {
      return [...handlers.keys()].sort();
    },
    registeredEventChannels() {
      return [...listeners.keys()].sort();
    },
  };
}

function makeSandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nock-terminal-ipc-'));
  test.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

const SHELL_FIXTURES = process.platform === 'win32'
  ? {
      settingsShell: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      profileShell: 'C:\\Windows\\System32\\cmd.exe',
      arbitraryShell: 'C:\\Temp\\evil.exe',
    }
  : {
      settingsShell: '/bin/bash',
      profileShell: '/bin/zsh',
      arbitraryShell: '/tmp/evil-sh',
    };

function registerHarness({
  allowedRoots = [],
  settings = {},
  profiles = {},
} = {}) {
  const ipc = createIpcHarness();
  const calls = [];
  const terminalManager = {
    create(id, cwd, options) {
      calls.push({ method: 'create', id, cwd, options });
      return { success: true, id, pid: 1234 };
    },
    write(id, data) {
      calls.push({ method: 'write', id, data });
    },
    resize(id, cols, rows) {
      calls.push({ method: 'resize', id, cols, rows });
    },
    destroy(id) {
      calls.push({ method: 'destroy', id });
    },
    listTerminals() {
      calls.push({ method: 'listTerminals' });
      return [{ id: 'tab-1', pid: 1234 }];
    },
    reapStaleTerminals(options) {
      calls.push({ method: 'reapStaleTerminals', options });
      return [{ id: 'orphan-1', pid: 9, reason: 'dead-root-pid' }];
    },
  };
  const profileLookups = [];
  const projectProfiles = {
    get(projectPath) {
      profileLookups.push(projectPath);
      return profiles[projectPath] || {};
    },
  };

  registerTerminalIPC({
    ipcMain: ipc.ipcMain,
    terminalManager,
    projectProfiles,
    getAllowedProjectRoots: () => allowedRoots,
    getSettingsSnapshot: () => settings,
  });

  return { ...ipc, calls, profileLookups };
}

test('registerTerminalIPC registers the renderer terminal command contract', () => {
  const ipc = registerHarness();

  assert.deepEqual(ipc.registeredHandleChannels(), [
    'terminal:create',
    'terminal:list',
    'terminal:reapStale',
  ]);
  assert.deepEqual(ipc.registeredEventChannels(), [
    'terminal:destroy',
    'terminal:resize',
    'terminal:write',
  ]);
});

test('terminal:list returns the terminal manager inventory', () => {
  const ipc = registerHarness();
  const result = ipc.invoke('terminal:list');
  assert.deepEqual(result, [{ id: 'tab-1', pid: 1234 }]);
});

test('terminal:reapStale sanitizes options before delegating', () => {
  const ipc = registerHarness();
  const result = ipc.invoke('terminal:reapStale', {
    liveTerminalIds: ['tab-1', '', 42, 'tab-2'],
    graceMs: -5,
    rendererStartedAt: 1000,
    bogus: 'ignored',
  });
  assert.deepEqual(result, [{ id: 'orphan-1', pid: 9, reason: 'dead-root-pid' }]);
  const reap = ipc.calls.find((c) => c.method === 'reapStaleTerminals');
  // Non-string ids and the negative graceMs are dropped; only valid options pass.
  assert.deepEqual(reap.options.liveTerminalIds, ['tab-1', 'tab-2']);
  assert.equal('graceMs' in reap.options, false);
  assert.equal(reap.options.rendererStartedAt, 1000);
});

test('terminal:reapStale tolerates a missing/garbage payload', () => {
  const ipc = registerHarness();
  ipc.invoke('terminal:reapStale', undefined);
  const reap = ipc.calls.find((c) => c.method === 'reapStaleTerminals');
  assert.deepEqual(reap.options, { liveTerminalIds: [] });
});

test('terminal:create validates payloads and delegates trusted launch options', async () => {
  const sandbox = makeSandbox();
  const projectPath = path.join(sandbox, 'project');
  fs.mkdirSync(projectPath, { recursive: true });
  const ipc = registerHarness({
    allowedRoots: [projectPath],
    settings: { defaultShell: SHELL_FIXTURES.settingsShell, shellArgs: '--login' },
    profiles: {
      [projectPath]: {
        defaultShell: SHELL_FIXTURES.profileShell,
        shellArgs: '--interactive',
        envVars: 'NODE_ENV=test',
      },
    },
  });

  const result = await ipc.invoke('terminal:create', { id: 'tab-1', cwd: projectPath });

  assert.deepEqual(result, { success: true, id: 'tab-1', pid: 1234 });
  assert.deepEqual(ipc.profileLookups, [projectPath]);
  assert.deepEqual(ipc.calls, [{
    method: 'create',
    id: 'tab-1',
    cwd: path.resolve(projectPath),
    options: {
      shell: SHELL_FIXTURES.profileShell,
      shellArgs: '--interactive',
      envVars: 'NODE_ENV=test',
    },
  }]);
});

test('terminal:create uses the default cwd profile when payload omits cwd', async () => {
  const sandbox = makeSandbox();
  const projectPath = path.join(sandbox, 'project');
  fs.mkdirSync(projectPath, { recursive: true });
  const effectiveProjectPath = fs.realpathSync.native(projectPath);
  const ipc = registerHarness({
    allowedRoots: [projectPath],
    settings: { defaultShell: SHELL_FIXTURES.settingsShell, shellArgs: '--login' },
    profiles: {
      [effectiveProjectPath]: {
        defaultShell: SHELL_FIXTURES.profileShell,
        shellArgs: '--interactive',
        envVars: 'NODE_ENV=test',
      },
    },
  });

  const result = await ipc.invoke('terminal:create', { id: 'tab-1' });

  assert.deepEqual(result, { success: true, id: 'tab-1', pid: 1234 });
  assert.deepEqual(ipc.profileLookups, [effectiveProjectPath]);
  assert.deepEqual(ipc.calls, [{
    method: 'create',
    id: 'tab-1',
    cwd: path.resolve(effectiveProjectPath),
    options: {
      shell: SHELL_FIXTURES.profileShell,
      shellArgs: '--interactive',
      envVars: 'NODE_ENV=test',
    },
  }]);
});

test('terminal:create returns the shared IPC validation error shape', async () => {
  const sandbox = makeSandbox();
  const projectPath = path.join(sandbox, 'project');
  fs.mkdirSync(projectPath, { recursive: true });
  const ipc = registerHarness({
    allowedRoots: [projectPath],
    settings: { defaultShell: SHELL_FIXTURES.settingsShell },
  });

  const result = await ipc.invoke('terminal:create', {
    id: 'tab-1',
    cwd: projectPath,
    shell: SHELL_FIXTURES.arbitraryShell,
  });

  assert.deepEqual(result, {
    success: false,
    error: 'terminal:create shell is not trusted',
    code: 'IPC_VALIDATION_ERROR',
  });
  assert.deepEqual(ipc.calls, []);
});

test('terminal write, resize, and destroy events delegate to terminal manager', () => {
  const ipc = registerHarness();

  ipc.send('terminal:write', { id: 'tab-1', data: 'ls\n' });
  ipc.send('terminal:resize', { id: 'tab-1', cols: 100, rows: 40 });
  ipc.send('terminal:destroy', { id: 'tab-1' });

  assert.deepEqual(ipc.calls, [
    { method: 'write', id: 'tab-1', data: 'ls\n' },
    { method: 'resize', id: 'tab-1', cols: 100, rows: 40 },
    { method: 'destroy', id: 'tab-1' },
  ]);
});

test('terminal event handlers tolerate missing or malformed payloads', () => {
  const ipc = registerHarness();

  assert.doesNotThrow(() => ipc.send('terminal:write'));
  assert.doesNotThrow(() => ipc.send('terminal:resize', null));
  assert.doesNotThrow(() => ipc.send('terminal:destroy', 'tab-1'));
  assert.doesNotThrow(() => ipc.send('terminal:write', { id: 'tab-1' }));
  assert.doesNotThrow(() => ipc.send('terminal:resize', { id: 'tab-1', cols: '100', rows: 40 }));

  assert.deepEqual(ipc.calls, []);
});
