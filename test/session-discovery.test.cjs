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

function writeRollout(filePath, lines, { mtime } = {}) {
  writeFile(filePath, `${lines.map(line => JSON.stringify(line)).join('\n')}\n`);
  if (mtime) {
    fs.utimesSync(filePath, mtime, mtime);
  }
}

function writeGeminiProject(root, projectPath, slug, records, { projectRoot = projectPath, mtime } = {}) {
  writeJson(path.join(root, '.gemini', 'projects.json'), {
    projects: {
      [projectPath]: slug,
    },
  });
  writeFile(path.join(root, '.gemini', 'tmp', slug, '.project_root'), `${projectRoot}\n`);
  writeJson(path.join(root, '.gemini', 'tmp', slug, 'logs.json'), records);
  if (mtime) {
    fs.utimesSync(path.join(root, '.gemini', 'tmp', slug, 'logs.json'), mtime, mtime);
  }
}

test('logs missing Claude projects directory at debug level when discovery debug is enabled', async () => {
  const root = makeTempDir();
  const claudeDir = path.join(root, '.claude');
  const messages = [];
  const originalDebug = console.debug;
  const originalEnv = process.env.NOCK_DEBUG_DISCOVERY;
  console.debug = (...args) => messages.push(args.join(' '));
  process.env.NOCK_DEBUG_DISCOVERY = '1';

  try {
    const discovery = new SessionDiscovery({
      claudeDir,
      devRoots: [],
      fileBusRoot: path.join(root, '.claude-remote', 'default'),
    });

    assert.deepEqual(await discovery._discoverSessions(), []);
    assert.ok(messages.some(message =>
      message.includes('[session-discovery]')
      && message.includes('Claude projects directory unavailable')
      && message.includes(path.join(claudeDir, 'projects'))
    ));
  } finally {
    console.debug = originalDebug;
    if (originalEnv === undefined) {
      delete process.env.NOCK_DEBUG_DISCOVERY;
    } else {
      process.env.NOCK_DEBUG_DISCOVERY = originalEnv;
    }
  }
});

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

test('claude transcript rows expose a resume launch from the newest session id', async () => {
  const root = makeTempDir();
  const claudeDir = path.join(root, '.claude');
  const repoPath = path.join(root, 'Dev', 'my-repo');
  const projectDir = path.join(claudeDir, 'projects', 'encoded-my-repo');
  const olderId = '11111111-aaaa-4bbb-8ccc-222222222222';
  const newerId = '33333333-dddd-4eee-9fff-444444444444';
  const line = `${JSON.stringify({ type: 'user', cwd: repoPath, message: { role: 'user', content: [] } })}\n`;

  writeFile(path.join(projectDir, `${olderId}.jsonl`), line);
  writeFile(path.join(projectDir, `${newerId}.jsonl`), line);
  const past = new Date(Date.now() - 60 * 60 * 1000);
  fs.utimesSync(path.join(projectDir, `${olderId}.jsonl`), past, past);

  const discovery = new SessionDiscovery({
    claudeDir,
    devRoots: [],
    fileBusRoot: path.join(root, '.claude-remote', 'default'),
  });

  const sessions = await discovery.discover();
  const row = sessions.find(session => session.path === repoPath);

  assert.ok(row);
  assert.equal(row.claudeSessionId, newerId);
  assert.equal(row.launch.mode, 'terminal');
  assert.equal(row.launch.action, 'resume');
  assert.equal(row.launch.actionLabel, 'Resume');
  assert.equal(row.launch.capability, 'resume-command');
  assert.equal(row.launch.canLaunch, true);
  assert.equal(row.launch.command, `claude --resume ${newerId}`);
  assert.equal(row.launch.cwd, repoPath);
  assert.equal(row.sessionContract.resumeCommand.state, 'supported');
  assert.equal(row.sessionContract.resumeCommand.command, `claude --resume ${newerId}`);
});

