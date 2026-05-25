export const DISPATCH_RUN_STORAGE_KEY = 'nock-terminal.dispatchRuns.v1';
export const MAX_DISPATCH_RUNS = 12;

const VALID_STATUSES = new Set([
  'drafted',
  'sent',
  'launched',
  'accepted',
  'running',
  'blocked',
  'completed',
  'failed',
  'expired',
  'unknown',
]);

const TERMINAL_STATUSES = new Set([
  'blocked',
  'completed',
  'failed',
  'expired',
  'unknown',
]);

const ALLOWED_TRANSITIONS = {
  drafted: new Set(['sent', 'launched', 'failed']),
  sent: new Set(['accepted', 'running', 'completed', 'blocked', 'failed', 'expired', 'unknown']),
  launched: new Set(['accepted', 'running', 'completed', 'blocked', 'failed', 'expired', 'unknown']),
  accepted: new Set(['running', 'blocked', 'completed', 'failed', 'expired', 'unknown']),
  running: new Set(['completed', 'failed', 'expired', 'unknown']),
};

const STRING_FIELDS = {
  id: 200,
  agentName: 100,
  agentDisplayName: 200,
  runtime: 40,
  targetRepo: 1000,
  projectName: 200,
  mode: 40,
  requestId: 200,
  messageId: 200,
  broker: 100,
  payloadFile: 1000,
  command: 2000,
  error: 500,
  statusMessage: 500,
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, maxLength);
}

function cleanTimestamp(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function fallbackRunId(run, index, createdAt) {
  const requestId = cleanString(run.requestId, STRING_FIELDS.requestId);
  if (requestId) return `dispatch-${requestId}`;
  return `dispatch-${createdAt}-${index}`;
}

export function normalizeDispatchStatus(status) {
  const normalized = cleanString(status, 40).toLowerCase();
  return VALID_STATUSES.has(normalized) ? normalized : 'unknown';
}

export function isTerminalDispatchStatus(status) {
  return TERMINAL_STATUSES.has(normalizeDispatchStatus(status));
}

export function canTransitionDispatchStatus(fromStatus, toStatus) {
  const from = normalizeDispatchStatus(fromStatus);
  const to = normalizeDispatchStatus(toStatus);
  if (from === to) return true;
  if (isTerminalDispatchStatus(from)) return false;
  return ALLOWED_TRANSITIONS[from]?.has(to) === true;
}

export function normalizeDispatchRun(run, { index = 0, now = Date.now() } = {}) {
  if (!isPlainObject(run)) return null;

  const createdAt = cleanTimestamp(run.createdAt, now);
  const normalized = {
    id: cleanString(run.id, STRING_FIELDS.id) || fallbackRunId(run, index, createdAt),
    createdAt,
    status: normalizeDispatchStatus(run.status),
  };

  const updatedAt = cleanTimestamp(run.updatedAt, 0);
  if (updatedAt) normalized.updatedAt = updatedAt;

  for (const [field, maxLength] of Object.entries(STRING_FIELDS)) {
    if (field === 'id') continue;
    const value = cleanString(run[field], maxLength);
    if (value) normalized[field] = value;
  }

  return normalized;
}

export function createDispatchRun(run, { id, now = Date.now() } = {}) {
  return normalizeDispatchRun({
    ...run,
    id: id || run?.id,
    createdAt: now,
  }, { now });
}

export function normalizeDispatchRunList(value, options = {}) {
  if (!Array.isArray(value)) return [];
  return value
    .map((run, index) => normalizeDispatchRun(run, { ...options, index }))
    .filter(Boolean)
    .slice(0, MAX_DISPATCH_RUNS);
}

export function readDispatchRunsFromStorage(storage, options = {}) {
  try {
    return normalizeDispatchRunList(
      JSON.parse(storage?.getItem?.(DISPATCH_RUN_STORAGE_KEY) || '[]'),
      options
    );
  } catch {
    return [];
  }
}

export function serializeDispatchRuns(runs) {
  return JSON.stringify(normalizeDispatchRunList(runs));
}

export function writeDispatchRunsToStorage(storage, runs) {
  try {
    storage?.setItem?.(DISPATCH_RUN_STORAGE_KEY, serializeDispatchRuns(runs));
  } catch {
    // Local storage may be unavailable in hardened renderer contexts.
  }
}

export function getDispatchRunStorage(globalObject = globalThis) {
  try {
    return globalObject?.localStorage || null;
  } catch {
    return null;
  }
}
