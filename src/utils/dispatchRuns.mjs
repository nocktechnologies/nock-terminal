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
  statusMessageId: 200,
  statusSource: 100,
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

function cleanTimestampLike(value, fallback = 0) {
  if (Number.isFinite(value) && value > 0) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return fallback;
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

function normalizeDispatchRunUpdate(update) {
  if (!isPlainObject(update)) return null;
  const requestId = cleanString(update.requestId, STRING_FIELDS.requestId);
  if (!requestId) return null;
  return {
    requestId,
    status: normalizeDispatchStatus(update.status),
    statusMessage: cleanString(update.statusMessage, STRING_FIELDS.statusMessage),
    statusMessageId: cleanString(update.messageId || update.statusMessageId, STRING_FIELDS.statusMessageId),
    statusSource: cleanString(update.source || update.statusSource, STRING_FIELDS.statusSource),
    updatedAt: cleanTimestampLike(update.updatedAt || update.createdAt, 0),
  };
}

export function applyDispatchRunUpdates(runs, updates, { now = Date.now() } = {}) {
  if (!Array.isArray(runs) || !Array.isArray(updates) || updates.length === 0) return runs;

  let changed = false;
  let nextRuns = runs;

  for (const rawUpdate of updates) {
    const update = normalizeDispatchRunUpdate(rawUpdate);
    if (!update) continue;

    nextRuns = nextRuns.map((run) => {
      if (run?.requestId !== update.requestId) return run;
      if (!canTransitionDispatchStatus(run.status, update.status)) return run;

      const next = { ...run };
      let runChanged = false;
      if (next.status !== update.status) {
        next.status = update.status;
        runChanged = true;
      }
      if (update.statusMessage && next.statusMessage !== update.statusMessage) {
        next.statusMessage = update.statusMessage;
        runChanged = true;
      }
      if (update.statusMessageId && next.statusMessageId !== update.statusMessageId) {
        next.statusMessageId = update.statusMessageId;
        runChanged = true;
      }
      if (update.statusSource && next.statusSource !== update.statusSource) {
        next.statusSource = update.statusSource;
        runChanged = true;
      }
      if (update.status === 'failed' && update.statusMessage && !next.error) {
        next.error = update.statusMessage;
        runChanged = true;
      }
      if (!runChanged) return run;

      const normalizedNext = normalizeDispatchRun({
        ...next,
        updatedAt: update.updatedAt || now,
      });
      if (JSON.stringify(normalizedNext) === JSON.stringify(run)) return run;
      changed = true;
      return normalizedNext;
    });
  }

  return changed ? normalizeDispatchRunList(nextRuns) : runs;
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
