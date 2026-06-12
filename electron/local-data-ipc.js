const {
  errorPayload,
  validateProfileSavePayload,
  validateProjectLookupPath,
  validatePromptSavePayload,
} = require('./ipc-validators');

function rendererSaveError(validated) {
  const error = errorPayload(validated);
  return { ...error, message: error.error };
}

function safePayload(payload) {
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
}

function registerLocalDataIPC({
  ipcMain,
  fileService,
  projectProfiles,
  promptStore,
  sessionHistory,
}) {
  const lookupContext = { isAllowedPath: candidate => fileService.isAllowedPath(candidate) };

  ipcMain.handle('profiles:get', (_, projectPath) => {
    const validated = validateProjectLookupPath(projectPath, lookupContext);
    if (!validated.ok) return null;
    return projectProfiles.get(validated.value);
  });

  ipcMain.handle('profiles:save', (_, payload) => {
    const validated = validateProfileSavePayload(payload, {
      isAllowedPath: candidate => fileService.isAllowedPath(candidate),
    });
    if (!validated.ok) return rendererSaveError(validated);
    return projectProfiles.save(validated.value.projectPath, validated.value.profile);
  });

  ipcMain.handle('profiles:delete', (_, projectPath) => {
    const validated = validateProjectLookupPath(projectPath, lookupContext);
    if (!validated.ok) return null;
    return projectProfiles.delete(validated.value);
  });

  ipcMain.handle('profiles:list', () => {
    return projectProfiles.list();
  });

  ipcMain.handle('sessionHistory:list', () => {
    return sessionHistory.list();
  });

  ipcMain.handle('sessionHistory:getOutput', (_, payload) => {
    const { startTime, tabId } = safePayload(payload);
    if (typeof startTime !== 'number' || !Number.isFinite(startTime)) return null;
    if (typeof tabId !== 'string' || tabId === '') return null;
    return sessionHistory.getOutput(startTime, tabId);
  });

  ipcMain.handle('sessionHistory:start', (_, payload) => {
    const { tabId, metadata } = safePayload(payload);
    if (!tabId) return null;
    return sessionHistory.startSession(tabId, metadata);
  });

  ipcMain.handle('prompts:list', () => {
    return promptStore.list();
  });

  ipcMain.handle('prompts:get', (_, id) => {
    return promptStore.get(id);
  });

  ipcMain.handle('prompts:save', (_, payload) => {
    const validated = validatePromptSavePayload(payload);
    if (!validated.ok) return rendererSaveError(validated);
    return promptStore.save(validated.value.id, validated.value.data);
  });

  ipcMain.handle('prompts:delete', (_, id) => {
    return promptStore.delete(id);
  });
}

module.exports = {
  registerLocalDataIPC,
};
