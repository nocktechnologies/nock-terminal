function safePayload(payload) {
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
}

function registerTelegramIPC({
  ipcMain,
  telegramNotifier,
}) {
  ipcMain.handle('telegram:test', async () => {
    return telegramNotifier.test();
  });

  ipcMain.handle('telegram:notify', async (_, payload) => {
    const { eventType, details } = safePayload(payload);
    return telegramNotifier.notify(eventType, details);
  });
}

module.exports = {
  registerTelegramIPC,
};
