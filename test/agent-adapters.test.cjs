const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getAgentContextGroups,
  getAgentProcessNames,
  matchAgentProcesses,
} = require('../electron/agent-adapters');

test('agent adapter registry includes Claude and Codex context groups', () => {
  const groups = getAgentContextGroups();
  const labels = groups.map(group => group.label);

  assert.ok(labels.includes('CLAUDE.md'));
  assert.ok(labels.includes('AGENTS.md'));
  assert.ok(labels.includes('.codex/config.toml'));
});

test('agent process matching detects supported agent process names', () => {
  const names = getAgentProcessNames();
  assert.ok(names.includes('claude'));
  assert.ok(names.includes('codex'));

  assert.deepEqual(matchAgentProcesses(['zsh', 'claude', 'node']), ['claude']);
  assert.deepEqual(matchAgentProcesses(['pwsh.exe', 'codex.cmd']), ['codex']);
  assert.deepEqual(matchAgentProcesses(['123 /usr/local/bin/codex --model gpt-5']), ['codex']);
});
