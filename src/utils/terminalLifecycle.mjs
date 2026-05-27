export function collectLiveTerminalIds(tabs) {
  const liveIds = new Set();
  if (!Array.isArray(tabs)) return [];

  for (const tab of tabs) {
    if (!tab || typeof tab.id !== 'string' || tab.id.length === 0) continue;
    liveIds.add(tab.id);

    const split = tab.splitContent;
    if (split?.type === 'terminal' && typeof split.id === 'string' && split.id.length > 0) {
      liveIds.add(split.id);
    }
  }

  return Array.from(liveIds);
}

export function summarizeReapedTerminals(reaped) {
  const count = Array.isArray(reaped) ? reaped.length : 0;
  if (count === 0) return 'All running terminals are still attached.';
  if (count === 1) return 'Cleaned 1 stale terminal session.';
  return `Cleaned ${count} stale terminal sessions.`;
}
