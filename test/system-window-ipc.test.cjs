const test = require('node:test');
const assert = require('node:assert/strict');

const { registerSystemWindowIPC } = require('../electron/system-window-ipc');

function createIpcHarness() {
  const handlers = new Map();
  const listeners = new Map();
  return {
    ipcMain: {
      handle(channel, handler) {
        handlers.set(channel, handler);
      },
      on(channel, listener) {
        listeners.set(channel, listener);
      },
    },
    invoke(channel, ...args) {
      const handler = handlers.get(channel);
      assert.ok(handler, `Expected ${channel} to be registered`);
      return handler({}, ...args);
    },
    send(channel, ...args) {
      const listener = listeners.get(channel);
      assert.ok(listener, `Expected ${channel} to be registered`);
      return listener({}, ...args);
    },
    registeredHandleChannels() {
      return [...handlers.keys()].sort();
    },
    registeredEventChannels() {
      return [...listeners.keys()].sort();
    },
  };
}

function createWindow() {
  const calls = [];
  let maximized = false;
  return {
    calls,
    setMaximized(value) {
      maximized = value;
    },
    minimize() {
      calls.push(['minimize']);
    },
    maximize() {
      calls.push(['maximize']);
      maximized = true;
    },
    unmaximize() {
      calls.push(['unmaximize']);
      maximized = false;
    },
    close() {
      calls.push(['close']);
    },
    isMaximized() {
      return maximized;
    },
    setAlwaysOnTop(value) {
      calls.push(['setAlwaysOnTop', value]);
    },
    setOpacity(value) {
      calls.push(['setOpacity', value]);
    },
  };
}

function registerHarness(overrides = {}) {
  const ipc = createIpcHarness();
  const window = createWindow();
  const calls = {
    external: [],
    shownItems: [],
    clipboardWrites: [],
  };
  const harness = {
    ...ipc,
    calls,
    window,
    shell: {
      openExternal(url) {
        calls.external.push(url);
      },
      showItemInFolder(filePath) {
        calls.shownItems.push(filePath);
      },
    },
    clipboard: {
      readText() {
        return 'clip text';
      },
      writeText(text) {
        calls.clipboardWrites.push(text);
      },
    },
    fileService: {
      isAllowedPath(filePath) {
        return filePath === '/allowed.txt';
      },
    },
    portScanner: {
      scan() {
        return [{ port: 5173, process: 'vite' }];
      },
    },
  };

  registerSystemWindowIPC({
    ipcMain: ipc.ipcMain,
    app: { getVersion: () => '1.2.3' },
    shell: harness.shell,
    clipboard: harness.clipboard,
    portScanner: harness.portScanner,
    fileService: harness.fileService,
    getMainWindow: () => overrides.mainWindow ?? window,
    getSettingsSnapshot: () => ({ ollamaUrl: 'http://ollama.test' }),
    detectShells: async () => [{ path: '/bin/zsh', name: 'zsh' }],
    fetchOllamaVersion: async (url) => `version-from:${url}`,
    agentAdapters: () => [
      { id: 'codex', label: 'Codex', command: 'codex' },
      { id: 'custom', label: 'Custom', command: '' },
    ],
    findCommand: async (command) => (command === 'codex' ? '/usr/local/bin/codex' : null),
    ...overrides,
  });

  return harness;
}

test('registerSystemWindowIPC registers the renderer system/window contract', () => {
  const ipc = registerHarness();

  assert.deepEqual(ipc.registeredHandleChannels(), [
    'clipboard:read',
    'ports:scan',
    'system:appVersion',
    'system:detectAgents',
    'system:detectShells',
    'system:ollamaVersion',
    'window:isMaximized',
    'window:setAlwaysOnTop',
    'window:setOpacity',
  ]);
  assert.deepEqual(ipc.registeredEventChannels(), [
    'clipboard:write',
    'shell:openExternal',
    'shell:showItemInFolder',
    'window:close',
    'window:maximize',
    'window:minimize',
  ]);
});

test('window handlers delegate controls and validate opacity settings', async () => {
  const ipc = registerHarness();

  ipc.send('window:minimize');
  assert.equal(await ipc.invoke('window:isMaximized'), false);
  ipc.send('window:maximize');
  assert.equal(await ipc.invoke('window:isMaximized'), true);
  ipc.send('window:maximize');
  await ipc.invoke('window:setAlwaysOnTop', true);
  await ipc.invoke('window:setOpacity', 85);
  await ipc.invoke('window:setOpacity', 65);
  ipc.send('window:close');

  assert.deepEqual(ipc.window.calls, [
    ['minimize'],
    ['maximize'],
    ['unmaximize'],
    ['setAlwaysOnTop', true],
    ['setOpacity', 0.85],
    ['close'],
  ]);
});

test('system handlers delegate ports, shell discovery, versions, and agents', async () => {
  const ipc = registerHarness();

  assert.deepEqual(await ipc.invoke('ports:scan'), [{ port: 5173, process: 'vite' }]);
  assert.deepEqual(await ipc.invoke('system:detectShells'), [{ path: '/bin/zsh', name: 'zsh' }]);
  assert.equal(await ipc.invoke('system:ollamaVersion'), 'version-from:http://ollama.test');
  assert.equal(await ipc.invoke('system:appVersion'), '1.2.3');
  assert.deepEqual(await ipc.invoke('system:detectAgents'), [
    {
      id: 'codex',
      label: 'Codex',
      command: 'codex',
      path: '/usr/local/bin/codex',
      installed: true,
    },
    {
      id: 'custom',
      label: 'Custom',
      command: '',
      path: null,
      installed: false,
    },
  ]);
});

test('shell and clipboard handlers guard renderer-controlled payloads', async () => {
  const ipc = registerHarness();

  ipc.send('shell:openExternal', 'https://example.com');
  ipc.send('shell:openExternal', 'http://example.com');
  ipc.send('shell:openExternal', 'javascript:alert(1)');
  ipc.send('shell:openExternal', 123);
  ipc.send('shell:showItemInFolder', '/allowed.txt');
  ipc.send('shell:showItemInFolder', '/blocked.txt');
  assert.equal(await ipc.invoke('clipboard:read'), 'clip text');
  ipc.send('clipboard:write', 'copied');
  ipc.send('clipboard:write', null);

  assert.deepEqual(ipc.calls.external, ['https://example.com', 'http://example.com']);
  assert.deepEqual(ipc.calls.shownItems, ['/allowed.txt']);
  assert.deepEqual(ipc.calls.clipboardWrites, ['copied', '']);
});
