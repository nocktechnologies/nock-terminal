const path = require('path');

const { isPathWithinRoots, sanitizeDevRoots, sanitizeStringList } = require('./security-utils');
const { normalizeSettingValue } = require('./settings-utils');

const VALIDATION_CODE = 'IPC_VALIDATION_ERROR';
const MAX_PATH_LENGTH = 2000;
const MAX_FILE_WRITE_BYTES = 2 * 1024 * 1024;

function ok(value) {
  return { ok: true, value };
}

function invalid(message, details) {
  return {
    ok: false,
    error: {
      code: VALIDATION_CODE,
      message,
      ...(details ? { details } : {}),
    },
  };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeString(value, { maxLength = 1000, trim = true, allowEmpty = true } = {}) {
  if (typeof value !== 'string') return null;
  const normalized = trim ? value.trim() : value;
  if (!allowEmpty && !normalized) return null;
  if (normalized.length > maxLength) return null;
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(normalized)) return null;
  return normalized;
}

function normalizePathString(value, { allowEmpty = false } = {}) {
  const normalized = normalizeString(value, { maxLength: MAX_PATH_LENGTH, allowEmpty });
  return normalized || null;
}

function normalizeId(value) {
  const normalized = normalizeString(value, { maxLength: 200, allowEmpty: false });
  if (!normalized || !/^[A-Za-z0-9_.:-]+$/.test(normalized)) return null;
  return normalized;
}

function normalizeShellPath(value) {
  const normalized = normalizeString(value, { maxLength: 1000 });
  if (normalized == null) return null;
  if (!normalized) return '';

  const base = normalized.split(/[\\/]/).pop().toLowerCase();
  const allowedNames = process.platform === 'win32'
    ? new Set(['pwsh.exe', 'powershell.exe', 'cmd.exe', 'wsl.exe', 'pwsh', 'powershell', 'cmd', 'wsl'])
    : new Set(['zsh', 'bash', 'fish', 'dash', 'sh']);
  const hasPathSeparator = /[\\/]/.test(normalized);

  if (!allowedNames.has(base)) return null;
  if (process.platform !== 'win32' && !normalized.startsWith('/')) return null;
  if (process.platform === 'win32' && !hasPathSeparator && !allowedNames.has(normalized.toLowerCase())) return null;

  return normalized;
}

function normalizeShellArgs(value) {
  const normalized = normalizeString(value, { maxLength: 1000, trim: false });
  if (normalized == null) return null;
  if (/[\r\n]/.test(normalized)) return null;
  return normalized;
}

function normalizeEnvVars(value) {
  const normalized = normalizeString(value, { maxLength: 20000, trim: false });
  if (normalized == null) return null;
  return normalized;
}

function pickTrustedValue(requested, trustedValues, fallback) {
  const trusted = trustedValues.filter(value => typeof value === 'string' && value !== '');
  if (requested !== undefined) {
    if (requested === '' && fallback === '') return '';
    if (!trusted.includes(requested)) return null;
    return requested;
  }
  return fallback;
}

function validateAllowedPath(label, filePath, context = {}) {
  const resolved = path.resolve(filePath);
  if (typeof context.isAllowedPath === 'function' && !context.isAllowedPath(resolved)) {
    return invalid(`${label} is outside allowed project roots`);
  }
  return ok(resolved);
}

