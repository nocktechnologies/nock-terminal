function safePayload(payload) {
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
}

function sendOllamaStreamChunk(getMainWindow, chunk) {
  getMainWindow()?.webContents?.send('ai:stream', { chunk });
}

function registerOllamaIPC({
  ipcMain,
  ollamaClient,
  getMainWindow,
}) {
  ipcMain.handle('ai:ollama:chat', async (_, payload) => {
    const { model, messages } = safePayload(payload);
    return ollamaClient.chat(model, messages, (chunk) => {
      sendOllamaStreamChunk(getMainWindow, chunk);
    });
  });

  ipcMain.handle('ai:ollama:models', async () => {
    return ollamaClient.listModels();
  });

  ipcMain.handle('ai:ollama:status', async () => {
    return ollamaClient.checkStatus();
  });
}

module.exports = {
  registerOllamaIPC,
  sendOllamaStreamChunk,
};
