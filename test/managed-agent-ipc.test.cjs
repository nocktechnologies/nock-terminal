'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { registerManagedAgentIPC } = require('../electron/managed-agent-ipc');

function createHarness(service = {}) {
  const handlers = new Map();
  const ipcMain = {
    handle(channel, handler) { handlers.set(channel, handler); },
  };
  registerManagedAgentIPC({ ipcMain, managedAgentService: service });
  return {
    handlers,
    invoke(channel, payload) {
      const handler = handlers.get(channel);
      assert.ok(handler, `missing handler ${channel}`);
      return handler({}, payload);
    },
  };
}

test('registerManagedAgentIPC exposes the complete structured contract', () => {
  const ipc = createHarness({
    prerequisites: () => ({ success: true }),
    list: () => [],
    create: () => ({ success: true }),
    update: () => ({ success: true }),
    validate: () => ({ success: true }),
    authLaunch: () => ({ success: true }),
    supervise: () => ({ success: true }),
    control: () => ({ success: true }),
  });
  assert.deepEqual([...ipc.handlers.keys()].sort(), [
    'managedAgents:authLaunch',
    'managedAgents:control',
    'managedAgents:create',
    'managedAgents:list',
    'managedAgents:prerequisites',
    'managedAgents:supervise',
    'managedAgents:update',
    'managedAgents:validate',
  ]);
});

test('IPC rejects unsafe ids, non-absolute workspace roots, arbitrary models, and malformed controls before delegation', async () => {
  const calls = [];
  const ipc = createHarness({
    create: payload => { calls.push(['create', payload]); return { success: true }; },
    update: (...args) => { calls.push(['update', ...args]); return { success: true }; },
    control: (...args) => { calls.push(['control', ...args]); return { success: true }; },
  });

  const invalidId = await ipc.invoke('managedAgents:create', {
    agentId: '../alpha', displayName: 'Alpha', allowedRoots: ['/tmp/project'], model: 'claude-opus-4-8[1m]',
  });
  const relativeRoot = await ipc.invoke('managedAgents:create', {
    agentId: 'alpha', displayName: 'Alpha', allowedRoots: ['project'], model: 'claude-opus-4-8[1m]',
  });
  const arbitraryModel = await ipc.invoke('managedAgents:create', {
    agentId: 'alpha', displayName: 'Alpha', allowedRoots: ['/tmp/project'], model: 'my-custom-command',
  });
  const malformedControl = await ipc.invoke('managedAgents:control', {
    agentId: 'alpha', action: 'steer', params: { text: 42 },
  });
  const invalidUpdate = await ipc.invoke('managedAgents:update', {
    agentId: 'alpha', draft: { displayName: 'Alpha', allowedRoots: ['relative'] },
  });

  for (const result of [invalidId, relativeRoot, arbitraryModel, malformedControl, invalidUpdate]) {
    assert.equal(result.success, false);
    assert.equal(result.code, 'IPC_VALIDATION_ERROR');
  }
  assert.deepEqual(calls, []);
});

test('IPC validates and delegates update, supervision, and control payloads', async () => {
  const calls = [];
  const ipc = createHarness({
    update: (...args) => { calls.push(['update', ...args]); return { success: true, updated: true }; },
    supervise: (...args) => { calls.push(['supervise', ...args]); return { success: true }; },
    control: (...args) => { calls.push(['control', ...args]); return { success: true }; },
  });
  const update = await ipc.invoke('managedAgents:update', {
    agentId: 'alpha',
    draft: { permissionPreset: 'standard' },
  });
  const supervise = await ipc.invoke('managedAgents:supervise', { agentId: 'alpha', action: 'stop' });
  const control = await ipc.invoke('managedAgents:control', { agentId: 'alpha', action: 'steer', params: { text: 'hello' } });

  assert.deepEqual(update, { success: true, updated: true });
  assert.deepEqual(supervise, { success: true });
  assert.deepEqual(control, { success: true });
  assert.deepEqual(calls, [
    ['update', 'alpha', { permissionPreset: 'standard' }],
    ['supervise', 'alpha', 'stop'],
    ['control', 'alpha', 'steer', { text: 'hello' }],
  ]);
});

test('IPC converts service failures into the stable error shape', async () => {
  const ipc = createHarness({
    list: () => { throw Object.assign(new Error('seat unavailable'), { code: 'INVALID_SEAT' }); },
  });
  const result = await ipc.invoke('managedAgents:list');
  assert.deepEqual(result, { success: false, error: 'seat unavailable', code: 'INVALID_SEAT' });
});