function validateTerminalCreatePayload(payload, context = {}) {
  if (!isPlainObject(payload)) return invalid('terminal:create payload must be an object');

  const id = normalizeId(payload.id);
  if (!id) return invalid('terminal:create id must be a safe non-empty string');

  const allowedRoots = sanitizeDevRoots(context.allowedRoots || []);
  if (allowedRoots.length === 0) return invalid('terminal:create has no configured project roots');

  const cwdInput = payload.cwd === undefined || payload.cwd === null || payload.cwd === ''
    ? allowedRoots[0]
    : normalizePathString(payload.cwd);
  if (!cwdInput) return invalid('terminal:create cwd must be a non-empty path string');
  if (!isPathWithinRoots(cwdInput, allowedRoots)) {
    return invalid('terminal:create cwd is outside allowed project roots');
  }
  const cwd = path.resolve(cwdInput);

  const settings = isPlainObject(context.settings) ? context.settings : {};
  const profile = isPlainObject(context.profile) ? context.profile : {};

  const profileShell = normalizeShellPath(profile.defaultShell || '');
  const settingsShell = normalizeShellPath(settings.defaultShell || '');
  if (profileShell == null || settingsShell == null) {
    return invalid('terminal:create configured shell is not trusted');
  }

  const requestedShell = payload.shell === undefined || payload.shell === null || payload.shell === ''
    ? undefined
    : normalizeShellPath(payload.shell);
  if (requestedShell === null) return invalid('terminal:create shell is not trusted');

  const shellFallback = profileShell || settingsShell || '';
  const shell = pickTrustedValue(requestedShell, [profileShell, settingsShell, ''], shellFallback);
  if (shell == null) return invalid('terminal:create shell must match configured settings or profile');

  const profileArgs = normalizeShellArgs(profile.shellArgs || '');
  const settingsArgs = normalizeShellArgs(settings.shellArgs || '');
  if (profileArgs == null || settingsArgs == null) {
    return invalid('terminal:create configured shell args are invalid');
  }

  const requestedArgs = payload.shellArgs === undefined || payload.shellArgs === null
    ? undefined
    : normalizeShellArgs(payload.shellArgs);
  if (requestedArgs === null) return invalid('terminal:create shell args are invalid');

  const shellArgsFallback = profileArgs || settingsArgs || '';
  const shellArgs = pickTrustedValue(requestedArgs, [profileArgs, settingsArgs, ''], shellArgsFallback);
  if (shellArgs == null) return invalid('terminal:create shell args must match configured settings or profile');

  const profileEnvVars = normalizeEnvVars(profile.envVars || '');
  if (profileEnvVars == null) return invalid('terminal:create configured environment variables are invalid');
  const requestedEnvVars = payload.envVars === undefined || payload.envVars === null
    ? undefined
    : normalizeEnvVars(payload.envVars);
  if (requestedEnvVars === null) return invalid('terminal:create environment variables are invalid');

  const envVars = pickTrustedValue(requestedEnvVars, [profileEnvVars, ''], profileEnvVars || '');
  if (envVars == null) {
    return invalid('terminal:create environment variables must match the project profile');
  }

  return ok({
    id,
    cwd,
    shell: shell || undefined,
    shellArgs,
    envVars,
  });
}

function validateSettingsSetPayload(payload) {
  if (!isPlainObject(payload)) return invalid('settings:set payload must be an object');
  const key = normalizeString(payload.key, { maxLength: 100, allowEmpty: false });
  if (!key) return invalid('settings:set key must be a non-empty string');

  const normalized = normalizeSettingValue(key, payload.value);
  if (!normalized.ok) return invalid(`settings:set rejected invalid value for ${key}`);

  return ok({ key, value: normalized.value });
}

function sanitizeProfile(profile) {
  if (!isPlainObject(profile)) return null;

  const result = {};
  const stringFields = {
    claudeCommand: 1000,
    codexCommand: 1000,
    geminiCommand: 1000,
    customAgentCommand: 1000,
    notes: 5000,
  };

  for (const [key, maxLength] of Object.entries(stringFields)) {
    if (profile[key] === undefined) continue;
    const value = normalizeString(profile[key], { maxLength });
    if (value == null) return null;
    result[key] = value;
  }

  if (profile.defaultAgent !== undefined) {
    const defaultAgent = normalizeString(profile.defaultAgent, { maxLength: 40, allowEmpty: false });
    if (!['claude', 'codex', 'gemini', 'custom'].includes(defaultAgent)) return null;
    result.defaultAgent = defaultAgent;
  }

  if (profile.defaultShell !== undefined) {
    const defaultShell = normalizeShellPath(profile.defaultShell);
    if (defaultShell == null) return null;
    result.defaultShell = defaultShell;
  }

  if (profile.shellArgs !== undefined) {
    const shellArgs = normalizeShellArgs(profile.shellArgs);
    if (shellArgs == null) return null;
    result.shellArgs = shellArgs;
  }

  if (profile.envVars !== undefined) {
    const envVars = normalizeEnvVars(profile.envVars);
    if (envVars == null) return null;
    result.envVars = envVars;
  }

  return result;
}

function validateProfileSavePayload(payload, context = {}) {
  if (!isPlainObject(payload)) return invalid('profiles:save payload must be an object');
  const projectPathInput = normalizePathString(payload.projectPath);
  if (!projectPathInput) return invalid('profiles:save projectPath must be a non-empty path string');
  const projectPath = path.resolve(projectPathInput);
  if (typeof context.isAllowedPath === 'function' && !context.isAllowedPath(projectPath)) {
    return invalid('profiles:save projectPath is outside allowed project roots');
  }

  const profile = sanitizeProfile(payload.profile);
  if (!profile) return invalid('profiles:save profile did not match the expected schema');

  return ok({ projectPath, profile });
}

