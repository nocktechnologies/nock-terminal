const DEFAULT_NOCKCC_ACTIVITY = Object.freeze({
  activeProjectCount: 0,
  activeClaudeSessionIds: Object.freeze([]),
  activeAgentSessionIds: Object.freeze([]),
});

function sanitizeList(value) {
  if (!Array.isArray(value)) return [];
  const sanitized = [];
  for (let index = 0; index < value.length && sanitized.length < 100; index += 1) {
    const item = value[index];
    if (typeof item === 'string' && item.length <= 200) {
      sanitized.push(item);
    }
  }
  return sanitized;
}

function sanitizeNockCCActivity(activity = {}) {
  const safeActivity = activity && typeof activity === 'object' ? activity : {};
  const activeProjectCount = Number.isFinite(safeActivity.activeProjectCount)
    ? Math.max(0, Math.round(safeActivity.activeProjectCount))
    : 0;

  return {
    activeProjectCount,
    activeClaudeSessionIds: sanitizeList(safeActivity.activeClaudeSessionIds),
    activeAgentSessionIds: sanitizeList(safeActivity.activeAgentSessionIds),
  };
}

function cloneActivity(activity) {
  return {
    activeProjectCount: activity.activeProjectCount,
    activeClaudeSessionIds: [...activity.activeClaudeSessionIds],
    activeAgentSessionIds: [...activity.activeAgentSessionIds],
  };
}

function createNockCCActivityIPC({
  ipcMain,
  nockccClient,
  machine = process.platform,
  appVersion = '',
  heartbeatIntervalMs = 60_000,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
}) {
  let activity = cloneActivity(DEFAULT_NOCKCC_ACTIVITY);
  let heartbeatInterval = null;

  function updateActivity(nextActivity) {
    activity = sanitizeNockCCActivity(nextActivity);
    return cloneActivity(activity);
  }

  ipcMain.on('nockcc:updateActivity', (_, nextActivity = {}) => {
    updateActivity(nextActivity);
  });

  return {
    getActivity() {
      return cloneActivity(activity);
    },

    updateActivity,

    start() {
      if (heartbeatInterval) {
        clearIntervalFn(heartbeatInterval);
        heartbeatInterval = null;
        nockccClient?.endSession();
      }
      if (!nockccClient) return null;
      nockccClient.startSession({ machine, appVersion });
      heartbeatInterval = setIntervalFn(() => {
        nockccClient.heartbeat(activity);
      }, heartbeatIntervalMs);
      return heartbeatInterval;
    },

    stop() {
      if (heartbeatInterval) {
        clearIntervalFn(heartbeatInterval);
        heartbeatInterval = null;
      }
      nockccClient?.endSession();
    },
  };
}

module.exports = {
  createNockCCActivityIPC,
  sanitizeNockCCActivity,
};
