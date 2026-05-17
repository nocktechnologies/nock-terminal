export const DEFAULT_AGENT_ID = 'claude';
export const CUSTOM_AGENT_ID = 'custom';
export const AGENT_FOLDER_ID = 'agent-folder';

const MAX_LAUNCHER_TARGETS = 80; // Keep the palette responsive on large dev roots.

export const AGENT_LAUNCHERS = [
  {
    id: 'claude',
    label: 'Claude Code',
    shortLabel: 'Claude',
    defaultCommand: 'claude',
    profileCommandKey: 'claudeCommand',
    contextLabels: ['CLAUDE.md'],
  },
  {
    id: 'codex',
    label: 'Codex CLI',
    shortLabel: 'Codex',
    defaultCommand: 'codex',
    profileCommandKey: 'codexCommand',
    contextLabels: ['AGENTS.md', '.codex/config.toml'],
  },
  {
    id: 'gemini',
    label: 'Gemini CLI',
    shortLabel: 'Gemini',
    defaultCommand: 'gemini',
    profileCommandKey: 'geminiCommand',
    contextLabels: ['GEMINI.md'],
  },
  {
    id: CUSTOM_AGENT_ID,
    label: 'Custom Agent',
    shortLabel: 'Custom',
    defaultCommand: '',
    profileCommandKey: 'customAgentCommand',
    contextLabels: [],
  },
];

const LAUNCHER_BY_ID = new Map(AGENT_LAUNCHERS.map((launcher) => [launcher.id, launcher]));

function trimString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function getAgentLauncher(agentId) {
  return LAUNCHER_BY_ID.get(agentId) || LAUNCHER_BY_ID.get(DEFAULT_AGENT_ID);
}

export function normalizeAgentId(agentId) {
  const normalized = trimString(agentId).toLowerCase();
  return LAUNCHER_BY_ID.has(normalized) ? normalized : DEFAULT_AGENT_ID;
}

export function resolveDefaultAgentId(profile = {}) {
  return normalizeAgentId(profile?.defaultAgent || DEFAULT_AGENT_ID);
}

export function getProfileCommand(profile = {}, agentId = DEFAULT_AGENT_ID) {
  const launcher = getAgentLauncher(normalizeAgentId(agentId));
  const override = trimString(profile?.[launcher.profileCommandKey]);
  if (override) return override;
  return launcher.defaultCommand;
}

export function resolveSessionLaunch(session, profile = {}, agentId) {
  const isAgentFolder = session?.kind === 'agent';
  if (isAgentFolder) {
    const command = trimString(session?.launch?.command);
    return {
      agentId: AGENT_FOLDER_ID,
      label: session?.name || 'Agent',
      shortLabel: 'Agent',
      command,
      cwd: session?.launch?.cwd || session?.path || undefined,
      title: session?.name || 'Agent',
      disabledReason: command ? '' : 'Agent launch command is missing',
    };
  }

  const resolvedAgentId = normalizeAgentId(agentId || resolveDefaultAgentId(profile));
  const launcher = getAgentLauncher(resolvedAgentId);
  const command = getProfileCommand(profile, resolvedAgentId);

  return {
    agentId: resolvedAgentId,
    label: launcher.label,
    shortLabel: launcher.shortLabel,
    command,
    cwd: session?.path || profile?.projectPath || undefined,
    title: `${session?.name || 'Project'} (${launcher.shortLabel})`,
    disabledReason: command ? '' : 'Configure a custom agent command in the project profile',
  };
}

export function buildSessionSearchText(session, profile = {}) {
  const defaultAgentId = resolveDefaultAgentId(profile);
  const defaultLauncher = getAgentLauncher(defaultAgentId);
  const fields = [
    session?.name,
    session?.path,
    session?.branch,
    session?.status,
    session?.kind,
    session?.agent?.name,
    session?.agent?.lifecycle,
    session?.agent?.model,
    session?.launch?.command,
    defaultLauncher?.label,
    defaultLauncher?.shortLabel,
    profile?.notes,
    profile?.preferredModel,
  ];

  return fields
    .filter((value) => value != null)
    .map((value) => String(value).toLowerCase())
    .join(' ');
}

export function buildLauncherTargets(sessions = [], profilesByPath = {}, query = '') {
  const terms = String(query || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  return (Array.isArray(sessions) ? sessions : [])
    .map((session) => {
      const profile = profilesByPath?.[session.path] || {};
      const launch = resolveSessionLaunch(session, profile);
      return {
        session,
        profile,
        launch,
        defaultAgentId: resolveDefaultAgentId(profile),
        searchText: buildSessionSearchText(session, profile),
      };
    })
    .filter((target) => terms.every((term) => target.searchText.includes(term)))
    .slice(0, MAX_LAUNCHER_TARGETS);
}

export function sanitizeStagedTerminalInput(value, maxLength = 4000) {
  return String(value || '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, maxLength);
}
