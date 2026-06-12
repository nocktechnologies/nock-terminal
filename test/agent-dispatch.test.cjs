const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  AgentDispatchService,
  buildBrokeredDispatchMessage,
  buildDirectDispatchCommand,
  createDispatchPayloadFile,
  sanitizeDispatchText,
} = require('../electron/agent-dispatch');

async function withHttpServer(handler, callback) {
  const http = require('http');
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  try {
    return await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

function assertPathInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  assert.equal(relative.startsWith('..') || path.isAbsolute(relative), false);
}

async function waitForPathToDisappear(filePath, timeoutMs = 500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!fs.existsSync(filePath)) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(fs.existsSync(filePath), false);
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

test('builds agent-bound direct dispatch commands for per-agent aliases', () => {
  const command = buildDirectDispatchCommand({
    scriptPath: '/Users/kevin/Dev/claude-remote-manager/agents/ash/scripts/dispatch-ash.sh',
    agentName: 'ash',
    payloadFile: '/tmp/dispatch ash/task.txt',
    agentBound: true,
  });

  assert.equal(
    command,
    "/Users/kevin/Dev/claude-remote-manager/agents/ash/scripts/dispatch-ash.sh --payload-file '/tmp/dispatch ash/task.txt'"
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

test('creates payload files with agent-bound alias commands', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nock-dispatch-test-'));
  const result = await createDispatchPayloadFile({
    agentName: 'ash',
    runtime: 'codex',
    taskDescription: 'Check alias launch.',
    requestId: 'request-2',
    scriptPath: '/Users/kevin/Dev/claude-remote-manager/agents/ash/scripts/dispatch-ash.sh',
    agentBound: true,
  }, { tmpDir });

  assertPathInside(tmpDir, result.filePath);
  assert.match(result.command, /dispatch-ash\.sh --payload-file/);
  assert.doesNotMatch(result.command, /--agent ash/);
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
  await waitForPathToDisappear(result.filePath);
});

test('sweeps stale payload directories before creating a new payload', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nock-dispatch-test-'));
  const staleDir = path.join(tmpDir, 'nock-dispatch-stale');
  const freshDir = path.join(tmpDir, 'nock-dispatch-fresh');
  fs.mkdirSync(staleDir);
  fs.mkdirSync(freshDir);
  fs.writeFileSync(path.join(staleDir, 'payload.txt'), 'old');
  fs.writeFileSync(path.join(freshDir, 'payload.txt'), 'new');
  const staleTime = new Date(Date.now() - (25 * 60 * 60 * 1000));
  fs.utimesSync(staleDir, staleTime, staleTime);

  const result = await createDispatchPayloadFile({
    agentName: 'ash',
    runtime: 'codex',
    taskDescription: 'Create after startup cleanup.',
    requestId: 'cleanup-2',
  }, { tmpDir });

  assert.equal(fs.existsSync(staleDir), false);
  assert.equal(fs.existsSync(freshDir), true);
  assert.equal(fs.existsSync(result.filePath), true);
});

test('brokered dispatch rejects oversized NockCC responses', async () => {
  await withHttpServer((req, res) => {
    req.resume();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('x'.repeat((1024 * 1024) + 1));
  }, async (baseUrl) => {
    const service = new AgentDispatchService({
      get(key) {
        return key === 'nockccApiKey' ? 'test-key' : baseUrl;
      },
    });

    await assert.rejects(
      service.sendBrokered({
        agentName: 'ash',
        runtime: 'codex',
        taskDescription: 'This response should be capped.',
        requestId: 'oversized-1',
      }),
      /NockCC response exceeded 1 MB/
    );
  });
});

test('sanitizes dispatch text while preserving useful newlines', () => {
  assert.equal(sanitizeDispatchText(' one\u0000\n\ttwo '), 'one\n\ttwo');
});