function validateProjectLookupPath(projectPath, context = {}) {
  const projectPathInput = normalizePathString(projectPath);
  if (!projectPathInput) return invalid('projectPath must be a non-empty path string');
  const resolved = path.resolve(projectPathInput);
  if (typeof context.isAllowedPath === 'function' && !context.isAllowedPath(resolved)) {
    return invalid('projectPath is outside allowed project roots');
  }
  return ok(resolved);
}

function validatePromptSavePayload(payload) {
  if (!isPlainObject(payload)) return invalid('prompts:save payload must be an object');
  const id = payload.id === undefined || payload.id === null || payload.id === ''
    ? ''
    : normalizeString(payload.id, { maxLength: 50, allowEmpty: false });
  if (id == null || (id && !/^[A-Za-z0-9_-]+$/.test(id))) {
    return invalid('prompts:save id must contain only letters, numbers, dashes, or underscores');
  }
  if (!isPlainObject(payload.data)) return invalid('prompts:save data must be an object');

  const title = payload.data.title === undefined
    ? ''
    : normalizeString(payload.data.title, { maxLength: 200 });
  const body = payload.data.body === undefined
    ? ''
    : normalizeString(payload.data.body, { maxLength: 20000, trim: false });
  if (title == null) return invalid('prompts:save title must be a string');
  if (body == null) return invalid('prompts:save body must be a string');

  const tags = sanitizeStringList(payload.data.tags || [], { maxItems: 20, maxLength: 40 });
  return ok({ id, data: { title, tags, body } });
}

function safeAgentName(value) {
  const normalized = normalizeString(String(value || '').toLowerCase(), { maxLength: 100, allowEmpty: false });
  return normalized && /^[a-z0-9_-]+$/.test(normalized) ? normalized : '';
}

function safeRuntime(value) {
  const normalized = normalizeString(String(value || '').toLowerCase(), { maxLength: 40, allowEmpty: false });
  return ['codex', 'deepseek'].includes(normalized) ? normalized : '';
}

function sanitizeDispatchText(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, 12000);
}

function validateDispatchPayload(payload, operation) {
  if (!isPlainObject(payload)) return invalid(`${operation} payload must be an object`);

  const agentName = safeAgentName(payload.agentName);
  const runtime = safeRuntime(payload.runtime);
  const taskDescription = sanitizeDispatchText(payload.taskDescription);
  if (!agentName) return invalid(`${operation} requires a valid agentName`);
  if (!runtime) return invalid(`${operation} requires a valid runtime`);
  if (!taskDescription) return invalid(`${operation} requires a taskDescription`);

  const requestId = payload.requestId === undefined
    ? undefined
    : normalizeString(payload.requestId, { maxLength: 120, allowEmpty: true });
  if (requestId !== undefined && requestId && !/^[A-Za-z0-9_-]+$/.test(requestId)) {
    return invalid(`${operation} requestId contains unsafe characters`);
  }

  const targetRepo = payload.targetRepo === undefined ? '' : normalizeString(payload.targetRepo, { maxLength: 1000 });
  const projectName = payload.projectName === undefined ? '' : normalizeString(payload.projectName, { maxLength: 200 });
  const scriptPath = payload.scriptPath === undefined ? '' : normalizeString(payload.scriptPath, { maxLength: 1000 });
  if (targetRepo == null || projectName == null || scriptPath == null) {
    return invalid(`${operation} contains invalid optional string fields`);
  }

  return ok({
    agentName,
    runtime,
    taskDescription,
    targetRepo,
    projectName,
    ...(requestId ? { requestId } : {}),
    scriptPath,
    agentBound: payload.agentBound === true,
  });
}

function validateDispatchCreatePayload(payload) {
  return validateDispatchPayload(payload, 'dispatch:createPayload');
}

