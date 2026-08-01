const test = require('node:test');
const assert = require('node:assert/strict');

const {
  HarnessSeatService,
  buildHarnessLaunchDescriptor,
  parseHarnessSnapshot,
} = require('../electron/harness-seat-service');

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

const snapshotOutput = `__NOCK_STATUS__
mira-agentd : active
context     : [###########---------] 58%  (576,998 / 1,000,000 tokens)   warn 30% · rotate 60%
thread age  : 8.2h  (routine rotate at 71h)
queue       : {'completed': 884, 'purged': 1, 'working': 1}
last turn   : completed [telegram] 3m ago
__NOCK_QUEUE__
# 886 working    message/telegram a=1  :: {"prompt": "Build the console"}
(1 rows; counts={'completed': 884, 'purged': 1, 'working': 1})
__NOCK_MANIFEST__
{"runtime":"claude","model":"claude-opus-4-8[1m]","home":"/home/nock/Dev/mira-home","work_dir":"/home/nock/Dev/mira-home","turn_budget":{"enabled":true,"hard_s":1200}}
`;

test('parses harness status, queue, and residence evidence into a bounded snapshot', () => {
  assert.deepEqual(parseHarnessSnapshot(snapshotOutput, seat), {
    seatId: seat.id,
    connected: true,
    daemonStatus: 'active',
    context: {
      ratio: 0.58,
      tokensUsed: 576998,
      contextWindow: 1000000,
      warnRatio: 0.3,
      rotateRatio: 0.6,
    },
    threadAgeHours: 8.2,
    routineRotateHours: 71,
    queueCounts: { completed: 884, purged: 1, working: 1 },
    queue: [{
      id: 886,
      state: 'working',
      class: 'message',
      source: 'telegram',
      attempts: 1,
      summary: '{"prompt": "Build the console"}',
    }],
    lastTurn: { status: 'completed', source: 'telegram', age: '3m ago' },
    manifest: {
      runtime: 'claude',
      model: 'claude-opus-4-8[1m]',
      home: '/home/nock/Dev/mira-home',
      workDir: '/home/nock/Dev/mira-home',
      turnBudget: { enabled: true, hardSeconds: 1200 },
    },
  });
});

test('builds quoted console, watch, and shell launches only from normalized seats', () => {
  const consoleLaunch = buildHarnessLaunchDescriptor(seat, 'console');
  const watchLaunch = buildHarnessLaunchDescriptor(seat, 'watch');
  const shellLaunch = buildHarnessLaunchDescriptor(seat, 'shell');

  assert.equal(consoleLaunch.success, true);
  assert.match(consoleLaunch.command, /^ssh -t /);
  assert.match(consoleLaunch.command, /scripts\/console/);
  assert.match(watchLaunch.command, /scripts\/watch/);
  assert.match(shellLaunch.command, /exec "\$\{SHELL:-\/bin\/bash\}" -l/);
  assert.equal(buildHarnessLaunchDescriptor({ ...seat, host: 'bad;host' }, 'console').success, false);
  assert.equal(buildHarnessLaunchDescriptor(seat, 'restart').success, false);
});

test('fetches a snapshot through non-interactive bounded SSH', async () => {
  const calls = [];
  const service = new HarnessSeatService({
    runSsh: async (args, options) => {
      calls.push({ args, options });
      return { stdout: snapshotOutput, stderr: '' };
    },
  });

  const result = await service.snapshot(seat);

  assert.equal(result.success, true);
  assert.equal(result.snapshot.daemonStatus, 'active');
  assert.deepEqual(calls[0].args.slice(0, 7), [
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=5',
    '-o', 'LogLevel=ERROR',
    '-p',
  ]);
  assert.equal(calls[0].args[7], '22');
  assert.equal(calls[0].args[8], '--');
  assert.equal(calls[0].args[9], 'nock@nock-fleet-02');
  assert.equal(calls[0].options.timeout, 8000);
});

test('returns a helpful offline result without exposing raw SSH stderr', async () => {
  const service = new HarnessSeatService({
    runSsh: async () => {
      const error = new Error('ssh failed');
      error.code = 255;
      error.stderr = 'private host details';
      throw error;
    },
  });

  const result = await service.snapshot(seat);

  assert.equal(result.success, false);
  assert.equal(result.code, 'HARNESS_SSH_UNREACHABLE');
  assert.match(result.error, /nock@nock-fleet-02/);
  assert.doesNotMatch(result.error, /private host details/);
});
