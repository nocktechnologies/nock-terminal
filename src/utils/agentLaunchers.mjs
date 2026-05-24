export const DEFAULT_AGENT_ID = 'claude';
export const CUSTOM_AGENT_ID = 'custom';
export const AGENT_FOLDER_ID = 'agent-folder';
export const DISPATCH_AGENT_ID = 'dispatch-agent';

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
    if (session?.launch?.mode === 'dispatch') {
      const runtime = (
        trimString(session?.agent?.runtime)
        || trimString(session?.launch?.runtime)
        || trimString(session?.launch?.dispatcher)
      ).toLowerCase();
      const label = session?.name || 'Dispatch Agent';
      return {
        agentId: DISPATCH_AGENT_ID,
        label,
        shortLabel: runtime ? runtime.toUpperCase() : 'Dispatch',
        command: '',
        cwd: session?.launch?.cwd || session?.agent?.workingDirectory || session?.path || undefined,
        title: `${label} Dispatch`,
        mode: 'dispatch',
        canLaunch: session?.launch?.canLaunch === true,
        runtime,
        broker: trimString(session?.launch?.broker) || 'mira-nockos',
        dispatcher: trimString(session?.launch?.dispatcher) || runtime,
        scriptPath: trimString(session?.launch?.scriptPath),
        aliasPath: trimString(session?.launch?.aliasPath),
        aliasCommand: trimString(session?.launch?.aliasCommand),
        directScriptPath: trimString(session?.launch?.directScriptPath),
        directAgentBound: session?.launch?.directAgentBound === true,
        commandTemplate: trimString(session?.launch?.commandTemplate),
        disabledReason: session?.launch?.canLaunch === true
          ? ''
          : (trimString(session?.launch?.disabledReason) || 'Dispatch agent is not launchable'),
      };
    }

    const command = trimString(session?.launch?.command);
    return {
      agentId: AGENT_FOLDER_ID,
      label: session?.name || 'Agent',
      shortLabel: 'Agent',
      command,
      cwd: session?.launch?.cwd || session?.path || undefined,
      title: session?.name || 'Agent',
      mode: 'terminal',
      canLaunch: Boolean(command),
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
    mode: 'terminal',
    canLaunch: Boolean(command),
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
    session?.agent?.runtime,
    session?.agent?.model,
    session?.launch?.mode,
    session?.launch?.broker,
    session?.launch?.dispatcher,
    session?.launch?.command,
    session?.launch?.commandTemplate,
    defaultLauncher?.label,
    defaultLauncher?.shortLabel,
    profile?.notes,
  ];

  return fields
    .filter((value) => value != null)
    .map((value) => String(value).toLowerCase())
    .join(' ');
}

function normalizedText(value) {
  return trimString(value).toLowerCase();
}

function launcherTargetRank(target, terms) {
  const session = target?.session || {};
  const launch = target?.launch || {};
  const agentName = normalizedText(session?.agent?.name);
  const displayName = normalizedText(session?.name);
  const pathName = normalizedText(session?.path?.split(/[\\/]/).filter(Boolean).pop());
  const names = [agentName, displayName, pathName].filter(Boolean);
  let rank = 0;

  if (names.some((name) => terms.some((term) => name === term))) {
    rank -= 1000;
  } else if (names.some((name) => terms.some((term) => name.startsWith(term)))) {
    rank -= 500;
  } else if (names.some((name) => terms.some((term) => name.includes(term)))) {
    rank -= 250;
  }

  if (session.kind === 'agent') rank -= 100;
  if (launch.mode === 'dispatch') rank -= 25;
  if (launch.canLaunch === true) rank -= 10;
  return rank;
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
    .sort((a, b) => {
      if (terms.length === 0) return 0;
      const rankDiff = launcherTargetRank(a, terms) - launcherTargetRank(b, terms);
      if (rankDiff !== 0) return rankDiff;
      return String(a.session?.name || '').localeCompare(String(b.session?.name || ''));
    })
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
