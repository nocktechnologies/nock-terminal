const test = require('node:test');
const assert = require('node:assert/strict');

const {
  HarnessSeatService,
  buildHarnessControlDescriptor,
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
__NOCK_CONTROL__
{"schemaVersion":1,"ok":true,"action":"status","message":"Operator control state is current.","state":{"seatState":"working:message","paused":false,"turn":{"active":true,"id":"turn-123","batch":886,"class":"message","steerable":true},"queueCounts":{"working":1},"capabilities":{"pause":true,"resume":false,"cancelTurn":true,"queueRetry":true,"queueAcknowledge":true},"pulse":{"schemaVersion":1,"updatedAt":1785618000.25,"disposition":"working","reason":{"code":"TURN_ACTIVE","summary":"Advance the operator console"},"objective":"Make Mira visibly own and advance durable work.","currentAction":{"id":"wake:886","source":"telegram","title":"Advance the operator console","startedAt":1785617900},"nextAction":{"id":"plan:step:4","source":"active_plan","title":"Verify the live Agent Pulse","status":"current"},"initiative":{"state":"working","reasonCode":"TURN_ACTIVE","attentionRequired":false,"wakeId":886,"nextJudgmentAt":1785625200},"lastOutcome":{"verified":true,"observedAt":1785617600,"snapshotId":"drive:892","transition":"ACTED","selectedCandidate":{"id":"nock:9","title":"Agent Pulse"},"summary":"Implemented the authoritative pulse contract.","evidence":["tests/test_agent_pulse.py"]}}}}
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
    control: {
      available: true,
      seatState: 'working:message',
      paused: false,
      turn: {
        active: true,
        id: 'turn-123',
        batch: 886,
        class: 'message',
        steerable: true,
      },
      capabilities: {
        pause: true,
        resume: false,
        cancelTurn: true,
        queueRetry: true,
        queueAcknowledge: true,
      },
      pulse: {
        schemaVersion: 1,
        updatedAt: 1785618000.25,
        disposition: 'working',
        reason: { code: 'TURN_ACTIVE', summary: 'Advance the operator console' },
        objective: 'Make Mira visibly own and advance durable work.',
        currentAction: {
          id: 'wake:886',
          source: 'telegram',
          title: 'Advance the operator console',
          startedAt: 1785617900,
        },
        nextAction: {
          id: 'plan:step:4',
          source: 'active_plan',
          title: 'Verify the live Agent Pulse',
          status: 'current',
        },
        initiative: {
          state: 'working',
          reasonCode: 'TURN_ACTIVE',
          attentionRequired: false,
          wakeId: 886,
          nextJudgmentAt: 1785625200,
        },
        lastOutcome: {
          verified: true,
          observedAt: 1785617600,
          snapshotId: 'drive:892',
          transition: 'ACTED',
          selectedCandidate: { id: 'nock:9', title: 'Agent Pulse' },
          summary: 'Implemented the authoritative pulse contract.',
          evidence: ['tests/test_agent_pulse.py'],
        },
      },
    },
    manifest: {
      runtime: 'claude',
      model: 'claude-opus-4-8[1m]',
      home: '/home/nock/Dev/mira-home',
      workDir: '/home/nock/Dev/mira-home',
      turnBudget: { enabled: true, hardSeconds: 1200 },
    },
  });
});

