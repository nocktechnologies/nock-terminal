const test = require('node:test');
const assert = require('node:assert/strict');

const TerminalManager = require('../electron/terminal-manager');

function createManagerWithFakePty() {
  const manager = new TerminalManager();
  const calls = [];
  manager.pty = {
    spawn(shell, args, options) {
      calls.push({ shell, args, options });
      return {
        pid: 1234,
        onData() {},
        onExit() {},
        write() {},
        resize() {},
        kill() {},
      };
    },
  };
  return { manager, calls };
}

test('create applies explicit shell and parsed shell args', () => {
  const { manager, calls } = createManagerWithFakePty();

  const result = manager.create('tab-1', '/tmp', {
    shell: '/bin/zsh',
    shellArgs: '--login --command "echo ok"',
  });

  assert.equal(result.success, true);
  assert.equal(calls[0].shell, '/bin/zsh');
  assert.deepEqual(calls[0].args, ['-i', '-l', '--login', '--command', 'echo ok']);
});

test('create injects only valid project environment variables', () => {
  const { manager, calls } = createManagerWithFakePty();

  const result = manager.create('tab-1', '/tmp', {
    shell: '/bin/bash',
    envVars: [
      'NODE_ENV=development',
      'BAD-KEY=nope',
      'EMPTY_VALUE=',
      'SPACED = nope',
    ].join('\n'),
  });

  assert.equal(result.success, true);
  assert.equal(calls[0].options.env.NODE_ENV, 'development');
  assert.equal(calls[0].options.env.EMPTY_VALUE, '');
  assert.equal(calls[0].options.env['BAD-KEY'], undefined);
  assert.equal(calls[0].options.env.SPACED, undefined);
  assert.equal(calls[0].options.env.TERM, 'xterm-256color');
});
