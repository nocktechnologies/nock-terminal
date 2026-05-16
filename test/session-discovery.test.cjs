const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SessionDiscovery = require('../electron/session-discovery');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nock-session-discovery-'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function writeFile(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value);
}

test('discovers agent folders from existing config.json files', async () => {
  const root = makeTempDir();
  const devRoot = path.join(root, 'Dev');
  const agentPath = path.join(devRoot, 'claude-remote-manager', 'agents', 'mira');
  const fileBusRoot = path.join(root, '.claude-remote', 'default');
  const heartbeat = Math.floor(Date.now() / 1000);

  writeJson(path.join(agentPath, 'config.json'), {
    agent_name: 'mira',
    enabled: true,
    model: 'claude-opus-4-6',
    passive_frozen_threshold: 1200,
    crons: [{ name: 'heartbeat', interval: '5m', prompt: 'Check inbox' }],
  });
  writeFile(path.join(fileBusRoot, 'state', 'mira.fc-heartbeat'), String(heartbeat));
  writeJson(path.join(fileBusRoot, 'state', 'mira.stats.json'), {
    checked: new Date().toISOString(),
    agent: 'idle',
  });
  writeFile(path.join(fileBusRoot, 'inbox', 'mira', '2-123-from-codex-test.json'), '{}\n');

  const discovery = new SessionDiscovery({
    claudeDir: path.join(root, '.claude'),
    devRoots: [devRoot],
    fileBusRoot,
  });

  const sessions = await discovery.discover();
  const mira = sessions.find(session => session.kind === 'agent' && session.agent?.name === 'mira');

  assert.ok(mira);
  assert.equal(mira.name, 'Mira');
  assert.equal(mira.path, agentPath);
  assert.equal(mira.status, 'active');
  assert.equal(mira.agent.enabled, true);
  assert.equal(mira.agent.lifecycle, 'idle');
  assert.equal(mira.agent.model, 'claude-opus-4-6');
  assert.equal(mira.agent.unreadCount, 1);
  assert.equal(mira.launch.command, 'mira');
  assert.equal(mira.launch.cwd, agentPath);
});

test('upgrades Claude transcript paths to agent folders even without dev roots', async () => {
  const root = makeTempDir();
  const claudeDir = path.join(root, '.claude');
  const agentPath = path.join(root, 'Dev', 'claude-remote-manager', 'agents', 'mira');
  const claudeProjectPath = path.join(claudeDir, 'projects', 'transcript-for-mira');
  const fileBusRoot = path.join(root, '.claude-remote', 'default');

  writeJson(path.join(agentPath, 'config.json'), {
    agent_name: 'mira',
    enabled: true,
    model: 'claude-opus-4-6',
  });
  writeFile(
    path.join(claudeProjectPath, 'session.jsonl'),
    `${JSON.stringify({ type: 'user', cwd: agentPath, message: { role: 'user', content: [] } })}\n`
  );

  const discovery = new SessionDiscovery({
    claudeDir,
    devRoots: [],
    fileBusRoot,
  });

  const sessions = await discovery.discover();
  const mira = sessions.find(session => session.path === agentPath);

  assert.ok(mira);
  assert.equal(mira.kind, 'agent');
  assert.equal(mira.id, `agent:${agentPath}`);
  assert.equal(mira.name, 'Mira');
  assert.equal(mira.claudeSessionId, 'transcript-for-mira');
  assert.equal(mira.launch.command, 'mira');
  assert.equal(mira.launch.cwd, agentPath);
});

test('marks disabled agent folders as inactive without launch defaults', async () => {
  const root = makeTempDir();
  const devRoot = path.join(root, 'Dev');
  const agentPath = path.join(devRoot, 'claude-remote-manager', 'agents', 'warden');
  const fileBusRoot = path.join(root, '.claude-remote', 'default');

  writeJson(path.join(agentPath, 'config.json'), {
    agent_name: 'warden',
    enabled: false,
    model: 'codex',
  });

  const discovery = new SessionDiscovery({
    claudeDir: path.join(root, '.claude'),
    devRoots: [devRoot],
    fileBusRoot,
  });

  const sessions = await discovery.discover();
  const warden = sessions.find(session => session.kind === 'agent' && session.agent?.name === 'warden');

  assert.ok(warden);
  assert.equal(warden.status, 'inactive');
  assert.equal(warden.agent.enabled, false);
  assert.equal(warden.agent.lifecycle, 'disabled');
  assert.equal(warden.launch.command, '');
});

test('ignores malformed agent configs instead of failing discovery', async () => {
  const root = makeTempDir();
  const devRoot = path.join(root, 'Dev');
  const agentPath = path.join(devRoot, 'crm', 'agents', 'broken');

  writeFile(path.join(agentPath, 'config.json'), '{not json');

  const discovery = new SessionDiscovery({
    claudeDir: path.join(root, '.claude'),
    devRoots: [devRoot],
    fileBusRoot: path.join(root, '.claude-remote', 'default'),
  });

  const sessions = await discovery.discover();

  assert.equal(sessions.some(session => session.path === agentPath), false);
});

test('ignores config.json files without a valid agent_name', async () => {
  const root = makeTempDir();
  const devRoot = path.join(root, 'Dev');
  const projectPath = path.join(devRoot, 'generic-tool');
  const modelOnlyPath = path.join(devRoot, 'model-only');

  writeJson(path.join(projectPath, 'config.json'), {
    name: 'generic-tool',
    version: 1,
  });
  writeJson(path.join(modelOnlyPath, 'config.json'), {
    model: 'claude-opus-4-6',
  });

  const discovery = new SessionDiscovery({
    claudeDir: path.join(root, '.claude'),
    devRoots: [devRoot],
    fileBusRoot: path.join(root, '.claude-remote', 'default'),
  });

  const sessions = await discovery.discover();

  assert.equal(sessions.some(session => session.path === projectPath), false);
  assert.equal(sessions.some(session => session.path === modelOnlyPath), false);
});

test('pid checks treat EPERM as an alive process', () => {
  const originalKill = process.kill;
  const discovery = new SessionDiscovery();

  process.kill = () => {
    const err = new Error('operation not permitted');
    err.code = 'EPERM';
    throw err;
  };

  try {
    assert.equal(discovery._pidIsAlive(123), true);
  } finally {
    process.kill = originalKill;
  }
});

test('timestamp parsing does not treat short numeric pid strings as dates', () => {
  const discovery = new SessionDiscovery();

  assert.equal(discovery._timestampFromText('73622'), null);
  assert.equal(discovery._timestampFromText('1778890762'), 1778890762000);
});