test('rejects an unversioned pulse and bounds every published pulse field', () => {
  const longText = 'x'.repeat(2400);
  const output = snapshotOutput.replace(
    /"pulse":\{.*\}\}\}\n__NOCK_MANIFEST__/,
    `"pulse":{"schemaVersion":1,"updatedAt":12,"disposition":"blocked","reason":{"code":"PLAN_BLOCKED","summary":"${longText}"},"objective":"${longText}","currentAction":null,"nextAction":{"id":"plan:step:1","source":"active_plan","title":"${longText}","status":"blocked"},"initiative":{"state":"blocked","reasonCode":"PLAN_BLOCKED","attentionRequired":true,"wakeId":null,"nextJudgmentAt":null},"lastOutcome":{"verified":false,"observedAt":10,"snapshotId":"drive:1","transition":"GATED","selectedCandidate":null,"summary":"${longText}","evidence":["${longText}","second"]}}}}\n__NOCK_MANIFEST__`
  );

  const pulse = parseHarnessSnapshot(output, seat).control.pulse;
  assert.equal(pulse.objective.length, 500);
  assert.equal(pulse.reason.summary.length, 1500);
  assert.equal(pulse.nextAction.title.length, 500);
  assert.equal(pulse.lastOutcome.summary.length, 1500);
  assert.equal(pulse.lastOutcome.evidence[0].length, 500);

  const legacy = snapshotOutput.replace('"schemaVersion":1,"updatedAt":1785618000.25', '"schemaVersion":2,"updatedAt":1785618000.25');
  assert.equal(parseHarnessSnapshot(legacy, seat).control.pulse, null);

  const impossibleTime = snapshotOutput.replace('"updatedAt":1785618000.25', '"updatedAt":1e300');
  assert.equal(parseHarnessSnapshot(impossibleTime, seat).control.pulse.updatedAt, null);

  const unknownInitiative = snapshotOutput.replace('"initiative":{"state":"working"', '"initiative":{"state":"plotting"');
  assert.equal(parseHarnessSnapshot(unknownInitiative, seat).control.pulse, null);
});

test('builds quoted console, watch, and shell launches only from normalized seats', () => {
  const consoleLaunch = buildHarnessLaunchDescriptor(seat, 'console');
  const watchLaunch = buildHarnessLaunchDescriptor(seat, 'watch');
  const shellLaunch = buildHarnessLaunchDescriptor(seat, 'shell');

  assert.equal(consoleLaunch.success, true);
  assert.match(consoleLaunch.command, /^ssh -t /);
  assert.match(consoleLaunch.command, /scripts\/console/);
  assert.match(watchLaunch.command, /scripts\/watch/);
  assert.match(shellLaunch.command, /exec \$\{SHELL:-\/bin\/bash\} -l/);
  assert.equal(buildHarnessLaunchDescriptor({ ...seat, host: 'bad;host' }, 'console').success, false);
  assert.equal(buildHarnessLaunchDescriptor(seat, 'restart').success, false);
});

