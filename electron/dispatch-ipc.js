const {
  errorPayload,
  validateDispatchBrokeredPayload,
  validateDispatchCreatePayload,
} = require('./ipc-validators');

function dispatchServiceError(error, fallbackMessage) {
  return {
    success: false,
    error: error.message || fallbackMessage,
  };
}

function registerDispatchIPC({
  ipcMain,
  agentDispatchService,
}) {
  ipcMain.handle('dispatch:brokered', async (_, payload) => {
    const validated = validateDispatchBrokeredPayload(payload);
    if (!validated.ok) return errorPayload(validated);
    try {
      return await agentDispatchService.sendBrokered(validated.value);
    } catch (err) {
      return dispatchServiceError(err, 'Failed to send brokered dispatch request');
    }
  });

  ipcMain.handle('dispatch:createPayload', async (_, payload) => {
    const validated = validateDispatchCreatePayload(payload);
    if (!validated.ok) return errorPayload(validated);
    try {
      return await agentDispatchService.createPayload(validated.value);
    } catch (err) {
      return dispatchServiceError(err, 'Failed to create dispatch payload');
    }
  });
}

module.exports = {
  registerDispatchIPC,
};
