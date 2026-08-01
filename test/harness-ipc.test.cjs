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
    'harness:launch',
    'harness:list',
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
    },
    getSettingsSnapshot: () => ({ harnessSeats: [seat], defaultShell: '/bin/zsh' }),
  });

  assert.deepEqual(await ipc.invoke('harness:list'), [seat]);
  assert.equal((await ipc.invoke('harness:snapshot', { seatId: seat.id })).success, true);
  assert.equal((await ipc.invoke('harness:launch', { seatId: seat.id, mode: 'console' })).command, 'trusted command');
  assert.equal((await ipc.invoke('harness:snapshot', { seatId: 'unknown' })).code, 'HARNESS_SEAT_NOT_FOUND');
  assert.equal((await ipc.invoke('harness:launch', { seatId: seat.id, mode: 'restart' })).code, 'IPC_VALIDATION_ERROR');
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1][3], { shell: '/bin/zsh' });
});

test('rejects malformed harness request payloads before calling the service', async () => {
  const ipc = createIpcHarness();
  registerHarnessIPC({
    ipcMain: ipc.ipcMain,
    service: {
      snapshot: async () => assert.fail('service must not run for invalid payloads'),
      launch: () => assert.fail('service must not run for invalid payloads'),
    },
    getSettingsSnapshot: () => ({ harnessSeats: [seat] }),
  });

  for (const payload of [undefined, null, 'seat', [seat.id], {}, { seatId: 42 }, { seatId: '' }, { seatId: 'x'.repeat(401) }]) {
    assert.equal((await ipc.invoke('harness:snapshot', payload)).code, 'IPC_VALIDATION_ERROR');
  }
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