test('quotes harness launch commands for the configured local PTY shell', () => {
  const posix = buildHarnessLaunchDescriptor(seat, 'console', { shell: '/bin/zsh' });
  const powershell = buildHarnessLaunchDescriptor(seat, 'console', { shell: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe' });
  const commandPrompt = buildHarnessLaunchDescriptor(seat, 'console', { shell: 'C:\\Windows\\System32\\cmd.exe' });
  const windowsDefault = buildHarnessLaunchDescriptor(seat, 'console', { platform: 'win32' });

  assert.match(posix.command, /'nock@nock-fleet-02'/);
  assert.match(powershell.command, /'nock@nock-fleet-02'/);
  assert.match(powershell.command, /''\/home\/nock\/Dev\/nock-agent-harness''/);
  assert.match(commandPrompt.command, /"nock@nock-fleet-02"/);
  assert.match(commandPrompt.command, /"cd -- '\/home\/nock\/Dev\/nock-agent-harness'/);
  assert.match(windowsDefault.command, /"nock@nock-fleet-02"/);
});

test('builds only allowlisted typed control commands with quoted review notes', () => {
  const pause = buildHarnessControlDescriptor(seat, 'pause');
  const retry = buildHarnessControlDescriptor(seat, 'queue-retry', { wakeId: 91 });
  const acknowledge = buildHarnessControlDescriptor(seat, 'queue-acknowledge', {
    wakeId: 92,
    note: "Reviewed Kevin's failure; safe to clear.",
  });

  assert.equal(pause.success, true);
  assert.match(pause.remoteCommand, /\.\/scripts\/control 'mira' 'pause'/);
  assert.match(retry.remoteCommand, /--wake-id '91'/);
  assert.match(acknowledge.remoteCommand, /Reviewed Kevin'"'"'s failure/);
  assert.match(acknowledge.remoteCommand, /--operator 'nock-terminal'/);
  assert.equal(buildHarnessControlDescriptor(seat, 'restart-daemon').success, false);
  assert.equal(buildHarnessControlDescriptor(seat, 'pause', null).success, false);
  assert.equal(buildHarnessControlDescriptor(seat, 'queue-retry', { wakeId: -4 }).success, false);
  assert.equal(buildHarnessControlDescriptor(seat, 'queue-acknowledge', { wakeId: 4, note: 'short' }).success, false);
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
  assert.match(calls[0].args[10], /cd -- '\/home\/nock\/Dev\/nock-agent-harness'/);
  assert.match(calls[0].args[10], /\.\/scripts\/status 'mira'/);
  assert.match(calls[0].args[10], /\.\/scripts\/control 'mira' 'status'/);
  assert.match(calls[0].args[10], /cat -- 'seats\/mira\.json'/);
  assert.equal(calls[0].options.timeout, 8000);
});

test('executes a typed control over bounded non-interactive SSH', async () => {
  const calls = [];
  const service = new HarnessSeatService({
    runSsh: async (args, options) => {
      calls.push({ args, options });
      return {
        stdout: '{"schemaVersion":1,"ok":true,"action":"pause","message":"paused","state":{"paused":true}}\n',
        stderr: '',
      };
    },
  });

  const result = await service.control(seat, 'pause');

  assert.equal(result.success, true);
  assert.equal(result.control.state.paused, true);
  assert.equal(calls[0].args[9], 'nock@nock-fleet-02');
  assert.match(calls[0].args[10], /\.\/scripts\/control 'mira' 'pause'/);
  assert.equal(calls[0].options.timeout, 8000);
});

test('returns typed daemon refusals without exposing remote output', async () => {
  const service = new HarnessSeatService({
    runSsh: async () => ({
      stdout: '{"schemaVersion":1,"ok":false,"action":"cancel-turn","code":"NO_ACTIVE_TURN","message":"There is no active turn to stop."}\n',
      stderr: 'private remote detail',
    }),
  });

  const result = await service.control(seat, 'cancel-turn');

  assert.equal(result.success, false);
  assert.equal(result.code, 'NO_ACTIVE_TURN');
  assert.equal(result.error, 'There is no active turn to stop.');
  assert.doesNotMatch(JSON.stringify(result), /private remote detail/);
});

test('reports an unavailable typed-control protocol for unparseable output', async () => {
  const service = new HarnessSeatService({
    runSsh: async () => ({ stdout: 'legacy harness output\n', stderr: '' }),
  });

  const result = await service.control(seat, 'pause');

  assert.equal(result.success, false);
  assert.equal(result.code, 'HARNESS_CONTROL_UNAVAILABLE');
});

test('reports an unconfirmed control when bounded SSH times out', async () => {
  const service = new HarnessSeatService({
    runSsh: async () => {
      const error = new Error('timeout');
      error.killed = true;
      throw error;
    },
  });

  const result = await service.control(seat, 'pause');

  assert.equal(result.success, false);
  assert.equal(result.code, 'HARNESS_SSH_TIMEOUT');
});

test('returns a timeout result when SSH is killed by the deadline', async () => {
  const service = new HarnessSeatService({
    runSsh: async () => {
      const error = new Error('timeout');
      error.killed = true;
      error.signal = 'SIGTERM';
      throw error;
    },
  });

  const result = await service.snapshot(seat);

  assert.equal(result.success, false);
  assert.equal(result.code, 'HARNESS_SSH_TIMEOUT');
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
