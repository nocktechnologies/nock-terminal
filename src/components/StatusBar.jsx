import React, { useState, useEffect, useRef } from 'react';
import { GitBranch, Monitor, Wifi, WifiOff, Clock } from 'lucide-react';

export default function StatusBar({ activeTab, sessions, ollamaStatus, processStatus }) {
  const [time, setTime] = useState(() => new Date());
  const [sessionDuration, setSessionDuration] = useState(null);
  const sessionStartRef = useRef(null);

  // Clock — updates every second
  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Session duration timer — tracks how long the active tab has been open
  useEffect(() => {
    if (activeTab) {
      if (!sessionStartRef.current || sessionStartRef.current.tabId !== activeTab.id) {
        sessionStartRef.current = { tabId: activeTab.id, start: Date.now() };
      }
    } else {
      sessionStartRef.current = null;
      setSessionDuration(null);
      return;
    }

    const interval = setInterval(() => {
      if (sessionStartRef.current) {
        const elapsed = Date.now() - sessionStartRef.current.start;
        const totalSec = Math.floor(elapsed / 1000);
        const h = Math.floor(totalSec / 3600);
        const m = Math.floor((totalSec % 3600) / 60);
        const s = totalSec % 60;
        setSessionDuration(
          h > 0
            ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
            : `${m}:${String(s).padStart(2, '0')}`
        );
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [activeTab?.id]);

  const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

  // Derive context % from processStatus for active tab
  const activeProc = activeTab ? processStatus[activeTab.id] : null;
  const contextPercent = activeProc?.contextPercent ?? null;

  const getContextColor = (pct) => {
    if (pct >= 80) return 'text-nock-red';
    if (pct >= 60) return 'text-nock-yellow';
    return 'text-nock-green';
  };

  // Active session count
  const activeSessionCount = sessions.filter(s => s.status === 'active').length;

  // Project name and branch from active tab
  const projectName = activeTab?.cwd
    ? activeTab.cwd.split(/[\\/]/).filter(Boolean).pop()
    : null;
  const branch = activeTab?.branch || null;

  return (
    <div className="h-6 bg-nock-bg-elevated border-t border-nock-border flex items-center justify-between px-3 font-mono text-[10px] text-nock-text-dim select-none shrink-0">
      {/* Left: Project + Branch */}
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {projectName ? (
          <>
            <span className="text-nock-text truncate max-w-[120px]" title={activeTab?.cwd}>
              {projectName}
            </span>
            {branch && (
              <>
                <GitBranch className="w-3 h-3 text-nock-accent-purple shrink-0" />
                <span className="truncate max-w-[140px]" title={branch}>
                  {branch}
                </span>
              </>
            )}
          </>
        ) : (
          <span className="text-nock-text-muted">No active project</span>
        )}
      </div>

      {/* Center: Sessions + Ollama */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <Monitor className="w-3 h-3" />
          <span>{activeSessionCount} session{activeSessionCount !== 1 ? 's' : ''}</span>
        </div>
        <div className="w-px h-3 bg-nock-border" />
        <div className="flex items-center gap-1.5" title={ollamaStatus ? 'Ollama online' : 'Ollama offline'}>
          {ollamaStatus ? (
            <>
              <Wifi className="w-3 h-3 text-nock-green" />
              <span className="text-nock-green">Ollama</span>
            </>
          ) : (
            <>
              <WifiOff className="w-3 h-3 text-nock-red" />
              <span className="text-nock-red">Ollama</span>
            </>
          )}
        </div>
      </div>

      {/* Right: Context % + Duration + Clock */}
      <div className="flex items-center gap-3 justify-end flex-1">
        {contextPercent !== null && (
          <>
            <span className={getContextColor(contextPercent)}>
              CTX {contextPercent}%
            </span>
            <div className="w-px h-3 bg-nock-border" />
          </>
        )}
        {sessionDuration && (
          <>
            <span className="tabular-nums">{sessionDuration}</span>
            <div className="w-px h-3 bg-nock-border" />
          </>
        )}
        <div className="flex items-center gap-1.5">
          <Clock className="w-3 h-3" />
          <span className="tabular-nums">{timeStr}</span>
        </div>
      </div>
    </div>
  );
}
