'use strict';

const path = require('node:path');
const {
  AGENT_ID_RE,
  PERMISSION_PRESETS,
  SUPPORTED_MODELS,
} = require('./managed-agent-blueprint');

const VALIDATION_CODE = 'IPC_VALIDATION_ERROR';
const CONTROL_ACTIONS = new Set(['status', 'pause', 'resume', 'restart', 'rotate', 'steer']);
const SUPERVISE_ACTIONS = new Set(['start', 'stop']);
const PERMISSION_PRESET_NAMES = new Set(Object.keys(PERMISSION_PRESETS));
const SUPPORTED_MODEL_NAMES = new Set(SUPPORTED_MODELS);
const MAX_TEXT_LENGTH = 8192;
const MAX_ROOTS = 16;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function invalid(message) {
  return { ok: false, error: message };
}

function boundedString(value, field, { max = 1000, required = false } = {}) {
  if (typeof value !== 'string') return invalid(`${field} must be a string`);
  const normalized = value.trim();
  if (required && !normalized) return invalid(`${field} is required`);
  if (normalized.length > max || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(normalized)) {
    return invalid(`${field} is too long or contains control characters`);
  }
  return { ok: true, value: normalized };
}

function validateAgentId(value, field = 'agentId') {
  const checked = boundedString(value, field, { max: 64, required: true });
  if (!checked.ok || !AGENT_ID_RE.test(checked.value)) return invalid(`${field} must match ${AGENT_ID_RE}`);
  return checked;
}

function validateRoots(value, field, { required = false } = {}) {
  if (value === undefined || value === null) return required ? invalid(`${field} is required`) : { ok: true, value: [] };
  if (!Array.isArray(value) || value.length > MAX_ROOTS) return invalid(`${field} must be an array of absolute paths`);
  const roots = [];
  for (let index = 0; index < value.length; index += 1) {
    const checked = boundedString(value[index], `${field}[${index}]`, { max: 2000, required: true });
    if (!checked.ok || !path.isAbsolute(checked.value)) return invalid(`${field}[${index}] must be absolute`);
    roots.push(path.resolve(checked.value));
  }
  return { ok: true, value: [...new Set(roots)] };
}

function validateDraft(draft, { update = false } = {}) {
  if (!isPlainObject(draft)) return invalid('agent draft must be an object');
  if (!update || draft.agentId !== undefined || draft.id !== undefined) {
    const id = validateAgentId(draft.agentId ?? draft.id, 'agentId');
    if (!id.ok) return id;
  }
  const displayName = boundedString(draft.displayName ?? draft.name, 'displayName', { max: 120, required: true });
  if (!displayName.ok) return displayName;
  if (draft.model !== undefined) {
    const model = boundedString(draft.model, 'model', { max: 120, required: true });
    if (!model.ok) return model;
    if (!SUPPORTED_MODEL_NAMES.has(model.value)) return invalid('model is not supported by the managed Claude template');
  }
  const preset = draft.permissionPreset ?? draft.permissions?.preset;
  if (preset !== undefined) {
    const checked = boundedString(preset, 'permissionPreset', { max: 32, required: true });
    if (!checked.ok || !PERMISSION_PRESET_NAMES.has(checked.value.toLowerCase())) return invalid('permissionPreset must be supervised, standard, or autonomous');
  }
  const workspace = isPlainObject(draft.workspaces) ? draft.workspaces : {};
  if (draft.workDirectory !== undefined || workspace.workDirectory !== undefined) {
    const workDirectory = boundedString(draft.workDirectory ?? workspace.workDirectory, 'workDirectory', { max: 2000 });
    if (!workDirectory.ok || (workDirectory.value && !path.isAbsolute(workDirectory.value))) return invalid('workDirectory must be absolute');
  }
  const allowed = validateRoots(draft.allowedRoots ?? draft.workspaceRoots ?? workspace.allowedRoots, 'allowedRoots');
  if (!allowed.ok) return allowed;
  const denied = validateRoots(draft.deniedRoots ?? workspace.deniedRoots, 'deniedRoots');
  if (!denied.ok) return denied;
  if (draft.identity !== undefined && !isPlainObject(draft.identity)) return invalid('identity must be an object');
  for (const field of ['agent', 'role', 'partner', 'authority']) {
    const value = draft.identity?.[field] ?? draft[field];
    if (value !== undefined) {
      const checked = boundedString(value, `identity.${field}`, { max: 240, required: true });
      if (!checked.ok) return checked;
    }
  }
  if (draft.purpose !== undefined) {
    const checked = boundedString(draft.purpose, 'purpose', { max: 500 });
    if (!checked.ok) return checked;
  }
  return { ok: true, value: draft };
}

