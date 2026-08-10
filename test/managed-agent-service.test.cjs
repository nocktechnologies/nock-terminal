'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const { ManagedAgentService } = require('../electron/managed-agent-service');

const MODEL = 'claude-opus-4-8[1m]';

function makeHarness({ runCommand, net, probes } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nock-managed-agent-'));
  const engineRoot = path.join(root, 'engine');
  fs.mkdirSync(path.join(engineRoot, 'runtime'), { recursive: true });
  fs.mkdirSync(path.join(engineRoot, 'seats'), { recursive: true });
  fs.writeFileSync(path.join(engineRoot, 'runtime', 'seat.py'), '# runtime');
  fs.writeFileSync(path.join(engineRoot, 'seats', 'manifest.schema.json'), '{}');

  const service = new ManagedAgentService({
    homeDir: root,
    agentsRoot: path.join(root, '.nock', 'agents'),
    runRoot: path.join(root, '.nock', 'run'),
    launchAgentsRoot: path.join(root, 'Library', 'LaunchAgents'),
    engineRoot,
    runtimePython: '/usr/bin/true',
    tmuxPath: '/usr/bin/true',
    claudePath: '/usr/bin/true',
    launchctlPath: '/usr/bin/false',
    platform: 'darwin',
    supportedModels: [MODEL],
    probes: {
      runtimePython: () => ({ available: true, version: '3.12.1', jsonschema: true, error: '' }),
      tmux: () => ({ available: true, version: '3.4', error: '' }),
      claude: () => ({ available: true, version: '2.1.226', error: '' }),
      ...probes,
    },
    ...(runCommand ? { runCommand } : {}),
    ...(net ? { net } : {}),
    randomUUID: () => '11111111-1111-4111-8111-111111111111',
  });

  test.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, service };
}

function draft(overrides = {}) {
  return {
    agentId: 'alpha',
    displayName: 'Alpha Resident',
    model: MODEL,
    permissionPreset: 'standard',
    allowedRoots: ['/tmp/project'],
    deniedRoots: ['/tmp/blocked'],
    identity: {
      agent: 'Alpha Resident',
      role: 'Coding resident',
      partner: 'Kevin',
      authority: 'Work within the configured workspace roots.',
    },
    ...overrides,
  };
}

test('create validates absolute roots, provisions a private seat transactionally, and compiles permissions', async () => {
  const { root, service } = makeHarness();
  await assert.rejects(service.create(draft({ allowedRoots: ['relative/project'] })), /absolute/);

  const row = await service.create(draft({ workDirectory: '' }));
  assert.equal(row.id, 'managed:alpha');
  assert.equal(row.agentId, 'alpha');
  assert.equal(row.kind, 'agent');
  assert.equal(row.managed, true);
  assert.equal(row.agent.permissions.defaultMode, 'acceptEdits');
  assert.equal(row.launch.terminalMode, 'tmux');
  assert.deepEqual(row.launch.argv.slice(-8), [
    'set-option', '-g', 'mouse', 'on', ';', 'attach', '-t', '=nock-resident-alpha',
  ]);

  const residence = path.join(root, '.nock', 'agents', 'alpha');
  const manifest = JSON.parse(fs.readFileSync(path.join(residence, 'seat.json'), 'utf8'));
  const metadata = JSON.parse(fs.readFileSync(path.join(residence, 'nock-agent.json'), 'utf8'));
  const settings = JSON.parse(fs.readFileSync(path.join(residence, 'config', 'claude', 'settings.json'), 'utf8'));
  const source = fs.readFileSync(path.join(residence, 'identity', 'agent.md'), 'utf8');
  const plist = fs.readFileSync(path.join(root, 'Library', 'LaunchAgents', 'io.nock.terminal.resident.alpha.plist'), 'utf8');

  assert.equal(manifest.channels.console.protocol_hash, ManagedAgentService.CONSOLE_PROTOCOL_HASH);
  assert.equal(manifest.work_dir, residence);
  assert.deepEqual(manifest.workspaces, { allowed_roots: [residence, '/tmp/project'], denied_roots: ['/tmp/blocked'] });
  assert.equal(manifest.runtime.auth_identity, 'authfp:00000000000000000000000000000000');
  assert.equal(settings.permissions.defaultMode, 'acceptEdits');
  assert.ok(Buffer.byteLength(source, 'utf8') >= 256);
  assert.ok(Buffer.byteLength(source, 'utf8') <= 8192);
  const wrapper = fs.readFileSync(path.join(residence, 'bin', 'run-resident.sh'), 'utf8');
  assert.match(wrapper, /if cd .*; then/);
  assert.match(wrapper, /3\|78\) exit 0/);
  assert.match(plist, /<key>SuccessfulExit<\/key><false\/>/);
  assert.match(plist, /<key>ProgramArguments<\/key><array><string>.*run-resident\.sh<\/string><\/array>/);
  assert.equal(metadata.createdAt, row.metadata.createdAt);
  await assert.rejects(service.create(draft()), /already exists/);
});