test('claude transcript rows skip resume when the session id is not safe', async () => {
  const root = makeTempDir();
  const claudeDir = path.join(root, '.claude');
  const repoPath = path.join(root, 'Dev', 'my-repo');
  const projectDir = path.join(claudeDir, 'projects', 'encoded-my-repo');
  writeFile(
    path.join(projectDir, 'weird name; rm -rf.jsonl'),
    `${JSON.stringify({ type: 'user', cwd: repoPath, message: { role: 'user', content: [] } })}\n`
  );

  const discovery = new SessionDiscovery({
    claudeDir,
    devRoots: [],
    fileBusRoot: path.join(root, '.claude-remote', 'default'),
  });

  const sessions = await discovery.discover();
  const row = sessions.find(session => session.path === repoPath);

  assert.ok(row);
  assert.equal(row.claudeSessionId, undefined);
  assert.equal(row.launch, undefined);
});

test('excludes ephemeral agent worktree paths from discovered sessions', async () => {
  const root = makeTempDir();
  const claudeDir = path.join(root, '.claude');
  const repoPath = path.join(root, 'Dev', 'my-repo');
  const claudeWorktree = path.join(repoPath, '.claude', 'worktrees', 'wave1-fix');
  const plainWorktree = path.join(repoPath, '.worktrees', 'feature-x');

  writeFile(
    path.join(claudeDir, 'projects', 'repo-session', 'session.jsonl'),
    `${JSON.stringify({ type: 'user', cwd: repoPath, message: { role: 'user', content: [] } })}\n`
  );
  writeFile(
    path.join(claudeDir, 'projects', 'worktree-session', 'session.jsonl'),
    `${JSON.stringify({ type: 'user', cwd: claudeWorktree, message: { role: 'user', content: [] } })}\n`
  );
  writeFile(
    path.join(claudeDir, 'projects', 'plain-worktree-session', 'session.jsonl'),
    `${JSON.stringify({ type: 'user', cwd: plainWorktree, message: { role: 'user', content: [] } })}\n`
  );

  const discovery = new SessionDiscovery({
    claudeDir,
    devRoots: [],
    fileBusRoot: path.join(root, '.claude-remote', 'default'),
  });

  const sessions = await discovery.discover();
  const paths = sessions.map(session => session.path);

  assert.ok(paths.includes(repoPath), 'repo itself stays discoverable');
  assert.ok(!paths.includes(claudeWorktree), '.claude/worktrees checkout must be excluded');
  assert.ok(!paths.includes(plainWorktree), '.worktrees checkout must be excluded');
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

test('discovers Codex rollout sessions from session_meta cwd', async () => {
  const root = makeTempDir();
  const codexSessionsDir = path.join(root, '.codex', 'sessions');
  const projectPath = path.join(root, 'Dev', 'nock-terminal');
  const rolloutPath = path.join(codexSessionsDir, '2026', '06', '12', 'rollout-2026-06-12T10-00-00.jsonl');

  writeRollout(rolloutPath, [
    {
      type: 'session_meta',
      timestamp: '2026-06-12T10:00:00.000Z',
      payload: {
        id: 'codex-session-1',
        cwd: projectPath,
        cli_version: '1.2.3',
      },
    },
  ]);

  const discovery = new SessionDiscovery({
    claudeDir: path.join(root, '.claude'),
    codexSessionsDir,
    devRoots: [],
    fileBusRoot: path.join(root, '.claude-remote', 'default'),
  });

  const sessions = await discovery.discover();
  const project = sessions.find(session => session.path === projectPath);

  assert.ok(project);
  assert.equal(project.id, 'codex:codex-session-1');
  assert.equal(project.name, 'nock-terminal');
  assert.equal(project.sessionContract.adapterId, 'codex');
  assert.equal(project.sessionContract.transcriptDiscovery.state, 'supported');
  assert.equal(project.sessionContract.transcriptDiscovery.source, 'codex-rollout-jsonl');
  assert.equal(project.sessionContract.transcriptDiscovery.filePath, rolloutPath);
  assert.equal(project.sessionContract.transcriptDiscovery.sessionId, 'codex-session-1');
  assert.equal(project.sessionContract.transcriptDiscovery.cliVersion, '1.2.3');
  assert.equal(project.sessionContract.liveAttach.state, 'future');
  assert.equal(project.sessionContract.resumeCommand.state, 'future');
});

test('falls back to Codex turn_context cwd when session_meta lacks cwd', async () => {
  const root = makeTempDir();
  const codexSessionsDir = path.join(root, '.codex', 'sessions');
  const projectPath = path.join(root, 'Dev', 'fallback-project');
  const rolloutPath = path.join(codexSessionsDir, '2026', '06', '12', 'rollout-fallback.jsonl');

  writeRollout(rolloutPath, [
    {
      type: 'session_meta',
      timestamp: '2026-06-12T10:00:00.000Z',
      payload: { id: 'codex-session-2' },
    },
    {
      type: 'turn_context',
      timestamp: '2026-06-12T10:01:00.000Z',
      payload: { cwd: projectPath },
    },
  ]);

  const discovery = new SessionDiscovery({
    claudeDir: path.join(root, '.claude'),
    codexSessionsDir,
    devRoots: [],
    fileBusRoot: path.join(root, '.claude-remote', 'default'),
  });

  const sessions = await discovery.discover();
  const project = sessions.find(session => session.path === projectPath);

  assert.ok(project);
  assert.equal(project.id, 'codex:codex-session-2');
  assert.equal(project.name, 'fallback-project');
  assert.equal(project.sessionContract.transcriptDiscovery.cwdSource, 'turn_context');
});

test('skips malformed or empty Codex rollouts with debug logging', async () => {
  const root = makeTempDir();
  const codexSessionsDir = path.join(root, '.codex', 'sessions');
  const projectPath = path.join(root, 'Dev', 'valid-project');
  const messages = [];
  const originalDebug = console.debug;
  const originalEnv = process.env.NOCK_DEBUG_DISCOVERY;
  console.debug = (...args) => messages.push(args.join(' '));
  process.env.NOCK_DEBUG_DISCOVERY = '1';

  try {
    writeFile(path.join(codexSessionsDir, '2026', '06', '12', 'rollout-bad.jsonl'), '{bad json\n');
    writeFile(path.join(codexSessionsDir, '2026', '06', '12', 'rollout-empty.jsonl'), '');
    writeRollout(path.join(codexSessionsDir, '2026', '06', '12', 'rollout-valid.jsonl'), [
      {
        type: 'session_meta',
        timestamp: '2026-06-12T10:00:00.000Z',
        payload: { id: 'codex-session-valid', cwd: projectPath },
      },
    ]);

    const discovery = new SessionDiscovery({
      claudeDir: path.join(root, '.claude'),
      codexSessionsDir,
      devRoots: [],
      fileBusRoot: path.join(root, '.claude-remote', 'default'),
    });

    const sessions = await discovery.discover();

    assert.ok(sessions.some(session => session.path === projectPath));
    assert.ok(messages.some(message => message.includes('Codex rollout JSON parse failed')));
    assert.ok(messages.some(message => message.includes('Codex rollout cwd unavailable')));
  } finally {
    console.debug = originalDebug;
    if (originalEnv === undefined) {
      delete process.env.NOCK_DEBUG_DISCOVERY;
    } else {
      process.env.NOCK_DEBUG_DISCOVERY = originalEnv;
    }
  }
});

test('applies Codex rollout recency and bounded read caps', async () => {
  const root = makeTempDir();
  const codexSessionsDir = path.join(root, '.codex', 'sessions');
  const oldProjectPath = path.join(root, 'Dev', 'old-project');
  const hiddenProjectPath = path.join(root, 'Dev', 'hidden-project');
  const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);

  writeRollout(
    path.join(codexSessionsDir, '2026', '05', '01', 'rollout-old.jsonl'),
    [
      {
        type: 'session_meta',
        timestamp: oldDate.toISOString(),
        payload: { id: 'old-session', cwd: oldProjectPath },
      },
    ],
    { mtime: oldDate }
  );
  writeFile(
    path.join(codexSessionsDir, '2026', '06', '12', 'rollout-after-cap.jsonl'),
    `${JSON.stringify({ type: 'session_meta', payload: { id: 'after-cap-session' } })}\n`
    + `${' '.repeat(256)}${JSON.stringify({ type: 'turn_context', payload: { cwd: hiddenProjectPath } })}\n`
  );

  const discovery = new SessionDiscovery({
    claudeDir: path.join(root, '.claude'),
    codexSessionsDir,
    codexRolloutHeadBytes: 96,
    codexRolloutRecencyDays: 1,
    devRoots: [],
    fileBusRoot: path.join(root, '.claude-remote', 'default'),
  });

  const sessions = await discovery.discover();

  assert.equal(sessions.some(session => session.path === oldProjectPath), false);
  assert.equal(sessions.some(session => session.path === hiddenProjectPath), false);
});

test('derives Codex project names from Windows cwd strings without changing the path', async () => {
  const root = makeTempDir();
  const codexSessionsDir = path.join(root, '.codex', 'sessions');
  const windowsProjectPath = 'C:\\Users\\Kevin\\Dev\\nock-terminal';

  writeRollout(path.join(codexSessionsDir, '2026', '06', '12', 'rollout-windows.jsonl'), [
    {
      type: 'session_meta',
      timestamp: '2026-06-12T10:00:00.000Z',
      payload: { id: 'windows-session', cwd: windowsProjectPath },
    },
  ]);

  const discovery = new SessionDiscovery({
    claudeDir: path.join(root, '.claude'),
    codexSessionsDir,
    devRoots: [],
    fileBusRoot: path.join(root, '.claude-remote', 'default'),
  });

  const sessions = await discovery.discover();
  const project = sessions.find(session => session.id === 'codex:windows-session');

  assert.ok(project);
  assert.equal(project.path, windowsProjectPath);
  assert.equal(project.name, 'nock-terminal');
});

test('discovers Gemini prompt-log sessions from projects.json and logs.json', async () => {
  const root = makeTempDir();
  const geminiDir = path.join(root, '.gemini');
  const projectPath = path.join(root, 'Dev', 'nock-terminal');
  const projectRootPath = path.join(root, 'Copied', 'nock-terminal');
  const slug = 'nock-terminal';
  const olderTimestamp = '2026-06-12T10:00:00.000Z';
  const newerTimestamp = '2026-06-12T10:05:00.000Z';

  writeGeminiProject(
    root,
    projectPath,
    slug,
    [
      {
        sessionId: 'gemini-session-old',
        messageId: 1,
        type: 'user',
        message: 'hello',
        timestamp: olderTimestamp,
      },
      {
        sessionId: 'gemini-session-new',
        messageId: 2,
        type: 'user',
        message: 'continue',
        timestamp: newerTimestamp,
      },
    ],
    { projectRoot: projectRootPath }
  );

  const discovery = new SessionDiscovery({
    claudeDir: path.join(root, '.claude'),
    codexSessionsDir: path.join(root, '.codex', 'sessions'),
    geminiDir,
    devRoots: [],
    defaultDevRoots: [],
    fileBusRoot: path.join(root, '.claude-remote', 'default'),
  });

  const sessions = await discovery.discover();
  const project = sessions.find(session => session.path === projectPath);

  assert.ok(project);
  assert.equal(project.id, 'gemini:nock-terminal:gemini-session-new');
  assert.equal(project.name, 'nock-terminal');
  assert.equal(project.lastActivity, Date.parse(newerTimestamp));
  assert.equal(project.sessionContract.adapterId, 'gemini');
  assert.equal(project.sessionContract.transcriptDiscovery.state, 'conditional');
  assert.equal(project.sessionContract.transcriptDiscovery.source, 'gemini-prompt-logs');
  assert.equal(project.sessionContract.transcriptDiscovery.evidence, 'gemini-prompt-logs');
  assert.equal(project.sessionContract.transcriptDiscovery.projectPath, projectPath);
  assert.equal(project.sessionContract.transcriptDiscovery.projectSlug, slug);
  assert.equal(project.sessionContract.transcriptDiscovery.projectRootPath, projectRootPath);
  assert.equal(project.sessionContract.transcriptDiscovery.sessionId, 'gemini-session-new');
  assert.equal(project.sessionContract.transcriptDiscovery.sessionCount, 2);
  assert.equal(
    project.sessionContract.transcriptDiscovery.promptLogPath,
    path.join(geminiDir, 'tmp', slug, 'logs.json')
  );
  assert.equal(project.sessionContract.liveAttach.state, 'future');
  assert.equal(project.sessionContract.resumeCommand.state, 'future');
});

test('Gemini project-presence entries without prompt records emit no rows', async () => {
  const root = makeTempDir();
  const geminiDir = path.join(root, '.gemini');
  const homeProjectPath = root;
  const realProjectPath = path.join(root, 'Dev', 'nock-terminal');

  writeJson(path.join(geminiDir, 'projects.json'), {
    projects: {
      [homeProjectPath]: 'kevin',
      [realProjectPath]: 'nock-terminal',
    },
  });
  writeFile(path.join(geminiDir, 'tmp', 'kevin', '.project_root'), `${homeProjectPath}\n`);
  writeFile(path.join(geminiDir, 'tmp', 'kevin', 'logs.json'), '[]');
  writeFile(path.join(geminiDir, 'tmp', 'nock-terminal', '.project_root'), `${realProjectPath}\n`);

  const discovery = new SessionDiscovery({
    claudeDir: path.join(root, '.claude'),
    codexSessionsDir: path.join(root, '.codex', 'sessions'),
    geminiDir,
    devRoots: [],
    defaultDevRoots: [],
    fileBusRoot: path.join(root, '.claude-remote', 'default'),
  });

  const sessions = await discovery.discover();

  assert.equal(sessions.some(session => session.path === homeProjectPath), false);
  assert.equal(sessions.some(session => session.path === realProjectPath), false);
});

test('Gemini discovery falls back to .project_root when the project map path is unusable', async () => {
  const root = makeTempDir();
  const geminiDir = path.join(root, '.gemini');
  const projectRootPath = path.join(root, 'Dev', 'fallback-project');

  writeJson(path.join(geminiDir, 'projects.json'), {
    projects: {
      'not-an-absolute-path': 'fallback-project',
    },
  });
  writeFile(path.join(geminiDir, 'tmp', 'fallback-project', '.project_root'), `${projectRootPath}\n`);
  writeJson(path.join(geminiDir, 'tmp', 'fallback-project', 'logs.json'), [
    {
      sessionId: 'gemini-fallback-session',
      timestamp: '2026-06-12T10:00:00.000Z',
    },
  ]);

  const discovery = new SessionDiscovery({
    claudeDir: path.join(root, '.claude'),
    codexSessionsDir: path.join(root, '.codex', 'sessions'),
    geminiDir,
    devRoots: [],
    defaultDevRoots: [],
    fileBusRoot: path.join(root, '.claude-remote', 'default'),
  });

  const sessions = await discovery.discover();

  assert.ok(sessions.some(session => session.path === projectRootPath));
});

test('skips malformed and oversized Gemini logs with debug logging', async () => {
  const root = makeTempDir();
  const geminiDir = path.join(root, '.gemini');
  const badProjectPath = path.join(root, 'Dev', 'bad-json');
  const hugeProjectPath = path.join(root, 'Dev', 'huge-json');
  const messages = [];
  const originalDebug = console.debug;
  const originalEnv = process.env.NOCK_DEBUG_DISCOVERY;
  console.debug = (...args) => messages.push(args.join(' '));
  process.env.NOCK_DEBUG_DISCOVERY = '1';

  try {
    writeJson(path.join(geminiDir, 'projects.json'), {
      projects: {
        [badProjectPath]: 'bad-json',
        [hugeProjectPath]: 'huge-json',
      },
    });
    writeFile(path.join(geminiDir, 'tmp', 'bad-json', '.project_root'), `${badProjectPath}\n`);
    writeFile(path.join(geminiDir, 'tmp', 'bad-json', 'logs.json'), '{not json');
    writeFile(path.join(geminiDir, 'tmp', 'huge-json', '.project_root'), `${hugeProjectPath}\n`);
    writeFile(
      path.join(geminiDir, 'tmp', 'huge-json', 'logs.json'),
      JSON.stringify([{ sessionId: 'huge-session', timestamp: '2026-06-12T10:00:00.000Z' }])
    );

    const discovery = new SessionDiscovery({
      claudeDir: path.join(root, '.claude'),
      codexSessionsDir: path.join(root, '.codex', 'sessions'),
      geminiDir,
      geminiLogsBytes: 12,
      devRoots: [],
      defaultDevRoots: [],
      fileBusRoot: path.join(root, '.claude-remote', 'default'),
    });

    const sessions = await discovery.discover();

    assert.equal(sessions.some(session => session.path === badProjectPath), false);
    assert.equal(sessions.some(session => session.path === hugeProjectPath), false);
    assert.ok(messages.some(message => message.includes('Gemini prompt log JSON parse failed')));
    assert.ok(messages.some(message => message.includes('Gemini prompt log skipped by size cap')));
  } finally {
    console.debug = originalDebug;
    if (originalEnv === undefined) {
      delete process.env.NOCK_DEBUG_DISCOVERY;
    } else {
      process.env.NOCK_DEBUG_DISCOVERY = originalEnv;
    }
  }
});

test('Gemini discovery reads only the allowlisted project and prompt-log file shapes', async () => {
  const root = makeTempDir();
  const geminiDir = path.join(root, '.gemini');
  const projectPath = path.join(root, 'Dev', 'nock-terminal');
  const allowedFiles = new Set([
    path.join(geminiDir, 'projects.json'),
    path.join(geminiDir, 'tmp', 'nock-terminal', '.project_root'),
    path.join(geminiDir, 'tmp', 'nock-terminal', 'logs.json'),
  ]);
  const fsp = require('fs/promises');
  const originalReadFile = fsp.readFile;
  const originalReaddir = fsp.readdir;
  const originalStat = fsp.stat;

  writeGeminiProject(root, projectPath, 'nock-terminal', [
    {
      sessionId: 'gemini-session',
      timestamp: '2026-06-12T10:00:00.000Z',
    },
  ]);
  writeFile(path.join(geminiDir, 'history', 'nock-terminal', 'logs.json'), '[]');
  writeFile(path.join(geminiDir, 'oauth_creds.json'), '{}');
  writeFile(path.join(geminiDir, 'google_accounts.json'), '{}');

  try {
    fsp.readFile = async (filePath, ...args) => {
      const normalized = String(filePath);
      if (normalized.startsWith(geminiDir) && !allowedFiles.has(normalized)) {
        throw new Error(`unexpected Gemini read: ${normalized}`);
      }
      return originalReadFile.call(fsp, filePath, ...args);
    };
    fsp.stat = async (filePath, ...args) => {
      const normalized = String(filePath);
      if (normalized.startsWith(geminiDir) && !allowedFiles.has(normalized)) {
        throw new Error(`unexpected Gemini stat: ${normalized}`);
      }
      return originalStat.call(fsp, filePath, ...args);
    };
    fsp.readdir = async (dirPath, ...args) => {
      const normalized = String(dirPath);
      if (normalized.startsWith(geminiDir)) {
        throw new Error(`unexpected Gemini directory enumeration: ${normalized}`);
      }
      return originalReaddir.call(fsp, dirPath, ...args);
    };

    const discovery = new SessionDiscovery({
      claudeDir: path.join(root, '.claude'),
      codexSessionsDir: path.join(root, '.codex', 'sessions'),
      geminiDir,
      devRoots: [],
      defaultDevRoots: [],
      fileBusRoot: path.join(root, '.claude-remote', 'default'),
    });

    const sessions = await discovery._discoverGeminiSessions();

    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].path, projectPath);
  } finally {
    fsp.readFile = originalReadFile;
    fsp.readdir = originalReaddir;
    fsp.stat = originalStat;
  }
});

