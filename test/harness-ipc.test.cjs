const test = require('node:test');
const assert = require('node:assert/strict');

const { registerHarnessIPC } = require('../electron/harness-ipc');

function createIpcHarness() {
  const handlers = new Map();
  return {
    ipcMain: {
      handle(channel, handler) {
        handlers.set(channel, handler);
      },
    },
    invoke(channel, payload) {
      const handler = handlers.get(channel);
      assert.ok(handler, `Expected ${channel} to be registered`);
      return handler({}, payload);
    },
    channels() {
      return [...handlers.keys()].sort();
    },
  };
}

const seat = {
  id: 'nock@nock-fleet-02:22/mira',
  label: 'Mira',
  agent: 'mira',
  host: 'nock-fleet-02',
  user: 'nock',
  port: 22,
  enginePath: '/home/nock/Dev/nock-agent-harness',
  transport: 'ssh',
};

test('registers the harness console IPC contract', () => {
  const ipc = createIpcHarness();
  registerHarnessIPC({
    ipcMain: ipc.ipcMain,
    service: {},
    getSettingsSnapshot: () => ({ harnessSeats: [] }),
  });

  assert.deepEqual(ipc.channels(), [
    'harness:control',
    'harness:launch',
    'harness:list',
    'harness:message',
    'harness:snapshot',
  ]);
});

test('resolves renderer requests only against configured seats', async () => {
  const ipc = createIpcHarness();
  const calls = [];
  registerHarnessIPC({
    ipcMain: ipc.ipcMain,
    service: {
      snapshot: async (configuredSeat) => {
        calls.push(['snapshot', configuredSeat]);
        return { success: true, snapshot: { daemonStatus: 'active' } };
      },
      launch: (configuredSeat, mode, options) => {
        calls.push(['launch', configuredSeat, mode, options]);
        return { success: true, command: 'trusted command' };
      },
      control: (configuredSeat, action, options) => {
        calls.push(['control', configuredSeat, action, options]);
        return { success: true, control: { ok: true, action } };
      },
      message: (configuredSeat, text) => {
        calls.push(['message', configuredSeat, text]);
        return { success: true, disposition: 'queued' };
      },
    },
    getSettingsSnapshot: () => ({ harnessSeats: [seat], defaultShell: '/bin/zsh' }),
  });

  assert.deepEqual(await ipc.invoke('harness:list'), [seat]);
  assert.equal((await ipc.invoke('harness:snapshot', { seatId: seat.id })).success, true);
  assert.equal((await ipc.invoke('harness:launch', { seatId: seat.id, mode: 'console' })).command, 'trusted command');
  assert.equal((await ipc.invoke('harness:control', { seatId: seat.id, action: 'pause' })).success, true);
  assert.equal((await ipc.invoke('harness:message', { seatId: seat.id, text: 'Keep moving.' })).success, true);
  assert.equal((await ipc.invoke('harness:snapshot', { seatId: 'unknown' })).code, 'HARNESS_SEAT_NOT_FOUND');
  assert.equal((await ipc.invoke('harness:launch', { seatId: seat.id, mode: 'restart' })).code, 'IPC_VALIDATION_ERROR');
  assert.equal(calls.length, 4);
  assert.deepEqual(calls[1][3], { shell: '/bin/zsh' });
  assert.deepEqual(calls[2], ['control', seat, 'pause', {}]);
  assert.deepEqual(calls[3], ['message', seat, 'Keep moving.']);
});

