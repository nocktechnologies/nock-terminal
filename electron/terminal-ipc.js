const {
  errorPayload,
  validateTerminalCreatePayload,
} = require('./ipc-validators');

function safePayload(payload) {
  return payload && typeof payload === 'object' ? payload : {};
}

function isTerminalId(value) {
  return typeof value === 'string' && value.length > 0;
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function registerTerminalIPC({
  ipcMain,
  terminalManager,
  projectProfiles,
  getAllowedProjectRoots,
  getSettingsSnapshot,
}) {
  ipcMain.handle('terminal:create', async (_, payload) => {
    const projectPath = typeof payload?.cwd === 'string' ? payload.cwd : '';
    const profile = projectPath ? projectProfiles.get(projectPath) : {};
    const validated = validateTerminalCreatePayload(payload, {
      allowedRoots: getAllowedProjectRoots(),
      settings: getSettingsSnapshot(),
      profile,
    });
    if (!validated.ok) return errorPayload(validated);

    const { id, cwd, shell: shellPath, shellArgs, envVars } = validated.value;
    return terminalManager.create(id, cwd, {
      shell: shellPath,
      shellArgs,
      envVars,
    });
  });

  ipcMain.on('terminal:write', (_, payload) => {
    const { id, data } = safePayload(payload);
    if (!isTerminalId(id) || typeof data !== 'string') return;
    terminalManager.write(id, data);
  });

  ipcMain.on('terminal:resize', (_, payload) => {
    const { id, cols, rows } = safePayload(payload);
    if (!isTerminalId(id) || !isPositiveInteger(cols) || !isPositiveInteger(rows)) return;
    terminalManager.resize(id, cols, rows);
  });

  ipcMain.on('terminal:destroy', (_, payload) => {
    const { id } = safePayload(payload);
    if (!isTerminalId(id)) return;
    terminalManager.destroy(id);
  });
}

module.exports = {
  registerTerminalIPC,
};
