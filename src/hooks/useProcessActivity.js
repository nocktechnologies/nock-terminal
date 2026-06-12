import { useState, useEffect, useCallback } from 'react';

// Per-tab process status and terminal output recency, plus the NockCC
// activity heartbeat derived from them.
export default function useProcessActivity({ tabs }) {
  const [processStatus, setProcessStatus] = useState({});
  const [lastDataTimestamps, setLastDataTimestamps] = useState({});

  useEffect(() => {
    const cleanup = window.nockTerminal.process.onStatus((status) => {
      setProcessStatus(prev => ({ ...prev, [status.tabId]: status }));
    });
    return cleanup;
  }, []);

  useEffect(() => {
    const cleanup = window.nockTerminal.terminal.onData((id) => {
      setLastDataTimestamps(prev => ({ ...prev, [id]: Date.now() }));
    });
    return cleanup;
  }, []);

  useEffect(() => {
    const projectPaths = new Set(tabs.map(tab => tab.cwd).filter(Boolean));
    const activeAgentSessionIds = [];
    const activeClaudeSessionIds = [];

    for (const tab of tabs) {
      const status = processStatus[tab.id];
      const activeAgents = Array.isArray(status?.activeAgents) ? [...status.activeAgents] : [];
      if (status?.hasClaude && !activeAgents.includes('claude')) {
        activeAgents.push('claude');
      }

      for (const agentId of activeAgents) {
        activeAgentSessionIds.push(`${agentId}:${tab.id}`);
        if (agentId === 'claude') activeClaudeSessionIds.push(tab.id);
      }
    }

    window.nockTerminal.nockcc?.updateActivity({
      activeProjectCount: projectPaths.size,
      activeClaudeSessionIds,
      activeAgentSessionIds,
    });
  }, [tabs, processStatus]);

  const getSessionStatus = useCallback((tabId) => {
    const proc = processStatus[tabId];
    const lastData = lastDataTimestamps[tabId] || 0;
    const hasAgent = proc?.hasClaude || (Array.isArray(proc?.activeAgents) && proc.activeAgents.length > 0);
    if (!hasAgent) return 'inactive';
    if (Date.now() - lastData < 2000) return 'active';
    return 'ready';
  }, [processStatus, lastDataTimestamps]);

  return { processStatus, lastDataTimestamps, getSessionStatus };
}
