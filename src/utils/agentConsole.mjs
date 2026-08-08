export const DEFAULT_MODEL = 'claude-opus-4-8[1m]';

export const PERMISSION_PRESETS = {
  supervised: { label: 'Supervised', defaultMode: 'manual' },
  standard: { label: 'Standard', defaultMode: 'acceptEdits' },
  autonomous: { label: 'Autonomous', defaultMode: 'bypassPermissions' },
};

const MANAGED_ACTIONS = [
  'authenticate', 'validate', 'edit', 'start', 'stop', 'attach',
  'pause', 'resume', 'restart', 'rotate', 'steer',
];

const LIFECYCLE_LABELS = {
  needs_auth: 'Needs auth',
  stopped: 'Stopped',
  starting: 'Starting',
  running: 'Running',
  paused: 'Paused',
  terminal_failed: 'Terminal failed',
  invalid: 'Invalid',
  idle: 'Idle',
  offline: 'Offline',
  stale: 'Stale',
  dispatch: 'Dispatch',
  disabled: 'Disabled',
};

function text(value, fallback = '') {
  if (typeof value !== 'string' && typeof value !== 'number') return fallback;
  return String(value).trim() || fallback;
}

function lifecycle(value) {
  return text(value, 'unknown').toLowerCase().replace(/[\s-]+/g, '_');
}

function agentKey(value) {
  return text(value).toLowerCase().replace(/\s+/g, '-');
}

function stringList(value) {
  if (Array.isArray(value)) return value.map(item => text(item)).filter(Boolean);
  if (typeof value !== 'string') return [];
  return value.split(/[\n,]/).map(item => item.trim()).filter(Boolean);
}

function managedCapabilities(raw) {
  const supplied = raw?.capabilities || {};
  return Object.fromEntries(MANAGED_ACTIONS.map(action => [action, supplied[action] === true]));
}

export function normalizeManagedAgent(raw = {}) {
  const metadata = raw.metadata || {};
  const identity = metadata.identity || {};
  const workspaces = metadata.workspaces || {};
  const agent = raw.agent || {};
  const id = text(raw.agentId || agent.name, 'invalid-managed-agent');
  const status = lifecycle(raw.status || agent.lifecycle);
  const preset = PERMISSION_PRESETS[agent.permissionPreset] ? agent.permissionPreset : 'supervised';
  const session = raw.launch?.canLaunch === true ? raw : null;

  return {
    id,
    sourceId: text(raw.id, `managed:${id}`),
    key: `managed:${agentKey(id)}`,
    ownership: 'managed',
    displayName: text(raw.displayName || raw.name, id),
    name: id,
    lifecycle: status,
    lifecycleLabel: LIFECYCLE_LABELS[status] || status.replace(/_/g, ' '),
    harness: text(metadata.template, 'claude-code-tmux-resident'),
    runtime: text(metadata.runtime?.adapter, 'claude-code-interactive'),
    model: text(agent.model || metadata.runtime?.model, DEFAULT_MODEL),
    local: true,
    locationLabel: 'Local',
    role: text(identity.role),
    purpose: text(metadata.purpose),
    partner: text(identity.partner, 'Local operator'),
    workDirectory: text(agent.workingDirectory),
    residencePath: text(agent.residence || raw.home || raw.path),
    allowedRoots: stringList(workspaces.allowedRoots || agent.permissions?.allowedRoots),
    deniedRoots: stringList(workspaces.deniedRoots || agent.permissions?.deniedRoots),
    permissionPreset: preset,
    permission: PERMISSION_PRESETS[preset],
    failureReason: text(raw.failureReason),
    capabilities: managedCapabilities(raw),
    session,
    raw,
  };
}

