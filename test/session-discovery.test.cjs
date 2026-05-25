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
  assert.equal(mira.launch.command, 'tmux attach -t crm-default-mira');
  assert.equal(mira.launch.cwd, agentPath);
  assert.equal(mira.launch.action, 'attach');
  assert.equal(mira.launch.actionLabel, 'Attach');
  assert.equal(mira.launch.capability, 'live-attach');
  assert.equal(mira.sessionContract.adapterId, 'local-agent-folder');
  assert.equal(mira.sessionContract.liveAttach.state, 'supported');
  assert.equal(mira.sessionContract.liveAttach.command, 'tmux attach -t crm-default-mira');
  assert.equal(mira.sessionContract.resumeCommand.state, 'supported');
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
  assert.equal(mira.launch.command, 'tmux attach -t crm-default-mira');
  assert.equal(mira.launch.cwd, agentPath);
});

test('adds Claude session contract metadata to transcript-only project rows', async () => {
  const root = makeTempDir();
  const claudeDir = path.join(root, '.claude');
  const projectPath = path.join(root, 'Dev', 'nock-terminal');
  const claudeProjectPath = path.join(claudeDir, 'projects', 'transcript-for-project');

  writeFile(
    path.join(claudeProjectPath, 'session.jsonl'),
    `${JSON.stringify({ type: 'user', cwd: projectPath, message: { role: 'user', content: [] } })}\n`
  );

  const discovery = new SessionDiscovery({
    claudeDir,
    devRoots: [],
    fileBusRoot: path.join(root, '.claude-remote', 'default'),
  });

  const sessions = await discovery.discover();
  const project = sessions.find(session => session.path === projectPath);

  assert.ok(project);
  assert.equal(project.sessionContract.adapterId, 'claude');
  assert.equal(project.sessionContract.transcriptDiscovery.state, 'supported');
  assert.equal(project.sessionContract.transcriptDiscovery.projectPath, claudeProjectPath);
  assert.equal(project.sessionContract.liveAttach.state, 'unsupported');
});

test('uses CRM tmux attach fallback for enabled persistent agents without shell aliases', async () => {
  const root = makeTempDir();
  const devRoot = path.join(root, 'Dev');
  const agentPath = path.join(devRoot, 'claude-remote-manager', 'agents', 'cooper');

  writeJson(path.join(agentPath, 'config.json'), {
    agent_name: 'cooper',
    enabled: true,
    model: 'claude-opus-4-6',
  });

  const discovery = new SessionDiscovery({
    claudeDir: path.join(root, '.claude'),
    devRoots: [devRoot],
    fileBusRoot: path.join(root, '.claude-remote', 'default'),
  });
  let attachCommandCalls = 0;
  const originalAttachCommand = discovery._resolveCrmAgentAttachCommand.bind(discovery);
  discovery._resolveCrmAgentAttachCommand = (...args) => {
    attachCommandCalls += 1;
    return originalAttachCommand(...args);
  };

  const sessions = await discovery.discover();
  const cooper = sessions.find(session => session.kind === 'agent' && session.agent?.name === 'cooper');

  assert.ok(cooper);
  assert.equal(cooper.launch.command, 'tmux attach -t crm-default-cooper');
  assert.equal(cooper.launch.canLaunch, true);
  assert.equal(cooper.launch.action, 'attach');
  assert.equal(cooper.sessionContract.liveAttach.evidence, 'crm-tmux-session-name');
  assert.equal(attachCommandCalls, 1);
});

