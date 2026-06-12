const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { registerLocalDataIPC } = require('../electron/local-data-ipc');

function createIpcHarness() {
  const handlers = new Map();
  return {
    ipcMain: {
      handle(channel, handler) {
        handlers.set(channel, handler);
      },
    },
    invoke(channel, ...args) {
      const handler = handlers.get(channel);
      assert.ok(handler, `Expected ${channel} to be registered`);
      return handler({}, ...args);
    },
    registeredChannels() {
      return [...handlers.keys()].sort();
    },
  };
}

function createLocalDataHarness() {
  const allowedRoot = path.resolve('/tmp/nock-terminal-local-data');
  const calls = [];
  const fileService = {
    isAllowedPath(candidate) {
      const resolved = path.resolve(candidate);
      return resolved === allowedRoot || resolved.startsWith(`${allowedRoot}${path.sep}`);
    },
  };
  const projectProfiles = {
    get(projectPath) {
      calls.push(['profiles:get', projectPath]);
      return { projectPath, defaultAgent: 'codex' };
    },
    save(projectPath, profile) {
      calls.push(['profiles:save', projectPath, profile]);
      return { success: true, data: { projectPath, ...profile } };
    },
    delete(projectPath) {
      calls.push(['profiles:delete', projectPath]);
      return { success: true, projectPath };
    },
    list() {
      calls.push(['profiles:list']);
      return [{ projectPath: allowedRoot }];
    },
  };
  const sessionHistory = {
    list() {
      calls.push(['sessionHistory:list']);
      return [{ tabId: 'tab-1' }];
    },
    getOutput(startTime, tabId) {
      calls.push(['sessionHistory:getOutput', startTime, tabId]);
      return 'terminal output';
    },
    startSession(tabId, metadata) {
      calls.push(['sessionHistory:start', tabId, metadata]);
      return { sessionId: `${tabId}:1` };
    },
  };
  const promptStore = {
    list() {
      calls.push(['prompts:list']);
      return [{ id: 'audit' }];
    },
    get(id) {
      calls.push(['prompts:get', id]);
      return { id, title: 'Audit' };
    },
    save(id, data) {
      calls.push(['prompts:save', id, data]);
      return { success: true, id, data };
    },
    delete(id) {
      calls.push(['prompts:delete', id]);
      return { success: true, id };
    },
  };

  const ipc = createIpcHarness();
  registerLocalDataIPC({
    ipcMain: ipc.ipcMain,
    fileService,
    projectProfiles,
    promptStore,
    sessionHistory,
  });

  return {
    ...ipc,
    allowedRoot,
    allowedProject: path.join(allowedRoot, 'repo'),
    outsideProject: path.resolve('/tmp/nock-terminal-outside/repo'),
    calls,
  };
}

test('registerLocalDataIPC registers profile, prompt, and session-history channels', () => {
  const ipc = createLocalDataHarness();

  assert.deepEqual(ipc.registeredChannels(), [
    'profiles:delete',
    'profiles:get',
    'profiles:list',
    'profiles:save',
    'prompts:delete',
    'prompts:get',
    'prompts:list',
    'prompts:save',
    'sessionHistory:getOutput',
    'sessionHistory:list',
    'sessionHistory:start',
  ]);
});

test('profile and prompt save handlers preserve renderer validation error shape', () => {
  const ipc = createLocalDataHarness();

  assert.deepEqual(ipc.invoke('profiles:save', {
    projectPath: ipc.outsideProject,
    profile: { defaultAgent: 'codex' },
  }), {
    success: false,
    error: 'profiles:save projectPath is outside allowed project roots',
    code: 'IPC_VALIDATION_ERROR',
    message: 'profiles:save projectPath is outside allowed project roots',
  });

  assert.deepEqual(ipc.invoke('prompts:save', {
    id: '../escape',
    data: { title: 'Bad', body: 'Nope' },
  }), {
    success: false,
    error: 'prompts:save id must contain only letters, numbers, dashes, or underscores',
    code: 'IPC_VALIDATION_ERROR',
    message: 'prompts:save id must contain only letters, numbers, dashes, or underscores',
  });

  assert.deepEqual(ipc.calls, []);
});

