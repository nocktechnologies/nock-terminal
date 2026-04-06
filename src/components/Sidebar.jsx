import React from 'react';

const STATUS_COLORS = {
  active:   'bg-nock-green',
  recent:   'bg-nock-yellow',
  inactive: 'bg-nock-text-muted',
};

export default function Sidebar({
  collapsed,
  onToggle,
  sessions,
  activePorts,
  onSessionClick,
  onPortClick,
  onRefresh,
  activeView,
  onViewChange,
}) {
  return (
    <div
      className={`transition-sidebar bg-nock-bg border-r border-nock-border flex flex-col shrink-0 ${
        collapsed ? 'w-12' : 'w-60'
      }`}
    >
      {/* Navigation */}
      <div className="flex flex-col gap-1 p-2 border-b border-nock-border">
        <NavButton icon={<GridIcon />} label="Dashboard" collapsed={collapsed} active={activeView === 'dashboard'} onClick={() => onViewChange('dashboard')} />
        <NavButton icon={<TerminalIcon />} label="Terminal" collapsed={collapsed} active={activeView === 'terminal'} onClick={() => onViewChange('terminal')} />
        <NavButton icon={<GearIcon />} label="Settings" collapsed={collapsed} active={activeView === 'settings'} onClick={() => onViewChange('settings')} />
      </div>

      {/* Sessions list */}
      {!collapsed && (
        <div className="flex-1 overflow-y-auto">
          <div className="px-3 pt-4 pb-2">
            <div className="flex items-center justify-between mb-3">
              <span className="font-mono text-[9px] text-nock-text-muted uppercase tracking-widest">
                // Sessions
              </span>
              <button
                onClick={onRefresh}
                className="text-nock-text-muted hover:text-nock-text transition-colors"
                title="Refresh"
              >
                <RefreshIcon />
              </button>
            </div>
            {sessions.length === 0 && (
              <p className="font-mono text-[10px] text-nock-text-muted px-1 py-2">No sessions detected</p>
            )}
            <div className="space-y-0.5">
              {sessions.map((session) => (
                <button
                  key={session.id}
                  onClick={() => onSessionClick(session)}
                  className="w-full text-left px-2 py-1.5 rounded hover:bg-nock-card transition-colors group flex items-center gap-2"
                >
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_COLORS[session.status]} ${session.status === 'active' ? 'animate-pulse-glow' : ''}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] text-nock-text group-hover:text-white transition-colors truncate font-medium">{session.name}</p>
                    <p className="font-mono text-[9px] text-nock-text-muted truncate tracking-tight">
                      {session.branch || '—'} · {session.lastActivityFormatted}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Active ports */}
          <div className="px-3 pt-3 pb-3 border-t border-nock-border">
            <span className="font-mono text-[9px] text-nock-text-muted uppercase tracking-widest mb-3 block">
              // Ports
            </span>
            {activePorts.length === 0 && (
              <p className="font-mono text-[10px] text-nock-text-muted px-1 py-1">No dev servers</p>
            )}
            <div className="space-y-0.5">
              {activePorts.map((port) => (
                <button
                  key={port.port}
                  onClick={() => onPortClick(port)}
                  className="w-full text-left px-2 py-1.5 rounded hover:bg-nock-card transition-colors flex items-center gap-2 group"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-nock-accent-cyan shrink-0 shadow-glow-cyan" />
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-[11px] text-nock-text group-hover:text-white transition-colors tabular-nums">:{port.port}</p>
                    <p className="text-[9px] text-nock-text-muted truncate">
                      {port.processName ? `${port.processName} · ${port.label}` : port.label}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Collapse toggle */}
      <button
        onClick={onToggle}
        className="p-2.5 border-t border-nock-border text-nock-text-muted hover:text-nock-text transition-colors flex items-center justify-center"
      >
        <svg
          className={`w-3.5 h-3.5 transition-transform duration-300 ${collapsed ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      </button>
    </div>
  );
}

function NavButton({ icon, label, collapsed, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2.5 px-2.5 py-2 rounded transition-all ${
        active
          ? 'bg-nock-card text-nock-text border border-nock-border-bright shadow-glow-blue'
          : 'text-nock-text-dim hover:text-nock-text hover:bg-nock-card/50 border border-transparent'
      } ${collapsed ? 'justify-center' : ''}`}
      title={collapsed ? label : undefined}
    >
      {icon}
      {!collapsed && (
        <span className="font-mono text-[10px] font-medium tracking-wider uppercase">
          {label}
        </span>
      )}
    </button>
  );
}

function GridIcon() {
  return (
    <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}
function TerminalIcon() {
  return (
    <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  );
}
function GearIcon() {
  return (
    <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
function RefreshIcon() {
  return (
    <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  );
}
