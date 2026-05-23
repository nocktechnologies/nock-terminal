const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
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

  const arbitraryShell = process.platform === 'win32' ? 'C:\\Temp\\evil.exe' : '/tmp/evil-sh';
  const shellResult = validateTerminalCreatePayload(
    { id: 'tab-1', cwd: allowedRoot, shell: arbitraryShell, shellArgs: '--login' },
    {
      allowedRoots: [allowedRoot],
      settings: { defaultShell: '/bin/zsh', shellArgs: '--login' },
      profile: {},
    }
  );
  assert.equal(shellResult.ok, false);
  assert.match(shellResult.error.message, /shell/i);

  const argsResult = validateTerminalCreatePayload(
    { id: 'tab-1', cwd: allowedRoot, shell: '/bin/zsh', shellArgs: '-c "rm -rf /"' },
    {
      allowedRoots: [allowedRoot],
      settings: { defaultShell: '/bin/zsh', shellArgs: '--login' },
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
      settings: { defaultShell: '/bin/bash', shellArgs: '--login' },
      profile: { defaultShell: '/bin/zsh', shellArgs: '--interactive', envVars: 'NODE_ENV=test' },
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.value.shell, '/bin/zsh');
  assert.equal(result.value.shellArgs, '--interactive');
  assert.equal(result.value.envVars, 'NODE_ENV=test');
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
        defaultShell: '/bin/zsh',
        unknown: 'drop me',
      },
    },
    { isAllowedPath: (candidate) => candidate === allowedRoot }
  );

  assert.equal(result.ok, true);
  assert.equal(result.value.profile.defaultAgent, 'codex');
  assert.equal(result.value.profile.codexCommand, 'codex --model gpt-5.4');
  assert.equal(result.value.profile.unknown, undefined);

  const rejected = validateProfileSavePayload(
    { projectPath: path.join(sandbox, 'outside'), profile: {} },
    { isAllowedPath: () => false }
  );
  assert.equal(rejected.ok, false);
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

test('files operations reject malformed payloads with clear validation errors', () => {
  assert.equal(validateFilesPayload('read', null).ok, false);
  assert.equal(validateFilesPayload('write', { filePath: '/tmp/a.txt', content: Buffer.from('nope') }).ok, false);
  assert.equal(validateFilesPayload('gitOp', { dirPath: '/tmp/project', operation: 'reset --hard' }).ok, false);

  const result = validateFilesPayload('write', { filePath: '/tmp/a.txt', content: 'ok' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { filePath: '/tmp/a.txt', content: 'ok' });
});