test('rejects malformed harness request payloads before calling the service', async () => {
  const ipc = createIpcHarness();
  registerHarnessIPC({
    ipcMain: ipc.ipcMain,
    service: {
      snapshot: async () => assert.fail('service must not run for invalid payloads'),
      launch: () => assert.fail('service must not run for invalid payloads'),
      control: () => assert.fail('service must not run for invalid payloads'),
      message: () => assert.fail('service must not run for invalid payloads'),
    },
    getSettingsSnapshot: () => ({ harnessSeats: [seat] }),
  });

  for (const payload of [undefined, null, 'seat', [seat.id], {}, { seatId: 42 }, { seatId: '' }, { seatId: 'x'.repeat(401) }]) {
    assert.equal((await ipc.invoke('harness:snapshot', payload)).code, 'IPC_VALIDATION_ERROR');
  }

  for (const payload of [
    { seatId: seat.id },
    { seatId: seat.id, action: 'restart-daemon' },
    { seatId: seat.id, action: 'queue-retry' },
    { seatId: seat.id, action: 'queue-retry', wakeId: 0 },
    { seatId: seat.id, action: 'queue-acknowledge', wakeId: 8, note: 'short' },
    { seatId: seat.id, action: 'queue-acknowledge', wakeId: 8, note: 'x'.repeat(501) },
  ]) {
    assert.equal((await ipc.invoke('harness:control', payload)).code, 'IPC_VALIDATION_ERROR');
  }

  for (const payload of [
    { seatId: seat.id },
    { seatId: seat.id, text: '' },
    { seatId: seat.id, text: 'x'.repeat(2001) },
    { seatId: seat.id, text: 'first\nsecond' },
    { seatId: seat.id, text: 42 },
  ]) {
    assert.equal((await ipc.invoke('harness:message', payload)).code, 'IPC_VALIDATION_ERROR');
  }
});

test('passes only validated queue control fields to the service', async () => {
  const ipc = createIpcHarness();
  const calls = [];
  registerHarnessIPC({
    ipcMain: ipc.ipcMain,
    service: {
      control: (...args) => {
        calls.push(args);
        return { success: true };
      },
    },
    getSettingsSnapshot: () => ({ harnessSeats: [seat] }),
  });

  await ipc.invoke('harness:control', { seatId: seat.id, action: 'queue-retry', wakeId: 42, note: 'ignored renderer field' });
  await ipc.invoke('harness:control', {
    seatId: seat.id,
    action: 'queue-acknowledge',
    wakeId: 43,
    note: 'Reviewed and dispositioned as terminal.',
  });

  assert.deepEqual(calls, [
    [seat, 'queue-retry', { wakeId: 42 }],
    [seat, 'queue-acknowledge', { wakeId: 43, note: 'Reviewed and dispositioned as terminal.' }],
  ]);
});

test('rejects a second mutating control while one is in flight for the seat', async () => {
  const ipc = createIpcHarness();
  let resolveControl;
  let calls = 0;
  const pendingControl = new Promise((resolve) => { resolveControl = resolve; });
  registerHarnessIPC({
    ipcMain: ipc.ipcMain,
    service: {
      control: () => {
        calls += 1;
        return pendingControl;
      },
    },
    getSettingsSnapshot: () => ({ harnessSeats: [seat] }),
  });

  const first = ipc.invoke('harness:control', { seatId: seat.id, action: 'pause' });
  const secondPending = ipc.invoke('harness:control', { seatId: seat.id, action: 'resume' });
  await Promise.resolve();
  const observedCalls = calls;
  resolveControl({ success: true, control: { action: 'pause' } });
  const second = await secondPending;

  assert.equal(observedCalls, 1);
  assert.equal(second.code, 'HARNESS_CONTROL_IN_FLIGHT');
  assert.equal((await first).success, true);
});

test('coalesces concurrent snapshot requests for the same seat', async () => {
  const ipc = createIpcHarness();
  let resolveSnapshot;
  let calls = 0;
  const pendingSnapshot = new Promise((resolve) => { resolveSnapshot = resolve; });
  registerHarnessIPC({
    ipcMain: ipc.ipcMain,
    service: {
      snapshot: () => {
        calls += 1;
        return pendingSnapshot;
      },
    },
    getSettingsSnapshot: () => ({ harnessSeats: [seat] }),
  });

  const first = ipc.invoke('harness:snapshot', { seatId: seat.id });
  const second = ipc.invoke('harness:snapshot', { seatId: seat.id });
  assert.equal(calls, 1);
  resolveSnapshot({ success: true, snapshot: { daemonStatus: 'active' } });
  assert.deepEqual(await first, await second);
});