test('create removes every staged artifact when engine preflight fails', async () => {
  const { root, service } = makeHarness({
    runCommand(_file, args) {
      if (args.includes('--check')) return { status: 78, stdout: '', stderr: 'manifest invalid' };
      return { status: 0, stdout: '', stderr: '' };
    },
  });

  await assert.rejects(service.create(draft()), /preflight failed/);
  assert.equal(fs.existsSync(path.join(root, '.nock', 'agents', 'alpha')), false);
  assert.equal(fs.existsSync(path.join(root, '.nock', 'run', 'alpha')), false);
  assert.equal(fs.existsSync(path.join(root, 'Library', 'LaunchAgents', 'io.nock.terminal.resident.alpha.plist')), false);
});

test('auth fingerprinting and validation expose no email or credential-shaped data', async () => {
  let authStatusCalls = 0;
  const { root, service } = makeHarness({
    runCommand(file, args, options) {
      if (args.join(' ') === 'auth status --json') {
        authStatusCalls += 1;
        assert.equal(file, '/usr/bin/true');
        assert.equal(options.env.CLAUDE_CONFIG_DIR, path.join(root, '.nock', 'agents', 'alpha', 'config', 'claude'));
        return {
          status: 0,
          stdout: JSON.stringify({
            loggedIn: true,
            authMethod: 'claude.ai',
            apiProvider: 'first-party',
            orgId: 'org-123',
            subscriptionType: 'max',
            email: 'secret@example.com',
            token: 'never-return-this',
          }),
          stderr: '',
        };
      }
      return { status: 0, stdout: 'Python 3.12.1', stderr: '' };
    },
  });
  await service.create(draft());
  const expected = ManagedAgentService.authFingerprint({
    authMethod: 'claude.ai',
    apiProvider: 'first-party',
    orgId: 'org-123',
    subscriptionType: 'max',
  });
  assert.throws(
    () => ManagedAgentService.sanitizeAuthStatus({ loggedIn: true, email: 'secret@example.com', token: 'secret' }),
    error => error.code === 'AUTH_STATUS_INVALID',
  );
  const sanitized = ManagedAgentService.sanitizeAuthStatus({
    loggedIn: true,
    authMethod: 'claude.ai',
    apiProvider: 'first-party',
    subscriptionType: 'max',
    email: 'secret@example.com',
    token: 'secret',
  });
  assert.equal(sanitized.authIdentity, ManagedAgentService.authFingerprint({
    authMethod: 'claude.ai',
    apiProvider: 'first-party',
    subscriptionType: 'max',
  }));
  assert.doesNotMatch(JSON.stringify(sanitized), /secret|email|token/i);

  const result = await service.validate('alpha');
  assert.equal(authStatusCalls, 1);
  assert.equal(result.authIdentity, expected);
  assert.doesNotMatch(JSON.stringify(result), /secret@example\.com|never-return-this/);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, '.nock', 'agents', 'alpha', 'seat.json'), 'utf8'));
  assert.equal(manifest.runtime.auth_identity, expected);
});

test('manifest executable pins reject runtime substitution before resident control', async () => {
  const { root, service } = makeHarness();
  await service.create(draft());
  const manifestPath = path.join(root, '.nock', 'agents', 'alpha', 'seat.json');
  const original = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  const cases = [
    {
      mutate: manifest => { manifest.runtime.binary = '/bin/sh'; },
      expected: /probed Claude runtime/,
    },
    {
      mutate: manifest => { manifest.capsule_command[0] = '/bin/sh'; },
      expected: /probed Python runtime/,
    },
  ];
  for (const item of cases) {
    const tampered = structuredClone(original);
    item.mutate(tampered);
    fs.writeFileSync(manifestPath, `${JSON.stringify(tampered, null, 2)}\n`);
    await assert.rejects(
      service.control('alpha', 'restart'),
      error => error.code === 'INVALID_SEAT' && item.expected.test(error.message),
    );
  }
});