test('excludes Gemini prompt-log sessions from ephemeral worktree paths', async () => {
  const root = makeTempDir();
  const geminiDir = path.join(root, '.gemini');
  const worktreePath = path.join(root, 'Dev', 'repo', '.worktrees', 'agent-scratch');

  writeGeminiProject(root, worktreePath, 'agent-scratch', [
    {
      sessionId: 'gemini-worktree-session',
      timestamp: '2026-06-12T10:00:00.000Z',
    },
  ]);

  const discovery = new SessionDiscovery({
    claudeDir: path.join(root, '.claude'),
    codexSessionsDir: path.join(root, '.codex', 'sessions'),
    geminiDir,
    devRoots: [],
    defaultDevRoots: [],
    fileBusRoot: path.join(root, '.claude-remote', 'default'),
  });

  const sessions = await discovery.discover();

  assert.equal(sessions.some(session => session.path === worktreePath), false);
});

test('Gemini discovery refuses reserved slugs that map to non-session directories', async () => {
  const root = makeTempDir();
  const geminiDir = path.join(root, '.gemini');
  const projectPath = path.join(root, 'Dev', 'reserved-probe');

  // A projects.json that points at the bundled `bin` dir and credential-ish
  // names must never cause a read of those directories.
  for (const reserved of ['bin', 'history', 'oauth_creds', 'google_accounts']) {
    writeFile(path.join(geminiDir, 'tmp', reserved, '.project_root'), `${projectPath}\n`);
    writeJson(path.join(geminiDir, 'tmp', reserved, 'logs.json'), [
      { sessionId: `${reserved}-session`, timestamp: '2026-06-12T10:00:00.000Z' },
    ]);
  }
  writeJson(path.join(geminiDir, 'projects.json'), {
    projects: {
      [path.join(root, 'Dev', 'bin-proj')]: 'bin',
      [path.join(root, 'Dev', 'hist-proj')]: 'history',
      [path.join(root, 'Dev', 'oauth-proj')]: 'oauth_creds',
      [path.join(root, 'Dev', 'goog-proj')]: 'google_accounts',
    },
  });

  const discovery = new SessionDiscovery({
    claudeDir: path.join(root, '.claude'),
    codexSessionsDir: path.join(root, '.codex', 'sessions'),
    geminiDir,
    devRoots: [],
    defaultDevRoots: [],
    fileBusRoot: path.join(root, '.claude-remote', 'default'),
  });

  const sessions = await discovery.discover();
  assert.equal(sessions.some(session => String(session.id).startsWith('gemini:')), false);
});

