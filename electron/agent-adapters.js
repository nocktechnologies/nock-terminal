const AGENT_ADAPTERS = [
  {
    id: 'claude',
    label: 'Claude Code',
    command: 'claude',
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
    command: 'codex',
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
  {
    id: 'gemini',
    label: 'Gemini CLI',
    command: 'gemini',
    processNames: ['gemini', 'gemini.exe', 'gemini.cmd'],
    contextGroups: [
      {
        label: 'GEMINI.md',
        paths: ['GEMINI.md', '.gemini/GEMINI.md'],
      },
    ],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    command: 'deepseek-chat',
    aliases: ['ds', 'deepseek'],
    processNames: ['deepseek-chat', 'deepseek-chat.py', 'deepseek-agent.py'],
    contextGroups: [
      {
        label: 'AGENTS.md',
        paths: ['AGENTS.md'],
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

const AGENT_SESSION_CONTRACTS = [
  {
    id: 'claude',
    label: 'Claude Code',
    transcriptDiscovery: {
      state: 'supported',
      source: 'claude-jsonl-cwd',
      paths: ['~/.claude/projects/*/*.jsonl'],
      notes: 'Nock reads Claude Code JSONL transcripts and recovers the project cwd from transcript events.',
    },
    liveAttach: {
      state: 'unsupported',
      notes: 'Current Claude Code rows are transcript-derived project records; no proven live attach target is exposed yet.',
    },
    resumeCommand: {
      state: 'future',
      notes: 'Claude resume semantics need an explicit adapter before the UI should claim resume support.',
    },
    folderLaunch: {
      state: 'supported',
      command: 'claude',
      notes: 'Project/profile launch opens a terminal in the project cwd and runs Claude Code.',
    },
  },
  {
    id: 'codex',
    label: 'Codex CLI',
    transcriptDiscovery: {
      state: 'future',
      notes: 'Codex CLI process detection and launch exist; transcript discovery waits for filesystem/runtime evidence.',
    },
    liveAttach: {
      state: 'future',
      notes: 'No live Codex attach target is implemented.',
    },
    resumeCommand: {
      state: 'future',
      notes: 'No Codex resume command is exposed by Nock Terminal yet.',
    },
    folderLaunch: {
      state: 'supported',
      command: 'codex',
      notes: 'Project/profile launch can open Codex CLI in a terminal.',
    },
  },
  {
    id: 'gemini',
    label: 'Gemini CLI',
    transcriptDiscovery: {
      state: 'future',
      notes: 'Gemini CLI process detection and launch exist; transcript discovery is not implemented.',
    },
    liveAttach: {
      state: 'future',
      notes: 'No live Gemini attach target is implemented.',
    },
    resumeCommand: {
      state: 'future',
      notes: 'No Gemini resume command is exposed by Nock Terminal yet.',
    },
    folderLaunch: {
      state: 'supported',
      command: 'gemini',
      notes: 'Project/profile launch can open Gemini CLI in a terminal.',
    },
  },
  {
    id: 'local-agent-folder',
    label: 'Local agent folder',
    transcriptDiscovery: {
      state: 'unsupported',
      notes: 'Agent folders are discovered from config and local state, not transcript adapters.',
    },
    liveAttach: {
      state: 'conditional',
      evidence: 'crm-tmux-session-name',
      notes: 'Supported only when discovery can derive a deterministic CRM tmux attach command.',
    },
    resumeCommand: {
      state: 'conditional',
      evidence: 'crm-tmux-session-name',
      notes: 'CRM persistent agents resume by attaching to the named tmux session; arbitrary folder commands remain launches.',
    },
    folderLaunch: {
      state: 'supported',
      notes: 'Explicit configured launch commands and agent-name fallbacks open an agent folder terminal.',
    },
  },
  {
    id: 'dispatch-agent',
    label: 'Dispatch agent',
    transcriptDiscovery: {
      state: 'unsupported',
      notes: 'Dispatch agents are request-level workers; Nock tracks request status, not local transcripts.',
    },
    liveAttach: {
      state: 'unsupported',
      notes: 'Dispatch agents do not expose a live local session to attach.',
    },
    resumeCommand: {
      state: 'unsupported',
      notes: 'Dispatch completion is request-level; resume belongs to future completion-thread work.',
    },
    folderLaunch: {
      state: 'unsupported',
      notes: 'Dispatch agents stage requests instead of launching folder terminals.',
    },
    dispatchRequest: {
      state: 'conditional',
      notes: 'Supported when the dispatch script exists and the agent is allowlisted.',
    },
  },
];

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

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

function getAgentSessionContracts() {
  return cloneJson(AGENT_SESSION_CONTRACTS);
}

function getAgentSessionContract(id) {
  const contract = AGENT_SESSION_CONTRACTS.find(item => item.id === id);
  return contract ? cloneJson(contract) : null;
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
  getAgentSessionContract,
  getAgentSessionContracts,
  matchAgentProcesses,
};
