import React, { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import FileTree from './FileTree';
import ContextMonitor from './ContextMonitor';
import SessionHistory from './SessionHistory';
import PromptLibrary from './PromptLibrary';
import { filterSessionsBySearch } from '../utils/sessionSearch.mjs';

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
  activeProjectPath,
  onFileClick,
  onCtrlPFocus,
  onExecutePrompt,
  onOpenCommandPalette,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const visibleSessions = useMemo(
    () => filterSessionsBySearch(sessions, searchQuery),
    [sessions, searchQuery]
  );
  const groupedSessions = useMemo(() => ({
    agents: visibleSessions.filter(session => session.kind === 'agent'),
    projects: visibleSessions.filter(session => session.kind !== 'agent'),
  }), [visibleSessions]);
  const searchActive = searchQuery.trim().length > 0;

  return (
    <div
      className={`transition-sidebar bg-nock-bg border-r border-nock-border flex flex-col shrink-0 ${
        collapsed ? 'w-12' : 'w-60'
      }`}
    >
      {/* Navigation */}
      <div className="flex flex-col gap-1 p-2 border-b border-nock-border">
        <NavButton icon={<GridIcon />} label="Dashboard" collapsed={collapsed} active={activeView === 'dashboard'} onClick={() => onViewChange('dashboard')} />
        <NavButton icon={<CommandIcon />} label="Launcher" collapsed={collapsed} active={false} onClick={onOpenCommandPalette} />
        <NavButton icon={<TerminalIcon />} label="Terminal" collapsed={collapsed} active={activeView === 'terminal'} onClick={() => onViewChange('terminal')} />
        <NavButton icon={<GearIcon />} label="Settings" collapsed={collapsed} active={activeView === 'settings'} onClick={() => onViewChange('settings')} />
      </div>

      {/* Sessions list */}
      {!collapsed && (
        <div className="flex-1 overflow-y-auto">
          {activeProjectPath && (
            <div className="px-1 pt-3 pb-2 border-b border-nock-border max-h-[40%] overflow-hidden flex flex-col">
              <div className="px-2 mb-2 flex items-center justify-between">
                <span className="font-mono text-[9px] text-nock-text-muted uppercase tracking-widest">
                  // Files
                </span>
                <span className="font-mono text-[8px] text-nock-text-muted bg-nock-card px-1.5 py-0.5 rounded">Ctrl+P</span>
              </div>
              <FileTree
                rootPath={activeProjectPath}
                onFileClick={onFileClick}
                onCtrlPFocus={onCtrlPFocus}
              />
            </div>
          )}

          <div className="px-3 pt-4 pb-2">
            <SessionListHeader onRefresh={onRefresh} />
            {sessions.length > 0 && (
              <SidebarSearch
                value={searchQuery}
                onChange={setSearchQuery}
                resultCount={visibleSessions.length}
                totalCount={sessions.length}
              />
            )}
            {sessions.length === 0 && (
              <p className="font-mono text-[10px] text-nock-text-muted px-1 py-2">No sessions detected</p>
            )}
            {sessions.length > 0 && visibleSessions.length === 0 && searchActive ? (
              <p className="font-mono text-[10px] text-nock-text-muted px-1 py-2">No matching repos</p>
            ) : (
              <>
                <SidebarSessionSection
                  label="// Agents"
                  sessions={groupedSessions.agents}
                  onSessionClick={onSessionClick}
                />
                <SidebarSessionSection
                  label="// Projects"
                  sessions={groupedSessions.projects}
                  onSessionClick={onSessionClick}
                />
              </>
            )}
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

          {/* Session history */}
          <div className="border-t border-nock-border max-h-[30%] overflow-hidden flex flex-col">
            <SessionHistory />
          </div>

          {/* Prompt library */}
          <div className="border-t border-nock-border max-h-[30%] overflow-hidden flex flex-col">
            <PromptLibrary onExecutePrompt={onExecutePrompt} />
          </div>
        </div>
      )}

      {!collapsed && activeProjectPath && (
        <div className="border-t border-nock-border">
          <ContextMonitor projectPath={activeProjectPath} onEditFile={onFileClick} />
        </div>
      )}

      {/* Collapse toggle */}
      <button
        type="button"
        onClick={onToggle}
        className="p-2.5 border-t border-nock-border text-nock-text-muted hover:text-nock-text transition-colors flex items-center justify-center"
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
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

function SidebarSearch({ value, onChange, resultCount, totalCount }) {
  const hasValue = value.trim().length > 0;
  return (
    <div className="relative mb-3">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-nock-text-muted" aria-hidden="true" />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search repos..."
        aria-label="Search repos and agents"
        className="h-8 w-full rounded border border-nock-border bg-nock-card/70 pl-8 pr-16 font-mono text-[10px] text-nock-text outline-none transition-colors placeholder:text-nock-text-muted focus:border-nock-accent-blue/60"
      />
      <span className="pointer-events-none absolute right-8 top-1/2 -translate-y-1/2 font-mono text-[8px] text-nock-text-muted tabular-nums">
        {resultCount}/{totalCount}
      </span>
      {hasValue && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-nock-text-muted transition-colors hover:bg-white/5 hover:text-nock-text"
          aria-label="Clear repo search"
        >
          <X className="h-3 w-3" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

function SessionListHeader({ onRefresh }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <span className="font-mono text-[9px] text-nock-text-muted uppercase tracking-widest">
        // Sessions
      </span>
      <button
        type="button"
        onClick={onRefresh}
        className="min-h-7 min-w-7 inline-flex items-center justify-center rounded text-nock-text-muted hover:text-nock-text hover:bg-nock-card transition-colors"
        title="Refresh"
        aria-label="Refresh sessions"
      >
        <RefreshIcon />
      </button>
    </div>
  );
}

function SidebarSessionSection({ label, sessions, onSessionClick }) {
  if (sessions.length === 0) return null;
  return (
    <div className="mb-3 last:mb-0">
      <span className="font-mono text-[8px] text-nock-text-muted uppercase tracking-widest px-1 mb-1.5 block">
        {label}
      </span>
      <div className="space-y-0.5">
        {sessions.map((session) => {
          const lifecycle = session.kind === 'agent' ? session.agent?.lifecycle : null;
          const meta = session.kind === 'agent'
            ? `${lifecycle || 'offline'} · ${session.agent?.unreadCount || 0} unread`
            : `${session.branch || '—'} · ${session.lastActivityFormatted}`;
          return (
            <button
              key={session.id}
              onClick={() => onSessionClick(session)}
              className="w-full text-left px-2 py-1.5 rounded hover:bg-nock-card transition-colors group flex items-center gap-2"
            >
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_COLORS[session.status]} ${session.status === 'active' ? 'animate-pulse-glow' : ''}`} />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] text-nock-text group-hover:text-white transition-colors truncate font-medium">{session.name}</p>
                <p className="font-mono text-[9px] text-nock-text-muted truncate tracking-tight">
                  {meta}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function NavButton({ icon, label, collapsed, active, onClick }) {
  return (
    <button
      type="button"
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
function CommandIcon() {
  return (
    <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M18 3a3 3 0 0 1 0 6H6a3 3 0 1 1 0-6h12ZM18 15a3 3 0 1 1 0 6H6a3 3 0 1 1 0-6h12Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 9v6M18 9v6" />
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
