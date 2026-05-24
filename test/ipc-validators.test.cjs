const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  errorPayload,
  validateDispatchBrokeredPayload,
  validateDispatchCreatePayload,
  validateFilesPayload,
  validateProfileSavePayload,
  validatePromptSavePayload,
  validateSettingsSetPayload,
  validateTerminalCreatePayload,
} = require('../electron/ipc-validators');

function makeSandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nock-terminal-ipc-'));
  test.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

const SHELL_FIXTURES = process.platform === 'win32'
  ? {
      settingsShell: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      profileShell: 'C:\\Windows\\System32\\cmd.exe',
      arbitraryShell: 'C:\\Temp\\evil.exe',
    }
  : {
      settingsShell: '/bin/bash',
      profileShell: '/bin/zsh',
      arbitraryShell: '/tmp/evil-sh',
    };

test('terminal:create rejects cwd outside allowed project roots', () => {
  const sandbox = makeSandbox();
  const allowedRoot = path.join(sandbox, 'allowed');
  const outsideRoot = path.join(sandbox, 'outside');
  fs.mkdirSync(allowedRoot, { recursive: true });
  fs.mkdirSync(outsideRoot, { recursive: true });

  const result = validateTerminalCreatePayload(
    { id: 'tab-1', cwd: outsideRoot },
    { allowedRoots: [allowedRoot], settings: {}, profile: {} }
  );

  assert.equal(result.ok, false);
  assert.match(result.error.message, /cwd/i);
});

test('terminal:create rejects renderer shell and args not backed by trusted settings or profile', () => {
  const sandbox = makeSandbox();
  const allowedRoot = path.join(sandbox, 'project');
  fs.mkdirSync(allowedRoot, { recursive: true });

  const shellResult = validateTerminalCreatePayload(
    { id: 'tab-1', cwd: allowedRoot, shell: SHELL_FIXTURES.arbitraryShell, shellArgs: '--login' },
    {
      allowedRoots: [allowedRoot],
      settings: { defaultShell: SHELL_FIXTURES.settingsShell, shellArgs: '--login' },
      profile: {},
    }
  );
  assert.equal(shellResult.ok, false);
  assert.match(shellResult.error.message, /shell/i);

  const argsResult = validateTerminalCreatePayload(
    { id: 'tab-1', cwd: allowedRoot, shell: SHELL_FIXTURES.settingsShell, shellArgs: '-c "rm -rf /"' },
    {
      allowedRoots: [allowedRoot],
      settings: { defaultShell: SHELL_FIXTURES.settingsShell, shellArgs: '--login' },
      profile: {},
    }
  );
  assert.equal(argsResult.ok, false);
  assert.match(argsResult.error.message, /shell args/i);
});

