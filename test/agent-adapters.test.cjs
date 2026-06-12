const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getAgentSessionContract,
  getAgentSessionContracts,
  getAgentContextGroups,
  getAgentProcessNames,
  matchAgentProcesses,
} = require('../electron/agent-adapters');

test('agent adapter registry includes Claude, Codex, and Gemini context groups', () => {
  const groups = getAgentContextGroups();
  const labels = groups.map(group => group.label);

  assert.ok(labels.includes('CLAUDE.md'));
  assert.ok(labels.includes('AGENTS.md'));
  assert.ok(labels.includes('.codex/config.toml'));
  assert.ok(labels.includes('GEMINI.md'));
});

test('agent context groups merge duplicate labels across adapters', () => {
  const groups = getAgentContextGroups();
  const labels = groups.map(group => group.label);

  assert.deepEqual(labels, [
    'CLAUDE.md',
    'AGENTS.md',
    '.codex/config.toml',
    'GEMINI.md',
    '.nock/config.toml',
  ]);

  const agentsMd = groups.find(group => group.label === 'AGENTS.md');
  assert.deepEqual(agentsMd.paths, ['AGENTS.md', '.codex/AGENTS.md', '.Codex/AGENTS.md']);
});

test('agent process matching detects supported agent process names', () => {
  const names = getAgentProcessNames();
  assert.ok(names.includes('claude'));
  assert.ok(names.includes('codex'));
  assert.ok(names.includes('gemini'));

  assert.deepEqual(matchAgentProcesses(['zsh', 'claude', 'node']), ['claude']);
  assert.deepEqual(matchAgentProcesses(['pwsh.exe', 'codex.cmd']), ['codex']);
  assert.deepEqual(matchAgentProcesses(['123 /usr/local/bin/codex --model gpt-5']), ['codex']);
  assert.deepEqual(matchAgentProcesses(['123 /usr/local/bin/gemini --yolo']), ['gemini']);
});

test('agent session contracts separate transcript, attach, resume, and launch semantics', () => {
  const contracts = getAgentSessionContracts();
  const claude = contracts.find(contract => contract.id === 'claude');
  const codex = contracts.find(contract => contract.id === 'codex');
  const gemini = contracts.find(contract => contract.id === 'gemini');
  const localFolder = contracts.find(contract => contract.id === 'local-agent-folder');

  assert.equal(claude.transcriptDiscovery.state, 'supported');
  assert.equal(claude.liveAttach.state, 'unsupported');
  assert.equal(codex.transcriptDiscovery.state, 'supported');
  assert.equal(codex.transcriptDiscovery.source, 'codex-rollout-jsonl');
  assert.deepEqual(codex.transcriptDiscovery.paths, ['~/.codex/sessions/**/rollout-*.jsonl']);
  assert.equal(codex.resumeCommand.state, 'future');
  assert.equal(gemini.transcriptDiscovery.state, 'future');
  assert.equal(localFolder.liveAttach.state, 'conditional');
  assert.equal(localFolder.resumeCommand.state, 'conditional');
  assert.equal(localFolder.folderLaunch.state, 'conditional');
});

test('agent session contracts are defensive copies', () => {
  const contract = getAgentSessionContract('local-agent-folder');
  contract.liveAttach.state = 'mutated';

  assert.equal(getAgentSessionContract('local-agent-folder').liveAttach.state, 'conditional');
  assert.equal(getAgentSessionContract('unknown'), null);
});
