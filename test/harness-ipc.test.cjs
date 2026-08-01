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
      launch: (configuredSeat, mode) => {
        calls.push(['launch', configuredSeat, mode]);
        return { success: true, command: 'trusted command' };
      },
    },
    getSettingsSnapshot: () => ({ harnessSeats: [seat] }),
  });

  assert.deepEqual(await ipc.invoke('harness:list'), [seat]);
  assert.equal((await ipc.invoke('harness:snapshot', { seatId: seat.id })).success, true);
  assert.equal((await ipc.invoke('harness:launch', { seatId: seat.id, mode: 'console' })).command, 'trusted command');
  assert.equal((await ipc.invoke('harness:snapshot', { seatId: 'unknown' })).code, 'HARNESS_SEAT_NOT_FOUND');
  assert.equal((await ipc.invoke('harness:launch', { seatId: seat.id, mode: 'restart' })).code, 'IPC_VALIDATION_ERROR');
  assert.equal(calls.length, 2);
});