test('terminal:create accepts configured profile shell values and derives trusted defaults', () => {
  const sandbox = makeSandbox();
  const allowedRoot = path.join(sandbox, 'project');
  fs.mkdirSync(allowedRoot, { recursive: true });

  const result = validateTerminalCreatePayload(
    { id: 'tab-1', cwd: allowedRoot },
    {
      allowedRoots: [allowedRoot],
      settings: { defaultShell: SHELL_FIXTURES.settingsShell, shellArgs: '--login' },
      profile: { defaultShell: SHELL_FIXTURES.profileShell, shellArgs: '--interactive', envVars: 'NODE_ENV=test' },
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.value.shell, SHELL_FIXTURES.profileShell);
  assert.equal(result.value.shellArgs, '--interactive');
  assert.equal(result.value.envVars, 'NODE_ENV=test');
});

test('terminal:create rejects empty renderer values that would clear trusted defaults', () => {
  const sandbox = makeSandbox();
  const allowedRoot = path.join(sandbox, 'project');
  fs.mkdirSync(allowedRoot, { recursive: true });

  const argsResult = validateTerminalCreatePayload(
    { id: 'tab-1', cwd: allowedRoot, shellArgs: '' },
    {
      allowedRoots: [allowedRoot],
      settings: { defaultShell: SHELL_FIXTURES.settingsShell, shellArgs: '--login' },
      profile: {},
    }
  );
  assert.equal(argsResult.ok, false);
  assert.match(argsResult.error.message, /shell args/i);

  const envResult = validateTerminalCreatePayload(
    { id: 'tab-1', cwd: allowedRoot, envVars: '' },
    {
      allowedRoots: [allowedRoot],
      settings: { defaultShell: SHELL_FIXTURES.settingsShell },
      profile: { envVars: 'NODE_ENV=test' },
    }
  );
  assert.equal(envResult.ok, false);
  assert.match(envResult.error.message, /environment/i);
});

test('settings:set rejects unknown keys and normalizes valid settings', () => {
  assert.equal(validateSettingsSetPayload({ key: 'notASetting', value: true }).ok, false);

  const result = validateSettingsSetPayload({ key: 'windowOpacity', value: 85 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { key: 'windowOpacity', value: 85 });
});

test('profiles:save only accepts allowed project paths and known profile fields', () => {
  const sandbox = makeSandbox();
  const allowedRoot = path.join(sandbox, 'project');
  fs.mkdirSync(allowedRoot, { recursive: true });

  const result = validateProfileSavePayload(
    {
      projectPath: allowedRoot,
      profile: {
        defaultAgent: 'codex',
        codexCommand: 'codex --model gpt-5.4',
        defaultShell: SHELL_FIXTURES.profileShell,
        preferredModel: 'legacy-model',
        systemPrompt: 'legacy prompt',
        unknown: 'drop me',
      },
    },
    { isAllowedPath: (candidate) => candidate === allowedRoot }
  );

  assert.equal(result.ok, true);
  assert.equal(result.value.profile.defaultAgent, 'codex');
  assert.equal(result.value.profile.codexCommand, 'codex --model gpt-5.4');
  assert.equal(result.value.profile.preferredModel, undefined);
  assert.equal(result.value.profile.systemPrompt, undefined);
  assert.equal(result.value.profile.unknown, undefined);

  const rejected = validateProfileSavePayload(
    { projectPath: path.join(sandbox, 'outside'), profile: {} },
    { isAllowedPath: () => false }
  );
  assert.equal(rejected.ok, false);
});

test('profile and file validators resolve paths before authorization checks', () => {
  const sandbox = makeSandbox();
  const allowedRoot = path.join(sandbox, 'allowed');
  const outsideRoot = path.join(sandbox, 'outside');
  fs.mkdirSync(allowedRoot, { recursive: true });
  fs.mkdirSync(outsideRoot, { recursive: true });

  const sneakyPath = `${allowedRoot}${path.sep}..${path.sep}outside${path.sep}a.txt`;
  const isAllowedPath = (candidate) => candidate.startsWith(allowedRoot);

  assert.equal(validateFilesPayload('read', sneakyPath, { isAllowedPath }).ok, false);
  assert.equal(
    validateProfileSavePayload({ projectPath: sneakyPath, profile: {} }, { isAllowedPath }).ok,
    false
  );
});

test('prompts:save rejects malformed ids and non-string bodies', () => {
  assert.equal(validatePromptSavePayload({ id: '../escape', data: { title: 'A', body: 'B' } }).ok, false);
  assert.equal(validatePromptSavePayload({ id: 'ok', data: { title: 'A', body: {} } }).ok, false);

  const result = validatePromptSavePayload({ id: 'ok-1', data: { title: 'A', tags: ['x', ''], body: 'B' } });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.data.tags, ['x']);
});

test('dispatch:createPayload rejects malformed payloads before temp files are created', () => {
  assert.equal(validateDispatchCreatePayload({ agentName: '../ash', runtime: 'codex', taskDescription: 'Do it' }).ok, false);
  assert.equal(validateDispatchCreatePayload({ agentName: 'ash', runtime: 'node', taskDescription: 'Do it' }).ok, false);
  assert.equal(validateDispatchCreatePayload({ agentName: 'ash', runtime: 'codex', taskDescription: '' }).ok, false);

  const result = validateDispatchCreatePayload({
    agentName: 'Ash',
    runtime: 'codex',
    taskDescription: 'Do it',
    scriptPath: '/tmp/dispatch ash.sh',
    agentBound: true,
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.agentName, 'ash');
  assert.equal(result.value.agentBound, true);
});

test('dispatch:brokered rejects malformed payloads with the shared IPC error shape', () => {
  const rejected = validateDispatchBrokeredPayload({
    agentName: '../ash',
    runtime: 'codex',
    taskDescription: 'Do it',
  });

  assert.equal(rejected.ok, false);
  assert.deepEqual(errorPayload(rejected), {
    success: false,
    error: 'dispatch:brokered requires a valid agentName',
    code: 'IPC_VALIDATION_ERROR',
  });

  const accepted = validateDispatchBrokeredPayload({
    agentName: 'Ash',
    runtime: 'codex',
    taskDescription: 'Do it',
    brokerAgent: 'mira-nockos',
    priority: 'high',
  });
  assert.equal(accepted.ok, true);
  assert.deepEqual(accepted.value, {
    agentName: 'ash',
    runtime: 'codex',
    taskDescription: 'Do it',
    targetRepo: '',
    projectName: '',
    scriptPath: '',
    agentBound: false,
    brokerAgent: 'mira-nockos',
    priority: 'high',
  });
});

test('files operations reject malformed payloads with clear validation errors', () => {
  assert.equal(validateFilesPayload('read', null).ok, false);
  assert.equal(validateFilesPayload('write', { filePath: '/tmp/a.txt', content: Buffer.from('nope') }).ok, false);
  assert.equal(validateFilesPayload('gitOp', { dirPath: '/tmp/project', operation: 'reset --hard' }).ok, false);

  const result = validateFilesPayload('write', { filePath: '/tmp/a.txt', content: 'ok' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { filePath: '/tmp/a.txt', content: 'ok' });
});

test('files operations enforce allowed roots and write size limits before service calls', () => {
  const sandbox = makeSandbox();
  const allowedRoot = path.join(sandbox, 'project');
  const outsideRoot = path.join(sandbox, 'outside');
  fs.mkdirSync(allowedRoot, { recursive: true });
  fs.mkdirSync(outsideRoot, { recursive: true });

  const isAllowedPath = (candidate) => candidate.startsWith(allowedRoot);
  assert.equal(validateFilesPayload('read', path.join(outsideRoot, 'a.txt'), { isAllowedPath }).ok, false);
  assert.equal(validateFilesPayload('gitOp', { dirPath: outsideRoot, operation: 'fetch' }, { isAllowedPath }).ok, false);

  const oversized = 'x'.repeat((2 * 1024 * 1024) + 1);
  assert.equal(
    validateFilesPayload('write', { filePath: path.join(allowedRoot, 'large.txt'), content: oversized }, { isAllowedPath }).ok,
    false
  );

  const result = validateFilesPayload(
    'write',
    { filePath: path.join(allowedRoot, 'small.txt'), content: 'ok' },
    { isAllowedPath }
  );
  assert.equal(result.ok, true);
});