test('stop remains available when resident configuration cannot be loaded', async () => {
  const launchctlCalls = [];
  const { root, service } = makeHarness({
    runCommand(file, args) {
      if (file === '/usr/bin/false') {
        launchctlCalls.push(args);
        return { status: 0, stdout: '', stderr: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    },
  });
  await assert.rejects(
    service.supervise('alpha', 'stop'),
    error => error.code === 'INVALID_SEAT',
  );
  assert.deepEqual(launchctlCalls, []);

  await service.create(draft());
  const manifestPath = path.join(root, '.nock', 'agents', 'alpha', 'seat.json');
  fs.rmSync(manifestPath);

  const result = await service.supervise('alpha', 'stop');

  assert.deepEqual(result, {
    success: true,
    agentId: 'alpha',
    status: 'stopped',
    configurationValid: false,
  });
  assert.ok(launchctlCalls.some(args => args[0] === 'bootout'));
});

test('managed inventory reuses the coalesced executable probe snapshot', async () => {
  const calls = { runtimePython: 0, tmux: 0, claude: 0 };
  const { service } = makeHarness({
    probes: {
      runtimePython: () => {
        calls.runtimePython += 1;
        return { available: true, version: '3.12.1', jsonschema: true, error: '' };
      },
      tmux: () => {
        calls.tmux += 1;
        return { available: true, version: '3.4', error: '' };
      },
      claude: () => {
        calls.claude += 1;
        return { available: true, version: '2.1.226', error: '' };
      },
    },
  });

  await service.create(draft());
  await service.list();
  await service.list();

  assert.deepEqual(calls, { runtimePython: 1, tmux: 1, claude: 1 });
});

test('control uses the manifest socket, bounded NDJSON, and a stable UUID mutation id', async () => {
  const writes = [];
  class FakeSocket extends EventEmitter {
    setTimeout() {}
    write(payload) {
      writes.push(payload);
      const request = JSON.parse(payload);
      process.nextTick(() => this.emit('data', Buffer.from(JSON.stringify({
        id: request.id,
        ok: true,
        result: { restarted: true },
      }) + '\n')));
    }
    destroy() {}
  }
  const sockets = [];
  const { root, service } = makeHarness({
    net: {
      createConnection(options) {
        const socket = new FakeSocket();
        sockets.push({ options, socket });
        process.nextTick(() => socket.emit('connect'));
        return socket;
      },
    },
  });
  await service.create(draft());
  const result = await service.control('alpha', 'restart');
  const request = JSON.parse(writes[0]);
  assert.equal(result.success, true);
  assert.equal(result.requestId, '11111111-1111-4111-8111-111111111111');
  assert.equal(request.id, result.requestId);
  assert.equal(request.action, 'restart');
  assert.deepEqual(request.params, {});
  assert.equal(sockets[0].options.path, path.join(root, '.nock', 'run', 'alpha', 'control.sock'));
  assert.match(writes[0], /\n$/);
});

test('update preserves the residence, creation metadata, and auth fingerprint while regenerating the blueprint', async () => {
  const { root, service } = makeHarness({
    net: { createConnection() { throw new Error('no live control socket'); } },
    runCommand(file, args) {
      if (file === '/usr/bin/false' && args[0] === 'print') {
        return { status: 1, stdout: '', stderr: 'not loaded' };
      }
      if (args.join(' ') === 'auth status --json') {
        return { status: 0, stdout: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'first-party', orgId: 'org', subscriptionType: 'max' }), stderr: '' };
      }
      return { status: 0, stdout: 'Python 3.12.1', stderr: '' };
    },
  });
  await service.create(draft());
  await service.validate('alpha');
  const beforeMetadata = JSON.parse(fs.readFileSync(path.join(root, '.nock', 'agents', 'alpha', 'nock-agent.json'), 'utf8'));
  const beforeManifest = JSON.parse(fs.readFileSync(path.join(root, '.nock', 'agents', 'alpha', 'seat.json'), 'utf8'));

  const row = await service.update('alpha', draft({
    displayName: 'Alpha Updated',
    role: 'Lead resident',
    permissionPreset: 'autonomous',
    allowedRoots: ['/tmp/updated-project'],
    deniedRoots: [],
  }));
  const afterMetadata = JSON.parse(fs.readFileSync(path.join(root, '.nock', 'agents', 'alpha', 'nock-agent.json'), 'utf8'));
  const afterManifest = JSON.parse(fs.readFileSync(path.join(root, '.nock', 'agents', 'alpha', 'seat.json'), 'utf8'));
  const settings = JSON.parse(fs.readFileSync(path.join(root, '.nock', 'agents', 'alpha', 'config', 'claude', 'settings.json'), 'utf8'));

  assert.equal(row.name, 'Alpha Updated');
  assert.equal(afterMetadata.createdAt, beforeMetadata.createdAt);
  assert.equal(afterMetadata.creation.source, beforeMetadata.creation.source);
  assert.equal(afterMetadata.identity.role, 'Lead resident');
  assert.equal(afterManifest.home, beforeManifest.home);
  assert.equal(afterManifest.agent, 'alpha');
  assert.equal(afterManifest.runtime.auth_identity, beforeManifest.runtime.auth_identity);
  assert.deepEqual(afterManifest.workspaces, { allowed_roots: [afterManifest.home, '/tmp/updated-project'], denied_roots: [] });
  assert.equal(settings.permissions.defaultMode, 'bypassPermissions');
});

test('inventory surfaces terminal/config supervisor exits as operator-action states', async () => {
  const { root, service } = makeHarness();
  await service.create(draft());
  const residence = path.join(root, '.nock', 'agents', 'alpha');
  fs.writeFileSync(
    path.join(residence, 'state', 'nock-supervisor.json'),
    `${JSON.stringify({ exitCode: 3, recordedAt: '2026-08-08T00:00:00Z' })}\n`,
  );

  const [row] = await service.list();
  assert.equal(row.status, 'terminal_failed');
  assert.equal(row.capabilities.stop, true);
  assert.match(row.failureReason, /residentd\.err\.log/);
});
