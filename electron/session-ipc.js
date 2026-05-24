function safeSessionRoots(sessions) {
  if (!Array.isArray(sessions)) return [];
  return sessions
    .map(session => session?.path)
    .filter(sessionPath => typeof sessionPath === 'string' && sessionPath.length > 0);
}

function registerSessionIPC({
  ipcMain,
  sessionDiscovery,
  fileService,
  fileWatcher,
}) {
  ipcMain.handle('sessions:discover', async () => {
    const sessions = await sessionDiscovery.discover();
    fileService.setGrantedRoots(safeSessionRoots(sessions));
    fileWatcher.revalidate();
    return sessions;
  });
}

module.exports = {
  registerSessionIPC,
  safeSessionRoots,
};
