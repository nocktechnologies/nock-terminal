const test = require('node:test');
const assert = require('node:assert/strict');

const { registerTelegramIPC } = require('../electron/telegram-ipc');

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

function registerHarness() {
  const ipc = createIpcHarness();
  const calls = [];

  registerTelegramIPC({
    ipcMain: ipc.ipcMain,
    telegramNotifier: {
      async test() {
        calls.push(['test']);
        return { success: true };
      },
      async notify(eventType, details) {
        calls.push(['notify', eventType, details]);
        return { success: true, eventType, details };
      },
    },
  });

  return { ...ipc, calls };
}

test('registerTelegramIPC registers the renderer Telegram contract', () => {
  const ipc = registerHarness();

  assert.deepEqual(ipc.registeredChannels(), [
    'telegram:notify',
    'telegram:test',
  ]);
});

test('telegram:test delegates to the notifier', async () => {
  const ipc = registerHarness();

  assert.deepEqual(await ipc.invoke('telegram:test'), { success: true });
  assert.deepEqual(ipc.calls, [['test']]);
});

test('telegram:notify delegates event type and details to the notifier', async () => {
  const ipc = registerHarness();

  assert.deepEqual(await ipc.invoke('telegram:notify', {
    eventType: 'build_complete',
    details: 'Build finished',
  }), {
    success: true,
    eventType: 'build_complete',
    details: 'Build finished',
  });
  assert.deepEqual(ipc.calls, [
    ['notify', 'build_complete', 'Build finished'],
  ]);
});

test('telegram:notify tolerates malformed payloads while preserving delegation', async () => {
  const ipc = registerHarness();

  assert.deepEqual(await ipc.invoke('telegram:notify', null), {
    success: true,
    eventType: undefined,
    details: undefined,
  });
  assert.deepEqual(ipc.calls, [
    ['notify', undefined, undefined],
  ]);
});
