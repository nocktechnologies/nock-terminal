const {
  errorPayload,
  validateTerminalCreatePayload,
} = require('./ipc-validators');
const { sanitizeDevRoots } = require('./security-utils');

function safePayload(payload) {
  return payload && typeof payload === 'object' ? payload : {};
}

function isTerminalId(value) {
  return typeof value === 'string' && value.length > 0;
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function profileProjectPath(payload, allowedRoots) {
  if (typeof payload?.cwd === 'string' && payload.cwd) return payload.cwd;
  return allowedRoots[0] || '';
}

function registerTerminalIPC({
  ipcMain,
  terminalManager,
  projectProfiles,
  getAllowedProjectRoots,
  getSettingsSnapshot,
  onTerminalLaunched,
}) {
  ipcMain.handle('terminal:create', async (_, payload) => {
    const allowedRoots = sanitizeDevRoots(getAllowedProjectRoots());
    const settings = getSettingsSnapshot();
    const projectPath = profileProjectPath(payload, allowedRoots);
    const profile = projectPath ? projectProfiles.get(projectPath) : {};
    const validated = validateTerminalCreatePayload(payload, {
      allowedRoots,
      settings,
      profile,
    });
    if (!validated.ok) return errorPayload(validated);

    const { id, cwd, shell: shellPath, shellArgs, envVars } = validated.value;
    const result = terminalManager.create(id, cwd, {
      shell: shellPath,
      shellArgs,
      envVars,
    });
    // Opening a terminal in a repo is the explicit trust signal that enables
    // git pull/push/fetch on it (Nock #8663). Best-effort — never block the
    // terminal on trust bookkeeping.
    if (result && result.success && cwd && typeof onTerminalLaunched === 'function') {
      try {
        onTerminalLaunched(cwd);
      } catch {
        // ignore: trust marking must not break terminal creation
      }
    }
    return result;
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

  ipcMain.handle('terminal:list', () => terminalManager.listTerminals());

  // Reap orphaned PTYs (dead root pid, or alive-but-not-in-renderer past a grace
  // window). Options are sanitized here; reapStaleTerminals re-validates too.
  ipcMain.handle('terminal:reapStale', (_, payload) => {
    const opts = safePayload(payload);
    const liveTerminalIds = Array.isArray(opts.liveTerminalIds)
      ? opts.liveTerminalIds.filter(isTerminalId)
      : [];
    const reapOptions = { liveTerminalIds };
    if (isPositiveInteger(opts.graceMs)) reapOptions.graceMs = opts.graceMs;
    if (Number.isFinite(opts.rendererStartedAt)) reapOptions.rendererStartedAt = opts.rendererStartedAt;
    return terminalManager.reapStaleTerminals(reapOptions);
  });
}

module.exports = {
  registerTerminalIPC,
};