test('Gemini discovery skips slug directories that are symlinks', async () => {
  const root = makeTempDir();
  const geminiDir = path.join(root, '.gemini');
  const projectPath = path.join(root, 'Dev', 'symlink-probe');
  const realDir = path.join(root, 'outside-gemini', 'real-session');

  // A real session dir living OUTSIDE the tmp tree, reached via a symlinked slug.
  writeFile(path.join(realDir, '.project_root'), `${projectPath}\n`);
  writeJson(path.join(realDir, 'logs.json'), [
    { sessionId: 'symlinked-session', timestamp: '2026-06-12T10:00:00.000Z' },
  ]);
  fs.mkdirSync(path.join(geminiDir, 'tmp'), { recursive: true });
  fs.symlinkSync(realDir, path.join(geminiDir, 'tmp', 'evil-slug'));
  writeJson(path.join(geminiDir, 'projects.json'), {
    projects: { [projectPath]: 'evil-slug' },
  });

  const discovery = new SessionDiscovery({
    claudeDir: path.join(root, '.claude'),
    codexSessionsDir: path.join(root, '.codex', 'sessions'),
    geminiDir,
    devRoots: [],
    defaultDevRoots: [],
    fileBusRoot: path.join(root, '.claude-remote', 'default'),
  });

  const sessions = await discovery.discover();
  assert.equal(sessions.some(session => session.path === projectPath), false);
});

