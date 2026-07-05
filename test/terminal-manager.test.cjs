const test = require('node:test');
const assert = require('node:assert/strict');

const TerminalManager = require('../electron/terminal-manager');

function createManagerWithFakePty(options = {}) {
  const manager = new TerminalManager({
    now: options.now,
    isPidAlive: options.isPidAlive || (() => true),
  });
  const calls = [];
  const processes = [];
  manager.pty = {
    spawn(shell, args, options) {
      calls.push({ shell, args, options });
      const processRecord = {
        pid: options.pid || 1234 + processes.length,
        killed: false,
        onDataHandler: null,
        onExitHandler: null,
        onData(callback) {
          this.onDataHandler = callback;
        },
        onExit(callback) {
          this.onExitHandler = callback;
        },
        write() {},
        resize() {},
        kill() {
          this.killed = true;
        },
        emitData(data) {
          this.onDataHandler?.(data);
        },
        emitExit(exitCode) {
          this.onExitHandler?.({ exitCode });
        },
      };
      processes.push(processRecord);
      return processRecord;
    },
  };
  return { manager, calls, processes };
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

test('create preserves literal backslashes in shell args', () => {
  const { manager, calls } = createManagerWithFakePty();

  const result = manager.create('tab-1', '/tmp', {
    shell: '/bin/zsh',
    shellArgs: '--path "C:\\Users\\kevin\\Dev" plain\\ value',
  });

  assert.equal(result.success, true);
  assert.deepEqual(calls[0].args, ['-i', '-l', '--path', 'C:\\Users\\kevin\\Dev', 'plain value']);
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

test('create drops loader-injection and shell-hook environment variables', () => {
  const { manager, calls } = createManagerWithFakePty();

  const result = manager.create('tab-1', '/tmp', {
    shell: '/bin/bash',
    envVars: [
      'LD_PRELOAD=/tmp/evil.so',
      'DYLD_INSERT_LIBRARIES=/tmp/evil.dylib',
      'NODE_OPTIONS=--require /tmp/evil.js',
      'node_options=--require /tmp/evil.js',
      'BASH_ENV=/tmp/evil.sh',
      'PROMPT_COMMAND=touch /tmp/pwned',
      'SAFE_VAR=ok',
    ].join('\n'),
  });

  assert.equal(result.success, true);
  const env = calls[0].options.env;
  assert.equal(env.SAFE_VAR, 'ok');
  assert.notEqual(env.LD_PRELOAD, '/tmp/evil.so');
  assert.notEqual(env.DYLD_INSERT_LIBRARIES, '/tmp/evil.dylib');
  assert.notEqual(env.NODE_OPTIONS, '--require /tmp/evil.js');
  assert.notEqual(env.node_options, '--require /tmp/evil.js');
  assert.notEqual(env.BASH_ENV, '/tmp/evil.sh');
  assert.notEqual(env.PROMPT_COMMAND, 'touch /tmp/pwned');
});

test('listTerminals exposes terminal metadata and activity timestamps', () => {
  let now = 10_000;
  const { manager, processes } = createManagerWithFakePty({ now: () => now });

  manager.create('tab-1', '/tmp/project', { shell: '/bin/zsh' });
  now = 11_000;
  manager.write('tab-1', 'echo ok\r');
  now = 12_000;
  manager.resize('tab-1', 100, 40);
  now = 13_000;
  processes[0].emitData('ok');

  assert.deepEqual(manager.listTerminals(), [
    {
      id: 'tab-1',
      pid: 1234,
      cwd: '/tmp/project',
      shell: '/bin/zsh',
      createdAt: 10_000,
      lastDataAt: 13_000,
      lastResizeAt: 12_000,
      lastWriteAt: 11_000,
    },
  ]);
});

test('reapStaleTerminals keeps renderer-owned terminals alive', () => {
  const { manager, processes } = createManagerWithFakePty({ now: () => 20_000 });
  manager.create('tab-1', '/tmp/project');

  const result = manager.reapStaleTerminals({
    liveTerminalIds: ['tab-1'],
    graceMs: 1_000,
  });

  assert.deepEqual(result.reaped, []);
  assert.equal(result.activeCount, 1);
  assert.equal(processes[0].killed, false);
});

test('reapStaleTerminals waits for the grace window before killing an orphaned terminal', () => {
  let now = 20_000;
  const { manager, processes } = createManagerWithFakePty({ now: () => now });
  manager.create('tab-1', '/tmp/project');
  now = 20_500;

  const result = manager.reapStaleTerminals({
    liveTerminalIds: [],
    graceMs: 1_000,
  });

  assert.deepEqual(result.reaped, []);
  assert.equal(result.activeCount, 1);
  assert.equal(processes[0].killed, false);
});

test('exit event carries the terminal cwd as trailing metadata (for notifications)', () => {
  const { manager, processes } = createManagerWithFakePty();
  const exits = [];
  manager.on('exit', (id, code, details, meta) => exits.push({ id, code, details, meta }));

  manager.create('tab-1', '/tmp/project');
  processes[0].emitExit(0);

  assert.deepEqual(exits, [
    {
      id: 'tab-1',
      code: 0,
      // details keeps its existing shape; cwd rides alongside as a 4th arg.
      details: { reason: 'process-exit' },
      meta: { cwd: '/tmp/project' },
    },
  ]);
});

test('reapStaleTerminals kills orphaned terminals after the grace window', () => {
  let now = 20_000;
  const { manager, processes } = createManagerWithFakePty({ now: () => now });
  const exits = [];
  manager.on('exit', (id, code, details) => exits.push({ id, code, details }));

  manager.create('tab-1', '/tmp/project');
  now = 22_000;

  const result = manager.reapStaleTerminals({
    liveTerminalIds: [],
    graceMs: 1_000,
  });

  assert.equal(processes[0].killed, true);
  assert.deepEqual(result.reaped, [
    {
      id: 'tab-1',
      pid: 1234,
      reason: 'orphaned-renderer-tab',
    },
  ]);
  assert.equal(result.activeCount, 0);
  assert.equal(manager.getActiveCount(), 0);
  assert.equal(manager.listTerminals().length, 0);
  assert.deepEqual(exits, [
    {
      id: 'tab-1',
      code: null,
      details: {
        pid: 1234,
        reason: 'orphaned-renderer-tab',
        reaped: true,
      },
    },
  ]);
});

test('reapStaleTerminals preserves terminals created after the renderer started', () => {
  let now = 20_000;
  const { manager, processes } = createManagerWithFakePty({ now: () => now });
  manager.create('tab-1', '/tmp/project');   // created at 20_000
  now = 30_000;                              // renderer mounts here
  manager.create('tab-2', '/tmp/other');     // created at 30_000
  now = 40_000;                              // reap fires here

  const result = manager.reapStaleTerminals({
    liveTerminalIds: [],
    graceMs: 1_000,
    rendererStartedAt: 25_000,
  });

  assert.equal(processes[0].killed, true, 'older orphan is killed');
  assert.equal(processes[1].killed, false, 'newer terminal predates current renderer — preserved');
  assert.deepEqual(result.reaped.map(r => r.id), ['tab-1']);
  assert.equal(result.activeCount, 1);
});

test('reapStaleTerminals removes dead pid records even when the renderer still lists them', () => {
  const { manager, processes } = createManagerWithFakePty({
    now: () => 20_000,
    isPidAlive: () => false,
  });
  const exits = [];
  manager.on('exit', (id, code, details) => exits.push({ id, code, details }));

  manager.create('tab-1', '/tmp/project');
  const result = manager.reapStaleTerminals({
    liveTerminalIds: ['tab-1'],
    graceMs: 1_000,
  });

  assert.equal(processes[0].killed, false);
  assert.deepEqual(result.reaped, [
    {
      id: 'tab-1',
      pid: 1234,
      reason: 'dead-root-pid',
    },
  ]);
  assert.equal(result.activeCount, 0);
  assert.deepEqual(exits, [
    {
      id: 'tab-1',
      code: null,
      details: {
        pid: 1234,
        reason: 'dead-root-pid',
        reaped: true,
      },
    },
  ]);
});

test('destroy emits one explicit close event and ignores the later pty exit', () => {
  const { manager, processes } = createManagerWithFakePty();
  const exits = [];
  manager.on('exit', (id, code, details) => exits.push({ id, code, details }));

  manager.create('tab-1', '/tmp/project');
  manager.destroy('tab-1');
  processes[0].emitExit(0);

  assert.equal(processes[0].killed, true);
  assert.equal(manager.getActiveCount(), 0);
  assert.deepEqual(exits, [
    {
      id: 'tab-1',
      code: null,
      details: {
        pid: 1234,
        reason: 'destroyed',
      },
    },
  ]);
});

test('destroy still reports reason:destroyed when onExit fires synchronously inside kill()', () => {
  const { manager, processes } = createManagerWithFakePty();
  const exits = [];
  manager.on('exit', (id, code, details) => exits.push({ id, code, details }));

  manager.create('tab-1', '/tmp/project');
  // Simulate platforms where node-pty fires onExit synchronously during kill().
  const proc = processes[0];
  proc.kill = function () {
    this.killed = true;
    this.emitExit(143);
  };

  manager.destroy('tab-1');

  assert.equal(proc.killed, true);
  assert.equal(manager.getActiveCount(), 0);
  assert.deepEqual(exits, [
    {
      id: 'tab-1',
      code: null,
      details: { pid: 1234, reason: 'destroyed' },
    },
  ]);
});

test('write queue serializes overlapping large payloads (no interleaving)', async () => {
  const { manager, processes } = createManagerWithFakePty();
  manager.create('tab-1', '/tmp/project');
  const proc = processes[0];

  const writes = [];
  proc.write = (chunk) => { writes.push(chunk); };

  // Two payloads larger than the 512-byte chunk size, enqueued back-to-back.
  const payloadA = 'A'.repeat(1500);
  const payloadB = 'B'.repeat(1500);

  manager.write('tab-1', payloadA);
  manager.write('tab-1', payloadB);

  // Drain — chunks fire on 1ms setTimeouts; wait generously.
  await new Promise((resolve) => setTimeout(resolve, 100));

  const reconstructed = writes.join('');
  assert.equal(reconstructed, payloadA + payloadB,
    'chunks must be emitted strictly in submission order, A fully before B');
  assert.ok(writes.length >= 6, 'large payloads should be split into multiple chunks');
});