function validateDispatchBrokeredPayload(payload) {
  const validated = validateDispatchPayload(payload, 'dispatch:brokered');
  if (!validated.ok) return validated;

  const brokerAgent = payload.brokerAgent === undefined
    ? ''
    : safeAgentName(payload.brokerAgent);
  if (payload.brokerAgent !== undefined && !brokerAgent) {
    return invalid('dispatch:brokered requires a valid brokerAgent');
  }

  const priority = payload.priority === undefined
    ? ''
    : normalizeString(payload.priority, { maxLength: 40, allowEmpty: true });
  if (priority == null) {
    return invalid('dispatch:brokered contains invalid optional string fields');
  }

  return ok({
    ...validated.value,
    ...(brokerAgent ? { brokerAgent } : {}),
    ...(priority ? { priority } : {}),
  });
}

function validateDispatchStatusUpdatesPayload(payload) {
  if (!isPlainObject(payload)) return invalid('dispatch:statusUpdates payload must be an object');

  const seen = new Set();
  const requestIds = [];
  for (const value of Array.isArray(payload.requestIds) ? payload.requestIds : []) {
    const requestId = normalizeString(value, { maxLength: 120, allowEmpty: false });
    if (!requestId || !/^[A-Za-z0-9_-]+$/.test(requestId) || seen.has(requestId)) continue;
    seen.add(requestId);
    requestIds.push(requestId);
    if (requestIds.length >= 50) break;
  }
  if (requestIds.length === 0) {
    return invalid('dispatch:statusUpdates requires at least one valid requestId');
  }

  const agentName = payload.agentName === undefined
    ? 'nock-terminal'
    : safeAgentName(payload.agentName);
  if (!agentName) return invalid('dispatch:statusUpdates requires a valid agentName');

  const rawLimit = Number(payload.limit);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(100, Math.max(1, Math.floor(rawLimit)))
    : 20;

  return ok({
    requestIds,
    agentName,
    limit,
    unreadOnly: payload.unreadOnly === true,
  });
}

function validateFilesPayload(operation, payload, context = {}) {
  switch (operation) {
    case 'tree':
    case 'read':
    case 'stat': {
      const filePath = normalizePathString(payload);
      if (!filePath) return invalid(`files:${operation} path must be a non-empty string`);
      return validateAllowedPath(`files:${operation} path`, filePath, context);
    }
    case 'gitStatus': {
      const dirPath = normalizePathString(payload);
      if (!dirPath) return invalid('files:gitStatus dirPath must be a non-empty string');
      return validateAllowedPath('files:gitStatus dirPath', dirPath, context);
    }
    case 'write': {
      if (!isPlainObject(payload)) return invalid('files:write payload must be an object');
      const filePath = normalizePathString(payload.filePath);
      if (!filePath) return invalid('files:write filePath must be a non-empty string');
      if (typeof payload.content !== 'string') return invalid('files:write content must be a string');
      if (Buffer.byteLength(payload.content, 'utf8') > MAX_FILE_WRITE_BYTES) {
        return invalid('files:write content exceeds the 2 MB IPC limit');
      }
      const allowedPath = validateAllowedPath('files:write filePath', filePath, context);
      if (!allowedPath.ok) return allowedPath;
      return ok({ filePath, content: payload.content });
    }
    case 'gitOp': {
      if (!isPlainObject(payload)) return invalid('files:gitOp payload must be an object');
      const dirPath = normalizePathString(payload.dirPath);
      const op = normalizeString(payload.operation, { maxLength: 20, allowEmpty: false });
      if (!dirPath) return invalid('files:gitOp dirPath must be a non-empty string');
      if (!['pull', 'push', 'fetch'].includes(op)) return invalid('files:gitOp operation is not allowed');
      const allowedPath = validateAllowedPath('files:gitOp dirPath', dirPath, context);
      if (!allowedPath.ok) return allowedPath;
      return ok({ dirPath, operation: op });
    }
    case 'watch': {
      const dirPath = normalizePathString(payload);
      if (!dirPath) return invalid('files:watch dirPath must be a non-empty string');
      return validateAllowedPath('files:watch dirPath', dirPath, context);
    }
    default:
      return invalid(`files:${operation} is not a known operation`);
  }
}

function errorPayload(result) {
  const message = result?.error?.message || 'Invalid IPC payload';
  return {
    success: false,
    error: message,
    code: result?.error?.code || VALIDATION_CODE,
  };
}

module.exports = {
  errorPayload,
  validateDispatchBrokeredPayload,
  validateDispatchCreatePayload,
  validateDispatchStatusUpdatesPayload,
  validateFilesPayload,
  validateProfileSavePayload,
  validateProjectLookupPath,
  validatePromptSavePayload,
  validateSettingsSetPayload,
  validateTerminalCreatePayload,
};