test('profile handlers delegate validated payloads to project profile storage', () => {
  const ipc = createLocalDataHarness();

  assert.deepEqual(ipc.invoke('profiles:get', ipc.allowedProject), {
    projectPath: ipc.allowedProject,
    defaultAgent: 'codex',
  });
  assert.deepEqual(ipc.invoke('profiles:save', {
    projectPath: ipc.allowedProject,
    profile: {
      defaultAgent: 'codex',
      notes: 'keep this',
      unknown: 'drop this',
    },
  }), {
    success: true,
    data: {
      projectPath: ipc.allowedProject,
      defaultAgent: 'codex',
      notes: 'keep this',
    },
  });
  assert.deepEqual(ipc.invoke('profiles:delete', ipc.allowedProject), {
    success: true,
    projectPath: ipc.allowedProject,
  });
  assert.deepEqual(ipc.invoke('profiles:list'), [{ projectPath: ipc.allowedRoot }]);

  assert.deepEqual(ipc.calls, [
    ['profiles:get', ipc.allowedProject],
    ['profiles:save', ipc.allowedProject, { defaultAgent: 'codex', notes: 'keep this' }],
    ['profiles:delete', ipc.allowedProject],
    ['profiles:list'],
  ]);
});

test('profiles:get and profiles:delete reject paths outside allowed roots', () => {
  const ipc = createLocalDataHarness();

  assert.equal(ipc.invoke('profiles:get', ipc.outsideProject), null);
  assert.equal(ipc.invoke('profiles:delete', ipc.outsideProject), null);
  assert.deepEqual(ipc.calls, []);
});

test('profiles:get and profiles:delete reject non-string project paths', () => {
  const ipc = createLocalDataHarness();

  assert.equal(ipc.invoke('profiles:get'), null);
  assert.equal(ipc.invoke('profiles:get', { projectPath: ipc.allowedProject }), null);
  assert.equal(ipc.invoke('profiles:delete', 42), null);
  assert.equal(ipc.invoke('profiles:delete', ''), null);
  assert.deepEqual(ipc.calls, []);
});

test('session-history handlers delegate to session history storage', () => {
  const ipc = createLocalDataHarness();

  assert.deepEqual(ipc.invoke('sessionHistory:list'), [{ tabId: 'tab-1' }]);
  assert.equal(ipc.invoke('sessionHistory:getOutput', { startTime: 100, tabId: 'tab-1' }), 'terminal output');
  assert.deepEqual(ipc.invoke('sessionHistory:start', {
    tabId: 'tab-2',
    metadata: { project: 'Nock Terminal' },
  }), {
    sessionId: 'tab-2:1',
  });

  assert.deepEqual(ipc.calls, [
    ['sessionHistory:list'],
    ['sessionHistory:getOutput', 100, 'tab-1'],
    ['sessionHistory:start', 'tab-2', { project: 'Nock Terminal' }],
  ]);
});

test('session-history handlers ignore missing or malformed payloads', () => {
  const ipc = createLocalDataHarness();

  assert.equal(ipc.invoke('sessionHistory:getOutput'), null);
  assert.equal(ipc.invoke('sessionHistory:getOutput', null), null);
  assert.equal(ipc.invoke('sessionHistory:getOutput', []), null);
  assert.equal(ipc.invoke('sessionHistory:start'), null);
  assert.equal(ipc.invoke('sessionHistory:start', null), null);
  assert.equal(ipc.invoke('sessionHistory:start', { metadata: { project: 'missing tab' } }), null);

  assert.deepEqual(ipc.calls, []);
});

test('sessionHistory:getOutput rejects mistyped startTime or tabId', () => {
  const ipc = createLocalDataHarness();

  assert.equal(ipc.invoke('sessionHistory:getOutput', { startTime: '100', tabId: 'tab-1' }), null);
  assert.equal(ipc.invoke('sessionHistory:getOutput', { startTime: NaN, tabId: 'tab-1' }), null);
  assert.equal(ipc.invoke('sessionHistory:getOutput', { startTime: 100, tabId: 42 }), null);

  assert.deepEqual(ipc.calls, []);
});

test('prompt handlers delegate validated payloads to prompt storage', () => {
  const ipc = createLocalDataHarness();

  assert.deepEqual(ipc.invoke('prompts:list'), [{ id: 'audit' }]);
  assert.deepEqual(ipc.invoke('prompts:get', 'audit'), { id: 'audit', title: 'Audit' });
  assert.deepEqual(ipc.invoke('prompts:save', {
    id: 'audit',
    data: {
      title: 'Audit',
      tags: ['phase-f', ''],
      body: 'Review this.',
    },
  }), {
    success: true,
    id: 'audit',
    data: {
      title: 'Audit',
      tags: ['phase-f'],
      body: 'Review this.',
    },
  });
  assert.deepEqual(ipc.invoke('prompts:delete', 'audit'), { success: true, id: 'audit' });

  assert.deepEqual(ipc.calls, [
    ['prompts:list'],
    ['prompts:get', 'audit'],
    ['prompts:save', 'audit', { title: 'Audit', tags: ['phase-f'], body: 'Review this.' }],
    ['prompts:delete', 'audit'],
  ]);
});
