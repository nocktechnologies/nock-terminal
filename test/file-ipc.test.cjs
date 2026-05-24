const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { registerFileIPC } = require('../electron/file-ipc');

function createIpcHarness() {
  const handlers = new Map();
  const listeners = new Map();
  return {
    ipcMain: {
      handle(channel, handler) {
        handlers.set(channel, handler);
      },
      on(channel, handler) {
        listeners.set(channel, handler);
      },
    },
    invoke(channel, ...args) {
      const handler = handlers.get(channel);
      assert.ok(handler, `Expected ${channel} to be registered`);
      return handler({}, ...args);
    },
    send(channel, ...args) {
      const handler = listeners.get(channel);
      assert.ok(handler, `Expected ${channel} to be registered`);
      return handler({}, ...args);
    },
    registeredChannels() {
      return {
        handle: [...handlers.keys()].sort(),
        on: [...listeners.keys()].sort(),
      };
    },
  };
}

function createFileHarness() {
  const allowedRoot = path.resolve('/tmp/nock-terminal-allowed');
  const calls = [];
  const fileService = {
    isAllowedPath(candidate) {
      const resolved = path.resolve(candidate);
      return resolved === allowedRoot || resolved.startsWith(`${allowedRoot}${path.sep}`);
    },
    tree(filePath) {
      calls.push(['tree', filePath]);
      return { entries: [{ name: 'README.md' }] };
    },
    read(filePath) {
      calls.push(['read', filePath]);
      return { content: 'hello' };
    },
    write(filePath, content) {
      calls.push(['write', filePath, content]);
      return { success: true };
    },
    stat(filePath) {
      calls.push(['stat', filePath]);
      return { exists: true, size: 5, mtime: 123 };
    },
    gitStatus(dirPath) {
      calls.push(['gitStatus', dirPath]);
      return { branch: 'main', changed: [] };
    },
    gitOp(dirPath, operation) {
      calls.push(['gitOp', dirPath, operation]);
      return { success: true, operation };
    },
  };
  const fileWatcher = {
    watch(filePath) {
      calls.push(['watch', filePath]);
    },
    stop() {
      calls.push(['stop']);
    },
  };

  const ipc = createIpcHarness();
  registerFileIPC({
    ipcMain: ipc.ipcMain,
    fileService,
    fileWatcher,
  });

  return {
    ...ipc,
    allowedRoot,
    allowedFile: path.join(allowedRoot, 'README.md'),
    allowedDir: path.join(allowedRoot, 'repo'),
    outsidePath: path.resolve('/tmp/nock-terminal-outside/README.md'),
    calls,
  };
}

test('registerFileIPC registers the renderer file contract', () => {
  const ipc = createFileHarness();

  assert.deepEqual(ipc.registeredChannels(), {
    handle: [
      'files:gitOp',
      'files:gitStatus',
      'files:read',
      'files:stat',
      'files:tree',
      'files:write',
    ],
    on: [
      'files:stopWatch',
      'files:watch',
    ],
  });
});

test('file read handlers preserve existing validation error shapes', () => {
  const ipc = createFileHarness();

  assert.deepEqual(ipc.invoke('files:read', ipc.outsidePath), {
    error: 'files:read path is outside allowed project roots',
    code: 'IPC_VALIDATION_ERROR',
  });
  assert.deepEqual(ipc.invoke('files:stat', ipc.outsidePath), {
    exists: false,
    size: 0,
    mtime: 0,
    error: 'files:stat path is outside allowed project roots',
    code: 'IPC_VALIDATION_ERROR',
  });
  assert.deepEqual(ipc.calls, []);
});

test('file mutation handlers preserve shared IPC validation payloads', () => {
  const ipc = createFileHarness();

  assert.deepEqual(ipc.invoke('files:write', { filePath: ipc.allowedFile, content: Buffer.from('nope') }), {
    success: false,
    error: 'files:write content must be a string',
    code: 'IPC_VALIDATION_ERROR',
  });
  assert.deepEqual(ipc.invoke('files:gitOp', { dirPath: ipc.allowedDir, operation: 'reset --hard' }), {
    success: false,
    error: 'files:gitOp operation is not allowed',
    code: 'IPC_VALIDATION_ERROR',
  });
  assert.deepEqual(ipc.calls, []);
});

test('file handlers validate paths before delegating to services', () => {
  const ipc = createFileHarness();

  assert.deepEqual(ipc.invoke('files:tree', ipc.allowedDir), { entries: [{ name: 'README.md' }] });
  assert.deepEqual(ipc.invoke('files:read', ipc.allowedFile), { content: 'hello' });
  assert.deepEqual(ipc.invoke('files:write', { filePath: ipc.allowedFile, content: 'hello' }), { success: true });
  assert.deepEqual(ipc.invoke('files:stat', ipc.allowedFile), { exists: true, size: 5, mtime: 123 });
  assert.deepEqual(ipc.invoke('files:gitStatus', ipc.allowedDir), { branch: 'main', changed: [] });
  assert.deepEqual(ipc.invoke('files:gitOp', { dirPath: ipc.allowedDir, operation: 'fetch' }), {
    success: true,
    operation: 'fetch',
  });

  assert.deepEqual(ipc.calls, [
    ['tree', ipc.allowedDir],
    ['read', ipc.allowedFile],
    ['write', ipc.allowedFile, 'hello'],
    ['stat', ipc.allowedFile],
    ['gitStatus', ipc.allowedDir],
    ['gitOp', ipc.allowedDir, 'fetch'],
  ]);
});

test('file watcher handlers ignore invalid roots and stop existing watchers', () => {
  const ipc = createFileHarness();

  ipc.send('files:watch', ipc.outsidePath);
  ipc.send('files:watch', ipc.allowedDir);
  ipc.send('files:stopWatch');

  assert.deepEqual(ipc.calls, [
    ['watch', ipc.allowedDir],
    ['stop'],
  ]);
});