export function normalizeImportedSession(session = {}) {
  const name = text(session.agent?.name || session.name || session.id, 'Unknown agent');
  const liveAttach = session.sessionContract?.liveAttach || {};
  const remote = session.location === 'remote'
    || session.agent?.location === 'remote'
    || (liveAttach.state === 'conditional'
      && /not reachable from this machine/i.test(liveAttach.disabledReason || session.launch?.disabledReason || ''));
  const status = lifecycle(session.agent?.lifecycle || session.status);
  return {
    id: text(session.id, name),
    sourceId: text(session.id, name),
    key: `imported:${text(session.id, agentKey(name))}`,
    ownership: 'imported',
    displayName: text(session.name, name),
    name,
    lifecycle: status,
    lifecycleLabel: LIFECYCLE_LABELS[status] || status.replace(/_/g, ' '),
    harness: text(session.agent?.harness, session.agent?.runtime === 'resident' ? 'resident harness' : 'discovered'),
    runtime: text(session.agent?.runtime || session.sessionContract?.adapterId, 'unknown'),
    model: text(session.agent?.model, 'Unspecified'),
    local: !remote,
    locationLabel: remote ? 'Remote' : 'Local',
    workDirectory: text(session.agent?.workingDirectory || session.path),
    residencePath: text(session.path),
    allowedRoots: [],
    deniedRoots: [],
    permissionPreset: '',
    permission: null,
    failureReason: text(session.launch?.disabledReason || liveAttach.disabledReason),
    session,
    raw: session,
    capabilities: { attach: session.launch?.canLaunch === true },
  };
}

export function buildAgentInventory(managedRows = [], sessions = []) {
  const managed = (Array.isArray(managedRows) ? managedRows : [])
    .map(normalizeManagedAgent)
    .filter((agent, index, rows) => rows.findIndex(candidate => candidate.key === agent.key) === index);
  const managedIds = new Set(managed.flatMap(agent => [
    agentKey(agent.id), agentKey(agent.name), agentKey(agent.sourceId),
  ]).filter(Boolean));
  const imported = (Array.isArray(sessions) ? sessions : [])
    .filter(session => session?.kind === 'agent')
    .map(normalizeImportedSession)
    .filter(agent => !managedIds.has(agentKey(agent.id)) && !managedIds.has(agentKey(agent.name)));
  return [...managed, ...imported].sort((left, right) => {
    if (left.ownership !== right.ownership) return left.ownership === 'managed' ? -1 : 1;
    return left.displayName.localeCompare(right.displayName);
  });
}

export function normalizePrerequisites(raw) {
  const entries = Array.isArray(raw) ? raw : (raw?.items || raw?.prerequisites || []);
  return entries.map((entry, index) => ({
    id: text(entry.id, `prerequisite-${index}`),
    label: text(entry.label || entry.id, 'Prerequisite'),
    available: entry.available === true,
    reason: text(entry.reason),
  }));
}

export function parseWorkspaceRoots(value) {
  return stringList(value);
}

export function buildResidentDraft(values = {}) {
  const id = text(values.id).toLowerCase();
  const preset = text(values.permissionPreset, 'supervised').toLowerCase();
  return {
    id,
    displayName: text(values.displayName, id),
    role: text(values.role),
    purpose: text(values.purpose),
    workDirectory: text(values.workDirectory),
    allowedRoots: parseWorkspaceRoots(values.allowedRoots),
    deniedRoots: parseWorkspaceRoots(values.deniedRoots),
    model: text(values.model, DEFAULT_MODEL),
    partner: text(values.partner, 'Local operator'),
    permissionPreset: PERMISSION_PRESETS[preset] ? preset : 'supervised',
  };
}

export function validateResidentDraft(values = {}) {
  const draft = buildResidentDraft(values);
  const errors = {};
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(draft.id)) {
    errors.id = 'Use 2-64 lowercase letters, numbers, or hyphens; start with a letter.';
  }
  if (!draft.displayName) errors.displayName = 'Display name is required.';
  if (!draft.role) errors.role = 'Role is required.';
  if (!draft.purpose) errors.purpose = 'Purpose is required.';
  if (!draft.partner) errors.partner = 'Partner is required.';
  if (!draft.model) errors.model = 'Model is required.';
  if (draft.workDirectory && !draft.workDirectory.startsWith('/')) errors.workDirectory = 'Work directory must be an absolute path.';
  if (draft.allowedRoots.some(root => !root.startsWith('/'))) errors.allowedRoots = 'Allowed roots must be absolute paths.';
  if (draft.deniedRoots.some(root => !root.startsWith('/'))) errors.deniedRoots = 'Denied roots must be absolute paths.';
  return { draft, errors, valid: Object.keys(errors).length === 0 };
}

export function unwrapManagedResponse(response, field) {
  if (response?.success === false) {
    throw new Error(response.error?.message || response.error || 'The managed agent operation failed.');
  }
  const value = response?.data ?? response;
  return field && value && Object.hasOwn(value, field) ? value[field] : value;
}

export function describeAgentError(error) {
  if (typeof error === 'string') return error;
  if (error?.message) return String(error.message);
  if (error?.error?.message) return String(error.error.message);
  return 'The operation did not complete.';
}