function extractAgentAction(payload, actionSet, label) {
  if (!isPlainObject(payload)) return invalid(`${label} payload must be an object`);
  const id = validateAgentId(payload.agentId);
  if (!id.ok) return id;
  const action = boundedString(payload.action, `${label} action`, { max: 16, required: true });
  if (!action.ok || !actionSet.has(action.value)) return invalid(`${label} action is not supported`);
  return { ok: true, value: { agentId: id.value, action: action.value } };
}

function validateControlPayload(payload) {
  const base = extractAgentAction(payload, CONTROL_ACTIONS, 'managedAgents:control');
  if (!base.ok) return base;
  const params = payload.params === undefined ? {} : payload.params;
  if (!isPlainObject(params)) return invalid('managedAgents:control params must be an object');
  if (base.value.action === 'steer') {
    const text = boundedString(params.text, 'managedAgents:control params.text', { max: MAX_TEXT_LENGTH, required: true });
    if (!text.ok) return text;
    return { ok: true, value: { ...base.value, params: { text: text.value } } };
  }
  if (Object.keys(params).length > 0) return invalid(`${base.value.action} does not accept params`);
  return { ok: true, value: { ...base.value, params: {} } };
}

function validationError(message) {
  return { success: false, error: message, code: VALIDATION_CODE };
}

function serviceError(error, fallback) {
  const message = typeof error?.message === 'string' && error.message ? error.message : fallback;
  return {
    success: false,
    error: message,
    ...(error?.code ? { code: error.code } : {}),
  };
}

function registerManagedAgentIPC({ ipcMain, managedAgentService }) {
  if (!ipcMain || !managedAgentService) throw new TypeError('registerManagedAgentIPC requires ipcMain and managedAgentService');

  ipcMain.handle('managedAgents:prerequisites', async () => {
    try { return await managedAgentService.prerequisites(); } catch (error) { return serviceError(error, 'Failed to inspect managed resident prerequisites'); }
  });

  ipcMain.handle('managedAgents:list', async () => {
    try { return await managedAgentService.list(); } catch (error) { return serviceError(error, 'Failed to list managed agents'); }
  });

  ipcMain.handle('managedAgents:create', async (_, payload) => {
    const checked = validateDraft(payload);
    if (!checked.ok) return validationError(checked.error);
    try { return await managedAgentService.create(checked.value); } catch (error) { return serviceError(error, 'Failed to create managed agent'); }
  });

  ipcMain.handle('managedAgents:update', async (_, payload) => {
    if (!isPlainObject(payload)) return validationError('managedAgents:update payload must be an object');
    const id = validateAgentId(payload.agentId);
    if (!id.ok) return validationError(id.error);
    const checked = validateDraft(payload.draft, { update: true });
    if (!checked.ok) return validationError(checked.error);
    try { return await managedAgentService.update(id.value, checked.value); } catch (error) { return serviceError(error, 'Failed to update managed agent'); }
  });

  ipcMain.handle('managedAgents:validate', async (_, payload) => {
    if (!isPlainObject(payload)) return validationError('managedAgents:validate payload must be an object');
    const id = validateAgentId(payload.agentId);
    if (!id.ok) return validationError(id.error);
    try { return await managedAgentService.validate(id.value); } catch (error) { return serviceError(error, 'Failed to validate managed agent authentication'); }
  });

  ipcMain.handle('managedAgents:authLaunch', async (_, payload) => {
    if (!isPlainObject(payload)) return validationError('managedAgents:authLaunch payload must be an object');
    const id = validateAgentId(payload.agentId);
    if (!id.ok) return validationError(id.error);
    try { return await managedAgentService.authLaunch(id.value); } catch (error) { return serviceError(error, 'Failed to prepare managed agent authentication'); }
  });

  ipcMain.handle('managedAgents:supervise', async (_, payload) => {
    const checked = extractAgentAction(payload, SUPERVISE_ACTIONS, 'managedAgents:supervise');
    if (!checked.ok) return validationError(checked.error);
    try { return await managedAgentService.supervise(checked.value.agentId, checked.value.action); } catch (error) { return serviceError(error, 'Failed to supervise managed agent'); }
  });

  ipcMain.handle('managedAgents:control', async (_, payload) => {
    const checked = validateControlPayload(payload);
    if (!checked.ok) return validationError(checked.error);
    try { return await managedAgentService.control(checked.value.agentId, checked.value.action, checked.value.params); } catch (error) { return serviceError(error, 'Failed to control managed agent'); }
  });
}

module.exports = {
  registerManagedAgentIPC,
};
