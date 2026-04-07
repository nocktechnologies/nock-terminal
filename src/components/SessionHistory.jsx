import React, { useState, useEffect, useCallback } from 'react';
import { Clock, Terminal, Download } from 'lucide-react';

function formatDuration(startTime, endTime) {
  if (!endTime) return '—';
  const ms = endTime - startTime;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

function formatTime(timestamp) {
  if (!timestamp) return '—';
  const d = new Date(timestamp);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (isToday) return `Today ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ` ${time}`;
}

export default function SessionHistory() {
  const [sessions, setSessions] = useState([]);
  const [selectedSession, setSelectedSession] = useState(null);
  const [output, setOutput] = useState(null);
  const [loadingOutput, setLoadingOutput] = useState(false);

  const refreshList = useCallback(async () => {
    try {
      const list = await window.nockTerminal.sessionHistory.list();
      setSessions(list);
    } catch (err) {
      console.error('Failed to load session history:', err);
    }
  }, []);

  useEffect(() => {
    refreshList();
    const interval = setInterval(refreshList, 30000);
    return () => clearInterval(interval);
  }, [refreshList]);

  const openDetail = useCallback(async (session) => {
    setSelectedSession(session);
    setOutput(null);
    if (session.hasOutput) {
      setLoadingOutput(true);
      try {
        const text = await window.nockTerminal.sessionHistory.getOutput(session.startTime, session.tabId);
        setOutput(text);
      } catch (err) {
        console.error('Failed to load session output:', err);
        setOutput(null);
      } finally {
        setLoadingOutput(false);
      }
    }
  }, []);

  const goBack = useCallback(() => {
    setSelectedSession(null);
    setOutput(null);
  }, []);

  const exportOutput = useCallback(() => {
    if (!output || !selectedSession) return;
    const blob = new Blob([output], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const project = selectedSession.project || 'session';
    const ts = new Date(selectedSession.startTime).toISOString().replace(/[:.]/g, '-');
    a.download = `${project}-${ts}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [output, selectedSession]);

  // Detail view
  if (selectedSession) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-3 pt-3 pb-2 flex items-center justify-between">
          <button
            onClick={goBack}
            className="text-[10px] text-nock-text-muted hover:text-nock-text transition-colors font-mono flex items-center gap-1"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
          {selectedSession.hasOutput && output && (
            <button
              onClick={exportOutput}
              className="text-nock-text-muted hover:text-nock-text transition-colors"
              title="Export output"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="px-3 pb-2 border-b border-nock-border">
          <p className="text-[11px] text-nock-text font-medium truncate">{selectedSession.project || 'Terminal'}</p>
          <p className="font-mono text-[9px] text-nock-text-muted mt-0.5">
            {formatTime(selectedSession.startTime)} · {formatDuration(selectedSession.startTime, selectedSession.endTime)}
            {selectedSession.exitCode != null && (
              <span className={selectedSession.exitCode === 0 ? 'text-nock-green' : 'text-nock-red'}>
                {' '}· exit {selectedSession.exitCode}
              </span>
            )}
          </p>
        </div>

        <div className="flex-1 overflow-auto px-3 py-2">
          {loadingOutput ? (
            <p className="font-mono text-[10px] text-nock-text-muted">Loading...</p>
          ) : output ? (
            <pre className="font-mono text-[9px] text-nock-text-dim whitespace-pre-wrap break-all leading-relaxed">{output}</pre>
          ) : (
            <p className="font-mono text-[10px] text-nock-text-muted py-2">No output captured</p>
          )}
        </div>
      </div>
    );
  }

  // List view
  return (
    <div className="flex flex-col h-full">
      <div className="px-3 pt-3 pb-2 flex items-center justify-between">
        <span className="font-mono text-[9px] text-nock-text-muted uppercase tracking-widest">
          // History
        </span>
        <Clock className="w-3 h-3 text-nock-text-muted" />
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-2">
        {sessions.length === 0 ? (
          <p className="font-mono text-[10px] text-nock-text-muted px-1 py-2">No sessions recorded</p>
        ) : (
          <div className="space-y-0.5">
            {sessions.map((session) => (
              <button
                key={`${session.startTime}-${session.tabId}`}
                onClick={() => openDetail(session)}
                className="w-full text-left px-2 py-1.5 rounded hover:bg-nock-card transition-colors group flex items-center gap-2"
              >
                <Terminal className="w-3 h-3 text-nock-text-muted shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="text-[11px] text-nock-text group-hover:text-white transition-colors truncate font-medium">
                      {session.project || 'Terminal'}
                    </p>
                    {session.hasOutput && (
                      <span className="w-1.5 h-1.5 rounded-full bg-nock-accent-blue shrink-0" title="Has captured output" />
                    )}
                  </div>
                  <p className="font-mono text-[9px] text-nock-text-muted truncate tracking-tight">
                    {formatTime(session.startTime)} · {formatDuration(session.startTime, session.endTime)}
                    {session.exitCode != null && ` · exit ${session.exitCode}`}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
