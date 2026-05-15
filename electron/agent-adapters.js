const AGENT_ADAPTERS = [
  {
    id: 'claude',
    label: 'Claude Code',
    processNames: ['claude', 'claude.exe', 'claude.cmd'],
    contextGroups: [
      {
        label: 'CLAUDE.md',
        paths: ['CLAUDE.md', '.claude/CLAUDE.md'],
      },
    ],
  },
  {
    id: 'codex',
    label: 'Codex',
    processNames: ['codex', 'codex.exe', 'codex.cmd'],
    contextGroups: [
      {
        label: 'AGENTS.md',
        paths: ['AGENTS.md', '.codex/AGENTS.md', '.Codex/AGENTS.md'],
      },
      {
        label: '.codex/config.toml',
        paths: ['.codex/config.toml', '.Codex/config.toml'],
      },
    ],
  },
];

const SHARED_CONTEXT_GROUPS = [
  {
    label: '.nock/config.toml',
    paths: ['.nock/config.toml'],
  },
];

function getAgentAdapters() {
  return AGENT_ADAPTERS.map(adapter => ({
    ...adapter,
    processNames: [...adapter.processNames],
    contextGroups: adapter.contextGroups.map(group => ({
      ...group,
      paths: [...group.paths],
    })),
  }));
}

function getAgentContextGroups() {
  return [
    ...AGENT_ADAPTERS.flatMap(adapter => adapter.contextGroups),
    ...SHARED_CONTEXT_GROUPS,
  ].map(group => ({ ...group, paths: [...group.paths] }));
}

function getAgentProcessNames() {
  return [...new Set(AGENT_ADAPTERS.flatMap(adapter => adapter.processNames))];
}

function normalizeProcessName(name) {
  return String(name || '').toLowerCase().split(/[\\/]/).pop();
}

function commandTokens(name) {
  return String(name || '')
    .toLowerCase()
    .split(/\s+/)
    .map(token => token.split(/[\\/]/).pop())
    .filter(Boolean);
}

function matchAgentProcesses(processNames) {
  const normalizedProcessNames = new Set((processNames || []).flatMap(commandTokens));
  return AGENT_ADAPTERS
    .filter(adapter => adapter.processNames.some(name => normalizedProcessNames.has(normalizeProcessName(name))))
    .map(adapter => adapter.id);
}

module.exports = {
  getAgentAdapters,
  getAgentContextGroups,
  getAgentProcessNames,
  matchAgentProcesses,
};
