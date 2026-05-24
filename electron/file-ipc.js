const {
  errorPayload,
  validateFilesPayload,
} = require('./ipc-validators');

function invalidFilePayloadResult(validated) {
  return {
    error: validated.error.message,
    code: validated.error.code,
  };
}

function invalidFileStatResult(validated) {
  return {
    exists: false,
    size: 0,
    mtime: 0,
    ...invalidFilePayloadResult(validated),
  };
}

function registerFileIPC({
  ipcMain,
  fileService,
  fileWatcher,
}) {
  const validateFilePayload = (operation, payload) => validateFilesPayload(operation, payload, {
    isAllowedPath: candidate => fileService.isAllowedPath(candidate),
  });

  ipcMain.handle('files:tree', (_, payload) => {
    const validated = validateFilePayload('tree', payload);
    if (!validated.ok) return invalidFilePayloadResult(validated);
    return fileService.tree(validated.value);
  });

  ipcMain.handle('files:read', (_, payload) => {
    const validated = validateFilePayload('read', payload);
    if (!validated.ok) return invalidFilePayloadResult(validated);
    return fileService.read(validated.value);
  });

  ipcMain.handle('files:write', (_, payload) => {
    const validated = validateFilePayload('write', payload);
    if (!validated.ok) return errorPayload(validated);
    return fileService.write(validated.value.filePath, validated.value.content);
  });

  ipcMain.handle('files:stat', (_, payload) => {
    const validated = validateFilePayload('stat', payload);
    if (!validated.ok) return invalidFileStatResult(validated);
    return fileService.stat(validated.value);
  });

  ipcMain.handle('files:gitStatus', (_, payload) => {
    const validated = validateFilePayload('gitStatus', payload);
    if (!validated.ok) return invalidFilePayloadResult(validated);
    return fileService.gitStatus(validated.value);
  });

  ipcMain.handle('files:gitOp', (_, payload) => {
    const validated = validateFilePayload('gitOp', payload);
    if (!validated.ok) return errorPayload(validated);
    return fileService.gitOp(validated.value.dirPath, validated.value.operation);
  });

  ipcMain.on('files:watch', (_, payload) => {
    const validated = validateFilePayload('watch', payload);
    if (!validated.ok) return;
    fileWatcher.watch(validated.value);
  });

  ipcMain.on('files:stopWatch', () => {
    fileWatcher.stop();
  });
}

module.exports = {
  registerFileIPC,
};
