const {
  errorPayload,
  validateProfileSavePayload,
  validatePromptSavePayload,
} = require('./ipc-validators');

function rendererSaveError(validated) {
  const error = errorPayload(validated);
  return { ...error, message: error.error };
}

function registerLocalDataIPC({
  ipcMain,
  fileService,
  projectProfiles,
  promptStore,
  sessionHistory,
}) {
  ipcMain.handle('profiles:get', (_, projectPath) => {
    return projectProfiles.get(projectPath);
  });

  ipcMain.handle('profiles:save', (_, payload) => {
    const validated = validateProfileSavePayload(payload, {
      isAllowedPath: candidate => fileService.isAllowedPath(candidate),
    });
    if (!validated.ok) return rendererSaveError(validated);
    return projectProfiles.save(validated.value.projectPath, validated.value.profile);
  });

  ipcMain.handle('profiles:delete', (_, projectPath) => {
    return projectProfiles.delete(projectPath);
  });

  ipcMain.handle('profiles:list', () => {
    return projectProfiles.list();
  });

  ipcMain.handle('sessionHistory:list', () => {
    return sessionHistory.list();
  });

  ipcMain.handle('sessionHistory:getOutput', (_, { startTime, tabId }) => {
    return sessionHistory.getOutput(startTime, tabId);
  });

  ipcMain.handle('sessionHistory:start', (_, { tabId, metadata }) => {
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
