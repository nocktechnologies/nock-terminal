function nonEmptyPath(value) {
  return typeof value === 'string' && value.trim() ? value : null;
}

function isProjectLikeSession(session) {
  if (!nonEmptyPath(session?.path)) return false;
  if (session?.kind === 'agent') return false;
  if (typeof session?.id === 'string' && session.id.startsWith('dev:')) return true;
  if (typeof session?.branch === 'string' && session.branch.trim()) return true;
  return false;
}

export function resolveActiveProjectPath(activeTab, sessions = []) {
  const sessionList = Array.isArray(sessions) ? sessions : [];
  const activeTabPath = nonEmptyPath(activeTab?.cwd);
  if (activeTabPath) {
    const activeSession = sessionList.find(session => nonEmptyPath(session?.path) === activeTabPath);
    if (!activeSession || isProjectLikeSession(activeSession)) return activeTabPath;
  }

  const fallback = sessionList.find(isProjectLikeSession);
  return nonEmptyPath(fallback?.path);
}

export { isProjectLikeSession };
