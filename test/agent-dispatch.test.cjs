const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildBrokeredDispatchMessage,
  buildDirectDispatchCommand,
  createDispatchPayloadFile,
  sanitizeDispatchText,
} = require('../electron/agent-dispatch');

function assertPathInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  assert.equal(relative.startsWith('..') || path.isAbsolute(relative), false);
}

test('builds brokered dispatch messages for Mira orchestration', () => {
  const message = buildBrokeredDispatchMessage({
    agentName: 'Ash',
    runtime: 'codex',
    taskDescription: 'Audit the repo and open a PR.',
    targetRepo: '/Users/kevin/Dev/nock-terminal',
    projectName: 'nock-terminal',
    requestId: 'dispatch-123',
  });

  assert.equal(message.from_agent, 'nock-terminal');
  assert.equal(message.to_agent, 'mira-nockos');
  assert.equal(message.message_type, 'directive');
  assert.equal(message.subject, 'Nock Terminal dispatch: ash');
  assert.match(message.body, /agent_name: ash/);
  assert.match(message.body, /runtime: codex/);
  assert.match(message.body, /Audit the repo/);
  assert.deepEqual(message.context, {
    source: 'nock-terminal',
    launch_mode: 'brokered',
    dispatch_agent: 'ash',
    agent_runtime: 'codex',
    target_repo: '/Users/kevin/Dev/nock-terminal',
    project_name: 'nock-terminal',
    request_id: 'dispatch-123',
  });
});

test('quotes direct dispatch commands safely', () => {
  const command = buildDirectDispatchCommand({
    scriptPath: '/Users/kevin/Dev/claude-remote-manager/core/scripts/dispatch-codex.sh',
    agentName: 'ash',
    payloadFile: '/tmp/dispatch ash/task.txt',
  });

  assert.equal(
    command,
    "/Users/kevin/Dev/claude-remote-manager/core/scripts/dispatch-codex.sh --agent ash --payload-file '/tmp/dispatch ash/task.txt'"
  );
});

test('creates payload files with sanitized task text', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nock-dispatch-test-'));
  const result = await createDispatchPayloadFile({
    agentName: 'smith',
    runtime: 'deepseek',
    taskDescription: 'Fix this\u0007\nthen test it.',
    targetRepo: '/tmp/repo',
    requestId: 'request-1',
  }, { tmpDir });

  assertPathInside(tmpDir, result.filePath);
  assert.equal(path.basename(result.filePath), 'smith-request-1.txt');
  assert.equal(result.command, '');
  const content = fs.readFileSync(result.filePath, 'utf8');
  assert.match(content, /Fix this\nthen test it\./);
  assert.equal(content.includes('\u0007'), false);
});

test('does not use unsafe request ids as payload filenames', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nock-dispatch-test-'));
  const result = await createDispatchPayloadFile({
    agentName: 'smith',
    runtime: 'deepseek',
    taskDescription: 'Run verification.',
    requestId: '../escape',
  }, { tmpDir });

  assertPathInside(tmpDir, result.filePath);
  assert.equal(path.basename(result.filePath).startsWith('smith-..'), false);
});

test('cleans up payload files after the configured TTL', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nock-dispatch-test-'));
  const result = await createDispatchPayloadFile({
    agentName: 'ash',
    runtime: 'codex',
    taskDescription: 'Clean up after this dispatch.',
    requestId: 'cleanup-1',
  }, { tmpDir, cleanupAfterMs: 5 });

  assert.equal(fs.existsSync(result.filePath), true);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(fs.existsSync(result.filePath), false);
});

test('sanitizes dispatch text while preserving useful newlines', () => {
  assert.equal(sanitizeDispatchText(' one\u0000\n\ttwo '), 'one\n\ttwo');
});
