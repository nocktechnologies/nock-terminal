const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_SETTINGS,
  SETTINGS_SCHEMA_KEY,
  SETTINGS_SCHEMA_VERSION,
} = require('../electron/settings-utils');
const { registerSettingsIPC } = require('../electron/settings-ipc');

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

function createStore(initial = {}) {
  const backing = { ...initial };
  return {
    get store() {
      return backing;
    },
    clear() {
      for (const key of Object.keys(backing)) delete backing[key];
    },
    set(key, value) {
      backing[key] = value;
    },
  };
}

function registerHarness(initialSettings = {}) {
  const ipc = createIpcHarness();
  const store = createStore(initialSettings);
  const runtimeEffects = [];
  const resetEffects = [];

  registerSettingsIPC({
    ipcMain: ipc.ipcMain,
    store,
    getSettingsSnapshot: () => ({ ...DEFAULT_SETTINGS, ...store.store }),
    applySettingsRuntimeEffects: (key, value) => runtimeEffects.push({ key, value }),
    applyResetRuntimeEffects: (settings) => resetEffects.push(settings),
  });

  return { ...ipc, store, runtimeEffects, resetEffects };
}

test('registerSettingsIPC registers the renderer settings contract', () => {
  const ipc = registerHarness();

  assert.deepEqual(ipc.registeredChannels(), [
    'settings:export',
    'settings:get',
    'settings:getAll',
    'settings:getSecure',
    'settings:getSecureStatus',
    'settings:reset',
    'settings:set',
  ]);
});

test('settings handlers redact renderer settings but allow explicit secure reads', () => {
  const ipc = registerHarness({
    defaultModel: 'qwen3.5:9b',
    telegramBotToken: '123:secret',
    nockccApiKey: 'nock-secret',
  });

  assert.equal(ipc.invoke('settings:get', 'defaultModel'), 'qwen3.5:9b');
  assert.equal(ipc.invoke('settings:get', 'telegramBotToken'), undefined);
  assert.equal(ipc.invoke('settings:getSecure', 'telegramBotToken'), '123:secret');
  assert.equal(ipc.invoke('settings:getSecure', 'futureAccessToken'), null);

  const all = ipc.invoke('settings:getAll');
  assert.equal(all.telegramBotToken, '');
  assert.equal(all.nockccApiKey, '');

  const exported = ipc.invoke('settings:export');
  assert.equal(exported.telegramBotToken, undefined);
  assert.equal(exported.nockccApiKey, undefined);

  assert.deepEqual(ipc.invoke('settings:getSecureStatus', 'telegramBotToken'), {
    key: 'telegramBotToken',
    configured: true,
  });
});

test('settings:set validates payloads, stores normalized values, and applies runtime effects', () => {
  const ipc = registerHarness();

  assert.deepEqual(ipc.invoke('settings:set', { key: 'windowOpacity', value: 85 }), {
    success: true,
    key: 'windowOpacity',
    value: 85,
  });
  assert.equal(ipc.store.store.windowOpacity, 85);
  assert.deepEqual(ipc.runtimeEffects, [{ key: 'windowOpacity', value: 85 }]);

  assert.deepEqual(ipc.invoke('settings:set', { key: 'notASetting', value: true }), {
    success: false,
    error: 'settings:set rejected invalid value for notASetting',
    code: 'IPC_VALIDATION_ERROR',
  });
});

test('settings:reset rewrites defaults, stamps schema, and applies reset effects', () => {
  const bounds = { width: 1400, height: 900, x: 10, y: 20 };
  const ipc = registerHarness({
    windowBounds: bounds,
    alwaysOnTop: true,
    telegramBotToken: '123:secret',
  });

  const reset = ipc.invoke('settings:reset');

  assert.deepEqual(ipc.store.store.windowBounds, bounds);
  assert.equal(ipc.store.store.alwaysOnTop, DEFAULT_SETTINGS.alwaysOnTop);
  assert.equal(ipc.store.store.telegramBotToken, DEFAULT_SETTINGS.telegramBotToken);
  assert.equal(ipc.store.store[SETTINGS_SCHEMA_KEY], SETTINGS_SCHEMA_VERSION);
  assert.equal(reset.telegramBotToken, '');
  assert.equal(ipc.resetEffects.length, 1);
  assert.deepEqual(ipc.resetEffects[0].windowBounds, bounds);
});
