import React, { useState, useCallback, useRef, useEffect } from 'react';

export default function ActionToolbar({
  onSplit,
  onToggleSidebar,
  onToggleChat,
  onDashboard,
  sidebarOpen,
  chatOpen,
  hasSplit,
  cwd,
}) {
  const [gitStatus, setGitStatus] = useState(null); // { op, state: 'running'|'ok'|'err', msg }
  const clearTimerRef = useRef(null);

  // Clear stale status when active tab changes
  useEffect(() => {
    setGitStatus(null);
  }, [cwd]);

  // Cancel pending auto-clear timer on unmount
  useEffect(() => () => clearTimeout(clearTimerRef.current), []);

  const runGitOp = useCallback(async (op) => {
    if (!cwd || gitStatus?.state === 'running') return;

    if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    setGitStatus({ op, state: 'running', msg: '' });

    try {
      const result = await window.nockTerminal.files.gitOp(cwd, op);
      setGitStatus({
        op,
        state: result.success ? 'ok' : 'err',
        msg: result.success ? (result.output || 'Done') : (result.error || 'Failed'),
      });
    } catch (err) {
      setGitStatus({ op, state: 'err', msg: err?.message || 'IPC error' });
    }

    clearTimerRef.current = setTimeout(() => setGitStatus(null), 3000);
  }, [cwd, gitStatus?.state]);

  const gitBusy = gitStatus?.state === 'running';
  const gitDisabled = !cwd || gitBusy;

  return (
    <div className="flex items-center gap-1 px-2 shrink-0">
      <ToolbarButton
        icon="⊞"
        label="Split"
        shortcut="Ctrl+Shift+D"
        onClick={onSplit}
        active={hasSplit}
      />
      <ToolbarButton
        icon="◧"
        label="Sidebar"
        shortcut="Ctrl+B"
        onClick={onToggleSidebar}
        active={sidebarOpen}
      />
      <ToolbarButton
        icon="💬"
        label="Chat"
        shortcut="Ctrl+Shift+A"
        onClick={onToggleChat}
        active={chatOpen}
      />
      <ToolbarButton
        icon="⊟"
        label="Dash"
        shortcut="Ctrl+D"
        onClick={onDashboard}
      />

      <div className="w-px h-4 bg-nock-border mx-1 shrink-0" />

      <ToolbarButton
        icon={gitBusy && gitStatus.op === 'pull' ? '↓…' : '↓'}
        label="Pull"
        shortcut=""
        onClick={() => runGitOp('pull')}
        disabled={gitDisabled}
      />
      <ToolbarButton
        icon={gitBusy && gitStatus.op === 'push' ? '↑…' : '↑'}
        label="Push"
        shortcut=""
        onClick={() => runGitOp('push')}
        disabled={gitDisabled}
      />
      <ToolbarButton
        icon={gitBusy && gitStatus.op === 'fetch' ? '⟳…' : '⟳'}
        label="Fetch"
        shortcut=""
        onClick={() => runGitOp('fetch')}
        disabled={gitDisabled}
      />

      {gitStatus && gitStatus.state !== 'running' && (
        <span
          className={`text-[9px] font-mono px-2 py-0.5 rounded border shrink-0 max-w-[160px] truncate ${
            gitStatus.state === 'ok'
              ? 'text-green-400 border-green-400/30 bg-green-400/10'
              : 'text-red-400 border-red-400/30 bg-red-400/10'
          }`}
          title={gitStatus.msg}
        >
          {gitStatus.op}: {gitStatus.state === 'ok' ? '✓' : '✗'}
        </span>
      )}
    </div>
  );
}

function ToolbarButton({ icon, label, shortcut, onClick, active, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1 px-2 py-1 rounded text-[9px] font-mono transition-all border ${
        disabled
          ? 'bg-nock-card border-nock-border text-nock-text-dim opacity-40 cursor-not-allowed'
          : active
          ? 'bg-gradient-to-r from-nock-accent-blue/10 to-nock-accent-purple/10 border-nock-accent-blue/30 text-nock-text'
          : 'bg-nock-card border-nock-border text-nock-text-dim hover:text-nock-text hover:border-nock-border-bright'
      }`}
      title={shortcut ? `${label} (${shortcut})` : label}
    >
      <span>{icon}</span>
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
