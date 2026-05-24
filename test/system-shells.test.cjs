const test = require('node:test');
const assert = require('node:assert/strict');

const { listAvailableShells } = require('../electron/system-shells');

function createFs(existingPaths = []) {
  return {
    existsSync(filePath) {
      return existingPaths.includes(filePath);
    },
    realpathSync(filePath) {
      return filePath;
    },
  };
}

test('detects dash without leaking unsupported --version stderr', async () => {
  const execCalls = [];
  const shells = await listAvailableShells({
    platform: 'linux',
    env: {},
    fs: createFs(['/bin/dash']),
    execFile(filePath, args, options, callback) {
      execCalls.push({ filePath, args, options });
      const err = new Error('unsupported option');
      err.status = 2;
      callback(err, '', '/bin/dash: 0: Illegal option --\n');
    },
  });

  assert.deepEqual(shells, [{ name: 'Dash', path: '/bin/dash', version: '' }]);
  assert.deepEqual(execCalls[0].args, ['--version']);
  assert.deepEqual(execCalls[0].options.stdio, ['ignore', 'pipe', 'pipe']);
});

test('deduplicates login shell and known shell candidates by real path', async () => {
  const shells = await listAvailableShells({
    platform: 'linux',
    env: { SHELL: '/usr/bin/zsh' },
    fs: {
      existsSync(filePath) {
        return ['/usr/bin/zsh', '/bin/zsh'].includes(filePath);
      },
      realpathSync() {
        return '/usr/bin/zsh-real';
      },
    },
    execFile(_command, _args, _options, callback) {
      callback(null, 'zsh 5.9\n', '');
    },
  });

  assert.deepEqual(shells, [{ name: 'Zsh', path: '/usr/bin/zsh', version: 'zsh 5.9' }]);
});

test('keeps WSL detection when status command succeeds without output', async () => {
  const execCalls = [];
  const shells = await listAvailableShells({
    platform: 'win32',
    env: {},
    fs: createFs([]),
    execFile(command, args, options, callback) {
      execCalls.push({ command, args, options });
      if (command === 'wsl') {
        callback(null, '', '');
        return;
      }
      const err = new Error('not installed');
      err.code = 'ENOENT';
      callback(err, '', '');
    },
  });

  assert.deepEqual(shells, [{ name: 'WSL', path: 'wsl', version: '' }]);
  const wslCall = execCalls.find((call) => call.command === 'wsl');
  assert.deepEqual(wslCall.args, ['--status']);
  assert.deepEqual(wslCall.options.stdio, ['ignore', 'pipe', 'pipe']);
});

test('keeps installed PowerShell entries with blank versions and skips invalid cmd paths', async () => {
  const shells = await listAvailableShells({
    platform: 'win32',
    env: { COMSPEC: 'C:\\Missing\\cmd.exe' },
    fs: createFs([]),
    execFile(command, _args, _options, callback) {
      if (command === 'pwsh') {
        const err = new Error('probe timed out');
        err.code = 'ETIMEDOUT';
        callback(err, '', 'timed out');
        return;
      }
      const err = new Error('not installed');
      err.code = 'ENOENT';
      callback(err, '', '');
    },
  });

  assert.deepEqual(shells, [{ name: 'PowerShell 7', path: 'pwsh', version: '' }]);
});