test('Gemini discovery never emits a row for the home directory itself', async () => {
  const root = makeTempDir();
  const geminiDir = path.join(root, '.gemini');
  const home = os.homedir();

  writeGeminiProject(root, home, 'home-slug', [
    { sessionId: 'home-session', timestamp: '2026-06-12T10:00:00.000Z' },
  ]);

  const discovery = new SessionDiscovery({
    claudeDir: path.join(root, '.claude'),
    codexSessionsDir: path.join(root, '.codex', 'sessions'),
    geminiDir,
    devRoots: [],
    defaultDevRoots: [],
    fileBusRoot: path.join(root, '.claude-remote', 'default'),
  });

  const sessions = await discovery.discover();
  assert.equal(sessions.some(session => session.path === home), false);
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
  assert.equal(mira.launch.canLaunch, false);
  assert.match(mira.launch.disabledReason, /requires confirmation/i);
  assert.equal(mira.launch.action, 'launch');
  assert.equal(mira.launch.capability, 'folder-launch');
  assert.equal(mira.sessionContract.liveAttach.state, 'unsupported');
  assert.equal(mira.sessionContract.folderLaunch.state, 'conditional');
  assert.equal(mira.sessionContract.folderLaunch.command, 'mira --watch');
  assert.match(mira.sessionContract.folderLaunch.disabledReason, /requires confirmation/i);
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

test('_decodeDirName handles posix paths', () => {
  const discovery = new SessionDiscovery();
  assert.equal(discovery._decodeDirName('-Users-kevin-Dev-nock-terminal'), '/Users/kevin/Dev/nock/terminal');
});

test('_decodeDirName handles Windows paths with drive letter and nested folders', { skip: process.platform !== 'win32' }, () => {
  const discovery = new SessionDiscovery();
  // Standard encoding: leading dash, drive, `--`, then path with dashes as separators
  assert.equal(discovery._decodeDirName('-C--Users-kevin-Dev-project'), 'C:\\Users\\kevin\\Dev\\project');
});

test('_decodeDirName preserves rest-of-path when only one `--` separator is present', { skip: process.platform !== 'win32' }, () => {
  const discovery = new SessionDiscovery();
  // Regression: previous impl used String.replace('--', ':\\') which is correct
  // for the first `--` but then `replace(/-/g, '\\')` would have run over the
  // remainder. The new impl slices explicitly at the first `--` and only
  // replaces dashes in the suffix.
  const decoded = discovery._decodeDirName('-D--repo-name');
  assert.equal(decoded, 'D:\\repo\\name');
});

test('_decodeDirName falls back to dash-replacement when no `--` is present', { skip: process.platform !== 'win32' }, () => {
  const discovery = new SessionDiscovery();
  assert.equal(discovery._decodeDirName('foo-bar-baz'), 'foo\\bar\\baz');
});
