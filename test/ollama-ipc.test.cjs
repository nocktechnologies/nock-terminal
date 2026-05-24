const test = require('node:test');
const assert = require('node:assert/strict');

const { registerOllamaIPC, sendOllamaStreamChunk } = require('../electron/ollama-ipc');

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

function registerHarness(overrides = {}) {
  const ipc = createIpcHarness();
  const calls = [];
  const streamEvents = [];
  const window = {
    webContents: {
      send(channel, payload) {
        streamEvents.push([channel, payload]);
      },
    },
  };
  const ollamaClient = {
    async chat(model, messages, onChunk) {
      calls.push(['chat', model, messages]);
      onChunk('hello ');
      onChunk('world');
      return { success: true, content: 'hello world', model };
    },
    async listModels() {
      calls.push(['listModels']);
      return [{ name: 'llama3' }];
    },
    async checkStatus() {
      calls.push(['checkStatus']);
      return { connected: true, models: [] };
    },
    ...overrides.ollamaClient,
  };

  registerOllamaIPC({
    ipcMain: ipc.ipcMain,
    ollamaClient,
    getMainWindow: overrides.getMainWindow || (() => window),
  });

  return { ...ipc, calls, streamEvents };
}

test('registerOllamaIPC registers the renderer Ollama contract', () => {
  const ipc = registerHarness();

  assert.deepEqual(ipc.registeredChannels(), [
    'ai:ollama:chat',
    'ai:ollama:models',
    'ai:ollama:status',
  ]);
});

test('ai:ollama:chat delegates chat payload and forwards stream chunks', async () => {
  const ipc = registerHarness();

  assert.deepEqual(await ipc.invoke('ai:ollama:chat', {
    model: 'llama3',
    messages: [{ role: 'user', content: 'Hi' }],
  }), {
    success: true,
    content: 'hello world',
    model: 'llama3',
  });

  assert.deepEqual(ipc.calls, [
    ['chat', 'llama3', [{ role: 'user', content: 'Hi' }]],
  ]);
  assert.deepEqual(ipc.streamEvents, [
    ['ai:stream', { chunk: 'hello ' }],
    ['ai:stream', { chunk: 'world' }],
  ]);
});

test('ai:ollama models and status delegate to OllamaClient', async () => {
  const ipc = registerHarness();

  assert.deepEqual(await ipc.invoke('ai:ollama:models'), [{ name: 'llama3' }]);
  assert.deepEqual(await ipc.invoke('ai:ollama:status'), { connected: true, models: [] });
  assert.deepEqual(ipc.calls, [
    ['listModels'],
    ['checkStatus'],
  ]);
});

test('sendOllamaStreamChunk tolerates a missing window', () => {
  assert.doesNotThrow(() => sendOllamaStreamChunk(() => null, 'chunk'));
});

test('ai:ollama:chat tolerates malformed payloads while preserving delegation', async () => {
  const ipc = registerHarness({
    getMainWindow: () => null,
    ollamaClient: {
      async chat(model, messages) {
        return { model, messages };
      },
    },
  });

  assert.deepEqual(await ipc.invoke('ai:ollama:chat', null), {
    model: undefined,
    messages: undefined,
  });
});
