const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createNockCCActivityIPC,
  sanitizeNockCCActivity,
} = require('../electron/nockcc-activity-ipc');

function createIpcHarness() {
  const listeners = new Map();
  return {
    ipcMain: {
      on(channel, listener) {
        listeners.set(channel, listener);
      },
    },
    send(channel, ...args) {
      const listener = listeners.get(channel);
      assert.ok(listener, `Expected ${channel} to be registered`);
      return listener({}, ...args);
    },
    registeredEventChannels() {
      return [...listeners.keys()].sort();
    },
  };
}

function createController(overrides = {}) {
  const ipc = createIpcHarness();
  const calls = [];
  const intervals = [];
  const nockccClient = {
    startSession(payload) {
      calls.push(['startSession', payload]);
    },
    heartbeat(payload) {
      calls.push(['heartbeat', payload]);
    },
    endSession() {
      calls.push(['endSession']);
    },
  };

  const controller = createNockCCActivityIPC({
    ipcMain: ipc.ipcMain,
    nockccClient,
    machine: 'test-machine',
    appVersion: '1.2.3',
    setIntervalFn(callback, delay) {
      const interval = { callback, delay, cleared: false };
      intervals.push(interval);
      return interval;
    },
    clearIntervalFn(interval) {
      interval.cleared = true;
    },
    ...overrides,
  });

  return { ...ipc, calls, intervals, controller };
}

test('sanitizeNockCCActivity normalizes renderer-controlled payloads', () => {
  const longValue = 'x'.repeat(201);
  assert.deepEqual(sanitizeNockCCActivity({
    activeProjectCount: 2.6,
    activeClaudeSessionIds: ['tab-1', 12, longValue, 'tab-2'],
    activeAgentSessionIds: Array.from({ length: 105 }, (_, index) => `agent:${index}`),
  }), {
    activeProjectCount: 3,
    activeClaudeSessionIds: ['tab-1', 'tab-2'],
    activeAgentSessionIds: Array.from({ length: 100 }, (_, index) => `agent:${index}`),
  });

  assert.deepEqual(sanitizeNockCCActivity(null), {
    activeProjectCount: 0,
    activeClaudeSessionIds: [],
    activeAgentSessionIds: [],
  });
  assert.deepEqual(sanitizeNockCCActivity({ activeProjectCount: -4 }), {
    activeProjectCount: 0,
    activeClaudeSessionIds: [],
    activeAgentSessionIds: [],
  });
});

test('createNockCCActivityIPC registers the activity update channel', () => {
  const ipc = createController();

  assert.deepEqual(ipc.registeredEventChannels(), ['nockcc:updateActivity']);
});

test('activity updates are sanitized and exposed as defensive copies', () => {
  const ipc = createController();

  ipc.send('nockcc:updateActivity', {
    activeProjectCount: 1.4,
    activeClaudeSessionIds: ['tab-1', null],
    activeAgentSessionIds: ['claude:tab-1'],
  });

  const activity = ipc.controller.getActivity();
  activity.activeClaudeSessionIds.push('mutated');

  assert.deepEqual(ipc.controller.getActivity(), {
    activeProjectCount: 1,
    activeClaudeSessionIds: ['tab-1'],
    activeAgentSessionIds: ['claude:tab-1'],
  });
});

test('start registers session and heartbeat sends latest activity', () => {
  const ipc = createController();

  ipc.controller.start();
  ipc.send('nockcc:updateActivity', {
    activeProjectCount: 2,
    activeClaudeSessionIds: ['tab-1'],
    activeAgentSessionIds: ['claude:tab-1', 'codex:tab-2'],
  });
  ipc.intervals[0].callback();

  assert.equal(ipc.intervals[0].delay, 60_000);
  assert.deepEqual(ipc.calls, [
    ['startSession', { machine: 'test-machine', appVersion: '1.2.3' }],
    ['heartbeat', {
      activeProjectCount: 2,
      activeClaudeSessionIds: ['tab-1'],
      activeAgentSessionIds: ['claude:tab-1', 'codex:tab-2'],
    }],
  ]);
});

test('start replaces existing heartbeat interval and stop cleans up session', () => {
  const ipc = createController();

  ipc.controller.start();
  ipc.controller.start();
  ipc.controller.stop();

  assert.equal(ipc.intervals.length, 2);
  assert.equal(ipc.intervals[0].cleared, true);
  assert.equal(ipc.intervals[1].cleared, true);
  assert.deepEqual(ipc.calls, [
    ['startSession', { machine: 'test-machine', appVersion: '1.2.3' }],
    ['endSession'],
    ['startSession', { machine: 'test-machine', appVersion: '1.2.3' }],
    ['endSession'],
  ]);
});

test('controller tolerates missing NockCC client', () => {
  const ipc = createController({ nockccClient: null });

  assert.equal(ipc.controller.start(), null);
  ipc.controller.stop();

  assert.deepEqual(ipc.calls, []);
  assert.deepEqual(ipc.intervals, []);
});