test('keeps explicit agent launch commands as folder launches rather than attach claims', async () => {
  const root = makeTempDir();
  const devRoot = path.join(root, 'Dev');
  const agentPath = path.join(devRoot, 'claude-remote-manager', 'agents', 'mira');

  writeJson(path.join(agentPath, 'config.json'), {
    agent_name: 'mira',
    enabled: true,
    model: 'claude-opus-4-6',
    launch_command: 'mira --watch',
  });

  const discovery = new SessionDiscovery({
    claudeDir: path.join(root, '.claude'),
    devRoots: [devRoot],
    fileBusRoot: path.join(root, '.claude-remote', 'default'),
  });

  const sessions = await discovery.discover();
  const mira = sessions.find(session => session.kind === 'agent' && session.agent?.name === 'mira');

  assert.ok(mira);
  assert.equal(mira.launch.command, 'mira --watch');
  assert.equal(mira.launch.action, 'launch');
  assert.equal(mira.launch.capability, 'folder-launch');
  assert.equal(mira.sessionContract.liveAttach.state, 'unsupported');
  assert.equal(mira.sessionContract.folderLaunch.state, 'supported');
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

test('discovers disabled Codex and DeepSeek folders as dispatch-ready agents', async () => {
  const root = makeTempDir();
  const devRoot = path.join(root, 'Dev');
  const crmRoot = path.join(devRoot, 'claude-remote-manager');
  const fileBusRoot = path.join(root, '.claude-remote', 'default');

  writeFile(
    path.join(crmRoot, 'core', 'scripts', 'dispatch-codex.sh'),
    '#!/usr/bin/env bash\nALLOWED_AGENTS=(forge kiln hammer ash vale talon)\n'
  );
  writeFile(
    path.join(crmRoot, 'core', 'scripts', 'dispatch-deepseek.sh'),
    '#!/usr/bin/env bash\nALLOWED_AGENTS=(smith tinker)\n'
  );
  writeFile(
    path.join(crmRoot, 'agents', 'ash', 'scripts', 'dispatch-ash.sh'),
    '#!/usr/bin/env bash\nexec "${BASH_SOURCE[0]}/../../../core/scripts/dispatch-codex.sh" --agent ash "$@"\n'
  );
  writeJson(path.join(crmRoot, 'agents', 'ash', 'config.json'), {
    agent_name: 'ash',
    agent_runtime: 'codex',
    enabled: false,
    model: 'o4-mini',
    working_directory: path.join(devRoot, 'claude-remote-manager-codex-dispatch'),
  });
  writeJson(path.join(crmRoot, 'agents', 'smith', 'config.json'), {
    agent_name: 'smith',
    agent_runtime: 'deepseek',
    enabled: false,
    model: 'deepseek-v4-pro',
    working_directory: path.join(devRoot, 'claude-remote-manager-smith-dispatch'),
  });

  const discovery = new SessionDiscovery({
    claudeDir: path.join(root, '.claude'),
    devRoots: [devRoot],
    fileBusRoot,
  });

  const sessions = await discovery.discover();
  const ash = sessions.find(session => session.kind === 'agent' && session.agent?.name === 'ash');
  const smith = sessions.find(session => session.kind === 'agent' && session.agent?.name === 'smith');

  assert.ok(ash);
  assert.equal(ash.agent.enabled, false);
  assert.equal(ash.agent.runtime, 'codex');
  assert.equal(ash.agent.lifecycle, 'dispatch');
  assert.equal(ash.status, 'inactive');
  assert.equal(ash.launch.mode, 'dispatch');
  assert.equal(ash.launch.action, 'dispatch');
  assert.equal(ash.launch.actionLabel, 'Dispatch');
  assert.equal(ash.launch.capability, 'dispatch-request');
  assert.equal(ash.launch.canLaunch, true);
  assert.equal(ash.launch.broker, 'mira-nockos');
  assert.equal(ash.launch.scriptPath, path.join(crmRoot, 'core', 'scripts', 'dispatch-codex.sh'));
  assert.equal(ash.launch.aliasPath, path.join(crmRoot, 'agents', 'ash', 'scripts', 'dispatch-ash.sh'));
  assert.equal(ash.launch.aliasCommand, path.join('agents', 'ash', 'scripts', 'dispatch-ash.sh'));
  assert.equal(ash.launch.directScriptPath, ash.launch.aliasPath);
  assert.equal(ash.launch.directAgentBound, true);
  assert.equal(ash.launch.cwd, crmRoot);
  assert.match(ash.launch.commandTemplate, /dispatch-ash\.sh --payload-file <payload-file>/);
  assert.doesNotMatch(ash.launch.commandTemplate, /--agent ash/);

  assert.ok(smith);
  assert.equal(smith.agent.runtime, 'deepseek');
  assert.equal(smith.agent.lifecycle, 'dispatch');
  assert.equal(smith.launch.mode, 'dispatch');
  assert.equal(smith.sessionContract.adapterId, 'deepseek-dispatch');
  assert.equal(smith.sessionContract.liveAttach.state, 'unsupported');
  assert.equal(smith.sessionContract.dispatchRequest.state, 'supported');
  assert.equal(smith.launch.canLaunch, true);
  assert.equal(smith.launch.aliasCommand, 'dispatch-deepseek.sh --agent smith');
  assert.equal(smith.launch.directScriptPath, path.join(crmRoot, 'core', 'scripts', 'dispatch-deepseek.sh'));
  assert.equal(smith.launch.directAgentBound, false);
  assert.match(smith.launch.commandTemplate, /dispatch-deepseek\.sh --agent smith --payload-file <payload-file>/);
});

test('falls back to common dev roots when stored devRoots is empty', async () => {
  const root = makeTempDir();
  const devRoot = path.join(root, 'Dev');
  const crmRoot = path.join(devRoot, 'claude-remote-manager');

  writeFile(
    path.join(crmRoot, 'core', 'scripts', 'dispatch-codex.sh'),
    '#!/usr/bin/env bash\nALLOWED_AGENTS=(forge kiln hammer ash vale talon)\n'
  );
  writeFile(
    path.join(crmRoot, 'core', 'scripts', 'dispatch-deepseek.sh'),
    '#!/usr/bin/env bash\nALLOWED_AGENTS=(smith tinker)\n'
  );
  for (const [agentName, runtime] of [
    ['ash', 'codex'],
    ['smith', 'deepseek'],
    ['tinker', 'deepseek'],
  ]) {
    writeJson(path.join(crmRoot, 'agents', agentName, 'config.json'), {
      agent_name: agentName,
      agent_runtime: runtime,
      enabled: false,
      model: runtime === 'deepseek' ? 'deepseek-v4-pro' : 'o4-mini',
    });
  }

  const discovery = new SessionDiscovery({
    claudeDir: path.join(root, '.claude'),
    devRoots: [],
    defaultDevRoots: [devRoot],
    fileBusRoot: path.join(root, '.claude-remote', 'default'),
  });

  const sessions = await discovery.discover();
  for (const agentName of ['ash', 'smith', 'tinker']) {
    const session = sessions.find(item => item.kind === 'agent' && item.agent?.name === agentName);
    assert.ok(session, `${agentName} should be discovered from the default dev root`);
    assert.equal(session.launch.mode, 'dispatch');
    assert.equal(session.launch.canLaunch, true);
  }
});

test('keeps non-allowlisted dispatch folders visible but not launchable', async () => {
  const root = makeTempDir();
  const devRoot = path.join(root, 'Dev');
  const crmRoot = path.join(devRoot, 'claude-remote-manager');

  writeFile(
    path.join(crmRoot, 'core', 'scripts', 'dispatch-codex.sh'),
    '#!/usr/bin/env bash\nALLOWED_AGENTS=(ash vale talon)\n'
  );
  writeJson(path.join(crmRoot, 'agents', 'warden', 'config.json'), {
    agent_name: 'warden',
    agent_runtime: 'codex',
    enabled: false,
    model: 'o4-mini',
  });

  const discovery = new SessionDiscovery({
    claudeDir: path.join(root, '.claude'),
    devRoots: [devRoot],
    fileBusRoot: path.join(root, '.claude-remote', 'default'),
  });

  const sessions = await discovery.discover();
  const warden = sessions.find(session => session.kind === 'agent' && session.agent?.name === 'warden');

  assert.ok(warden);
  assert.equal(warden.agent.runtime, 'codex');
  assert.equal(warden.agent.lifecycle, 'dispatch');
  assert.equal(warden.launch.mode, 'dispatch');
  assert.equal(warden.launch.canLaunch, false);
  assert.match(warden.launch.disabledReason, /not allowlisted/i);
});

test('does not duplicate agents from dispatch worktree copies', async () => {
  const root = makeTempDir();
  const devRoot = path.join(root, 'Dev');
  const crmRoot = path.join(devRoot, 'claude-remote-manager');
  const dispatchRoot = path.join(devRoot, 'claude-remote-manager-codex-dispatch');
  const copiedWorktreeRoot = path.join(devRoot, 'crm-rook-n557');

  writeFile(
    path.join(crmRoot, 'core', 'scripts', 'dispatch-codex.sh'),
    '#!/usr/bin/env bash\nALLOWED_AGENTS=(ash)\n'
  );
  writeFile(
    path.join(dispatchRoot, 'core', 'scripts', 'dispatch-codex.sh'),
    '#!/usr/bin/env bash\nALLOWED_AGENTS=(ash)\n'
  );
  writeFile(
    path.join(copiedWorktreeRoot, 'core', 'scripts', 'dispatch-codex.sh'),
    '#!/usr/bin/env bash\nALLOWED_AGENTS=(ash)\n'
  );
  writeJson(path.join(crmRoot, 'agents', 'ash', 'config.json'), {
    agent_name: 'ash',
    agent_runtime: 'codex',
    enabled: false,
  });
  writeJson(path.join(dispatchRoot, 'agents', 'ash', 'config.json'), {
    agent_name: 'ash',
    agent_runtime: 'codex',
    enabled: false,
  });
  writeJson(path.join(copiedWorktreeRoot, 'agents', 'ash', 'config.json'), {
    agent_name: 'ash',
    agent_runtime: 'codex',
    enabled: false,
  });

  const discovery = new SessionDiscovery({
    claudeDir: path.join(root, '.claude'),
    devRoots: [devRoot],
    fileBusRoot: path.join(root, '.claude-remote', 'default'),
  });

  const sessions = await discovery.discover();
  const ashSessions = sessions.filter(session => session.kind === 'agent' && session.agent?.name === 'ash');

  assert.equal(ashSessions.length, 1);
  assert.equal(ashSessions[0].path, path.join(crmRoot, 'agents', 'ash'));
});

test('dedupe prefers recently active agent folders when priority is otherwise tied', () => {
  const discovery = new SessionDiscovery({});
  const now = Date.now();
  const oldAsh = {
    path: '/tmp/agents-old/ash',
    agent: { name: 'ash', lifecycle: 'dispatch' },
    launch: { mode: 'dispatch', canLaunch: true },
    lastActivity: now - 48 * 60 * 60 * 1000,
  };
  const recentAsh = {
    path: '/tmp/agents-new/ash',
    agent: { name: 'ash', lifecycle: 'dispatch' },
    launch: { mode: 'dispatch', canLaunch: true },
    lastActivity: now - 10 * 60 * 1000,
  };

  const deduped = discovery._dedupeAgentFolders([oldAsh, recentAsh]);

  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].path, recentAsh.path);
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
