const test = require('node:test');
const assert = require('node:assert/strict');

const { registerDispatchIPC } = require('../electron/dispatch-ipc');

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

function registerHarness(serviceOverrides = {}) {
  const calls = [];
  const agentDispatchService = {
    async sendBrokered(payload) {
      calls.push(['sendBrokered', payload]);
      return { success: true, route: 'brokered', payload };
    },
    async createPayload(payload) {
      calls.push(['createPayload', payload]);
      return { success: true, route: 'direct', payload };
    },
    async pollStatusUpdates(payload) {
      calls.push(['pollStatusUpdates', payload]);
      return { success: true, route: 'statusUpdates', payload };
    },
    ...serviceOverrides,
  };
  const ipc = createIpcHarness();

  registerDispatchIPC({
    ipcMain: ipc.ipcMain,
    agentDispatchService,
  });

  return { ...ipc, calls };
}

test('registerDispatchIPC registers the renderer dispatch contract', () => {
  const ipc = registerHarness();

  assert.deepEqual(ipc.registeredChannels(), [
    'dispatch:brokered',
    'dispatch:createPayload',
    'dispatch:statusUpdates',
  ]);
});

test('dispatch handlers reject invalid payloads before service calls', async () => {
  const ipc = registerHarness();

  assert.deepEqual(await ipc.invoke('dispatch:brokered', {
    agentName: '../ash',
    runtime: 'codex',
    taskDescription: 'Do it',
  }), {
    success: false,
    error: 'dispatch:brokered requires a valid agentName',
    code: 'IPC_VALIDATION_ERROR',
  });

  assert.deepEqual(await ipc.invoke('dispatch:createPayload', {
    agentName: 'ash',
    runtime: 'node',
    taskDescription: 'Do it',
  }), {
    success: false,
    error: 'dispatch:createPayload requires a valid runtime',
    code: 'IPC_VALIDATION_ERROR',
  });

  assert.deepEqual(ipc.calls, []);
});

test('dispatch handlers pass normalized payloads to the dispatch service', async () => {
  const ipc = registerHarness();

  assert.deepEqual(await ipc.invoke('dispatch:brokered', {
    agentName: 'Ash',
    runtime: 'codex',
    taskDescription: 'Do it',
    brokerAgent: 'mira-nockos',
    priority: 'high',
  }), {
    success: true,
    route: 'brokered',
    payload: {
      agentName: 'ash',
      runtime: 'codex',
      taskDescription: 'Do it',
      targetRepo: '',
      projectName: '',
      scriptPath: '',
      agentBound: false,
      brokerAgent: 'mira-nockos',
      priority: 'high',
    },
  });

  assert.deepEqual(await ipc.invoke('dispatch:createPayload', {
    agentName: 'Vale',
    runtime: 'deepseek',
    taskDescription: 'Create payload',
    scriptPath: '/tmp/dispatch vale.sh',
    agentBound: true,
  }), {
    success: true,
    route: 'direct',
    payload: {
      agentName: 'vale',
      runtime: 'deepseek',
      taskDescription: 'Create payload',
      targetRepo: '',
      projectName: '',
      scriptPath: '/tmp/dispatch vale.sh',
      agentBound: true,
    },
  });

  assert.equal(ipc.calls.length, 2);
});

test('dispatch status update handler validates and normalizes polling payloads', async () => {
  const ipc = registerHarness();

  assert.deepEqual(await ipc.invoke('dispatch:statusUpdates', {
    requestIds: ['req-1', 'bad/id', 'req-2'],
    agentName: 'Nock-Terminal',
    limit: 500,
    unreadOnly: true,
  }), {
    success: true,
    route: 'statusUpdates',
    payload: {
      requestIds: ['req-1', 'req-2'],
      agentName: 'nock-terminal',
      limit: 100,
      unreadOnly: true,
    },
  });
});

test('dispatch status update handler rejects empty request id lists', async () => {
  const ipc = registerHarness();

  assert.deepEqual(await ipc.invoke('dispatch:statusUpdates', {
    requestIds: ['../escape'],
  }), {
    success: false,
    error: 'dispatch:statusUpdates requires at least one valid requestId',
    code: 'IPC_VALIDATION_ERROR',
  });
});

test('dispatch handlers return stable failure messages for service errors', async () => {
  const ipc = registerHarness({
    async sendBrokered() {
      throw new Error('NockCC unavailable');
    },
    async createPayload() {
      throw new Error('');
    },
    async pollStatusUpdates() {
      throw new Error('');
    },
  });

  assert.deepEqual(await ipc.invoke('dispatch:brokered', {
    agentName: 'ash',
    runtime: 'codex',
    taskDescription: 'Do it',
  }), {
    success: false,
    error: 'NockCC unavailable',
  });

  assert.deepEqual(await ipc.invoke('dispatch:createPayload', {
    agentName: 'ash',
    runtime: 'codex',
    taskDescription: 'Do it',
  }), {
    success: false,
    error: 'Failed to create dispatch payload',
  });

  assert.deepEqual(await ipc.invoke('dispatch:statusUpdates', {
    requestIds: ['request-1'],
  }), {
    success: false,
    error: 'Failed to poll dispatch status updates',
  });
});
