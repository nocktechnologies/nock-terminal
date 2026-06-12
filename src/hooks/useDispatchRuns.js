import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  MAX_DISPATCH_RUNS,
  applyDispatchRunUpdates,
  createDispatchRun,
  getDispatchRunStorage,
  isTerminalDispatchStatus,
  readDispatchRunsFromStorage,
  writeDispatchRunsToStorage,
} from '../utils/dispatchRuns.mjs';
import { createTabId } from '../utils/tabOps.mjs';

// Dispatch-run telemetry: localStorage-backed history plus the 30s NockCC
// status_update poll for non-terminal brokered requests.
export default function useDispatchRuns() {
  const [dispatchRuns, setDispatchRuns] = useState(() => readDispatchRunsFromStorage(getDispatchRunStorage(window)));

  useEffect(() => {
    const storage = getDispatchRunStorage(window);
    if (storage) {
      writeDispatchRunsToStorage(storage, dispatchRuns);
    }
  }, [dispatchRuns]);

  const recordDispatchRun = useCallback((run) => {
    setDispatchRuns(prev => [
      createDispatchRun(run, { id: createTabId('dispatch') }),
      ...prev,
    ].slice(0, MAX_DISPATCH_RUNS));
  }, []);

  const activeBrokeredDispatchRequestKey = useMemo(() => {
    const requestIds = [];
    const seen = new Set();
    for (const run of dispatchRuns) {
      if (run.mode !== 'brokered' || !run.requestId || isTerminalDispatchStatus(run.status)) continue;
      if (seen.has(run.requestId)) continue;
      seen.add(run.requestId);
      requestIds.push(run.requestId);
    }
    return requestIds.sort().join('|');
  }, [dispatchRuns]);

  useEffect(() => {
    const requestIds = activeBrokeredDispatchRequestKey.split('|').filter(Boolean);
    const pollStatusUpdates = window.nockTerminal.dispatch?.statusUpdates;
    if (requestIds.length === 0 || typeof pollStatusUpdates !== 'function') return undefined;

    let cancelled = false;
    let inFlight = false;
    const poll = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const result = await pollStatusUpdates({
          requestIds,
          agentName: 'nock-terminal',
          limit: 50,
        });
        if (!cancelled && result?.success !== false && Array.isArray(result?.updates) && result.updates.length > 0) {
          setDispatchRuns(prev => applyDispatchRunUpdates(prev, result.updates));
        }
      } catch {
        // NockCC polling is best-effort; local/direct dispatch must keep working offline.
      } finally {
        inFlight = false;
      }
    };

    poll();
    const interval = setInterval(poll, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activeBrokeredDispatchRequestKey]);

  return { dispatchRuns, recordDispatchRun };
}
