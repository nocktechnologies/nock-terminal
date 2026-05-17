export function summarizeFleet({ sessions = [], tabs = [], processStatus = {}, lastDataTimestamps = {}, now = Date.now() } = {}) {
  const safeSessions = Array.isArray(sessions) ? sessions : [];
  const safeTabs = Array.isArray(tabs) ? tabs : [];
  const agentFolders = safeSessions.filter((session) => session.kind === 'agent');
  const repos = safeSessions.filter((session) => session.kind !== 'agent');
  const activeAgentFolders = agentFolders.filter((session) =>
    ['running', 'idle'].includes(session.agent?.lifecycle)
  );
  const staleAgentFolders = agentFolders.filter((session) => session.agent?.lifecycle === 'stale');
  const dirtyRepos = repos.filter((session) => session.dirty);

  const activeAgentProcesses = safeTabs.flatMap((tab) => {
    const status = processStatus?.[tab.id];
    if (!status) return [];
    const activeAgents = Array.isArray(status.activeAgents) ? status.activeAgents : [];
    return status.hasClaude && !activeAgents.includes('claude')
      ? [...activeAgents, 'claude']
      : activeAgents;
  });

  const quietAgentTabs = safeTabs.filter((tab) => {
    const status = processStatus?.[tab.id];
    const activeAgents = Array.isArray(status?.activeAgents) ? status.activeAgents : [];
    const hasAgent = Boolean(status?.hasClaude || activeAgents.length > 0 || tab.launchCommand);
    if (!hasAgent) return false;
    const lastData = Number(lastDataTimestamps?.[tab.id] || 0);
    return lastData > 0 && now - lastData > 5 * 60 * 1000;
  });

  return {
    agents: agentFolders.length,
    repos: repos.length,
    activeAgentFolders: activeAgentFolders.length,
    staleAgentFolders: staleAgentFolders.length,
    dirtyRepos: dirtyRepos.length,
    terminals: safeTabs.length,
    activeAgentProcesses: activeAgentProcesses.length,
    quietAgentTabs: quietAgentTabs.length,
  };
}

export function orderTaskTargets(sessions = [], activeProjectPath = '') {
  return [...(Array.isArray(sessions) ? sessions : [])].sort((a, b) => {
    const activeA = a.path === activeProjectPath ? 1 : 0;
    const activeB = b.path === activeProjectPath ? 1 : 0;
    if (activeA !== activeB) return activeB - activeA;

    const agentA = a.kind === 'agent' ? 1 : 0;
    const agentB = b.kind === 'agent' ? 1 : 0;
    if (agentA !== agentB) return agentB - agentA;

    const statusRank = { active: 3, recent: 2, inactive: 1 };
    const rankA = statusRank[a.status] || 0;
    const rankB = statusRank[b.status] || 0;
    if (rankA !== rankB) return rankB - rankA;

    return String(a.name || '').localeCompare(String(b.name || ''));
  });
}
