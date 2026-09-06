const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const FileService = require('../electron/file-service');
const { registerSessionIPC, safeSessionRoots } = require('../electron/session-ipc');

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

function registerHarness({ sessions = [] } = {}) {
  const ipc = createIpcHarness();
  const calls = [];

  registerSessionIPC({
    ipcMain: ipc.ipcMain,
    sessionDiscovery: {
      async discover() {
        calls.push(['discover']);
        return sessions;
      },
    },
    fileService: {
      setGrantedRoots(roots) {
        calls.push(['setGrantedRoots', roots]);
      },
    },
    fileWatcher: {
      revalidate() {
        calls.push(['revalidate']);
      },
    },
  });

  return { ...ipc, calls };
}

test('safeSessionRoots keeps only usable session paths', () => {
  assert.deepEqual(safeSessionRoots([
    { path: '/repo/a' },
    { path: '' },
    { path: null },
    {},
    null,
    { path: '/repo/b' },
  ]), ['/repo/a', '/repo/b']);

  assert.deepEqual(safeSessionRoots(null), []);
});

test('registerSessionIPC registers the renderer session contract', () => {
  const ipc = registerHarness();

  assert.deepEqual(ipc.registeredChannels(), ['sessions:discover']);
});

test('sessions:discover delegates discovery and refreshes granted file roots', async () => {
  const sessions = [
    { id: 'one', path: '/repo/one' },
    { id: 'bad' },
    { id: 'two', path: '/repo/two' },
  ];
  const ipc = registerHarness({ sessions });

  assert.equal(await ipc.invoke('sessions:discover'), sessions);
  assert.deepEqual(ipc.calls, [
    ['discover'],
    ['setGrantedRoots', ['/repo/one', '/repo/two']],
    ['revalidate'],
  ]);
});

test('sessions:discover does not refresh roots if discovery fails', async () => {
  const ipc = createIpcHarness();
  const calls = [];

  registerSessionIPC({
    ipcMain: ipc.ipcMain,
    sessionDiscovery: {
      async discover() {
        calls.push(['discover']);
        throw new Error('discovery unavailable');
      },
    },
    fileService: {
      setGrantedRoots() {
        calls.push(['setGrantedRoots']);
      },
    },
    fileWatcher: {
      revalidate() {
        calls.push(['revalidate']);
      },
    },
  });

  await assert.rejects(() => ipc.invoke('sessions:discover'), /discovery unavailable/);
  assert.deepEqual(calls, [['discover']]);
});

test('sessions:discover does not grant file roots outside configured devRoots', async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'nock-terminal-session-ipc-'));
  test.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

  const configured = path.join(sandbox, 'workspace');
  const inside = path.join(configured, 'product');
  const outside = path.join(sandbox, 'secrets');
  fs.mkdirSync(inside, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });

  const ipc = createIpcHarness();
  const fileService = new FileService({
    get(key) {
      if (key === 'devRoots') return [configured];
      return undefined;
    },
  });

  registerSessionIPC({
    ipcMain: ipc.ipcMain,
    sessionDiscovery: {
      async discover() {
        return [
          { id: 'inside', path: inside },
          { id: 'outside', path: outside },
        ];
      },
    },
    fileService,
    fileWatcher: { revalidate() {} },
  });

  await ipc.invoke('sessions:discover');

  assert.equal(fileService.isAllowedPath(inside), true);
  assert.equal(fileService.isAllowedPath(outside), false);
  assert.equal(fileService.grantedRoots.some((root) => root === fs.realpathSync(outside)), false);
});
