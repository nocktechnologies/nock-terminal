import React from 'react';
import { statusColors } from '../utils/themes';

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
        collapsed ? 'w-12' : 'w-56'
      }`}
    >
      {/* Navigation */}
      <div className="flex flex-col gap-1 p-2 border-b border-nock-border">
        <NavButton
          icon={<GridIcon />}
          label="Dashboard"
          collapsed={collapsed}
          active={activeView === 'dashboard'}
          onClick={() => onViewChange('dashboard')}
        />
        <NavButton
          icon={<TerminalIcon />}
          label="Terminal"
          collapsed={collapsed}
          active={activeView === 'terminal'}
          onClick={() => onViewChange('terminal')}
        />
        <NavButton
          icon={<GearIcon />}
          label="Settings"
          collapsed={collapsed}
          active={activeView === 'settings'}
          onClick={() => onViewChange('settings')}
        />
      </div>

      {/* Sessions list */}
      {!collapsed && (
        <div className="flex-1 overflow-y-auto">
          <div className="p-2">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-nock-text-dim uppercase tracking-wider">
                Sessions
              </span>
              <button
                onClick={onRefresh}
                className="text-nock-text-dim hover:text-nock-text transition-colors"
                title="Refresh"
              >
                <RefreshIcon />
              </button>
            </div>
            {sessions.length === 0 && (
              <p className="text-xs text-nock-text-dim px-1">No sessions found</p>
            )}
            {sessions.map((session) => (
              <button
                key={session.id}
                onClick={() => onSessionClick(session)}
                className="w-full text-left px-2 py-1.5 rounded hover:bg-nock-card transition-colors group flex items-center gap-2 mb-0.5"
              >
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${session.status === 'active' ? 'status-dot-active' : ''}`}
                  style={{ backgroundColor: statusColors[session.status] }}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-nock-text truncate">{session.name}</p>
                  <p className="text-[10px] text-nock-text-dim truncate">
                    {session.branch || 'no branch'} · {session.lastActivityFormatted}
                  </p>
                </div>
              </button>
            ))}
          </div>

          {/* Active ports */}
          <div className="p-2 border-t border-nock-border">
            <span className="text-xs font-semibold text-nock-text-dim uppercase tracking-wider mb-2 block">
              Active Ports
            </span>
            {activePorts.length === 0 && (
              <p className="text-xs text-nock-text-dim px-1">No dev servers</p>
            )}
            {activePorts.map((port) => (
              <button
                key={port.port}
                onClick={() => onPortClick(port)}
                className="w-full text-left px-2 py-1.5 rounded hover:bg-nock-card transition-colors flex items-center gap-2 mb-0.5"
              >
                <span className="w-2 h-2 rounded-full bg-nock-green shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-nock-text">:{port.port}</p>
                  <p className="text-[10px] text-nock-text-dim">{port.label}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Collapse toggle */}
      <button
        onClick={onToggle}
        className="p-2 border-t border-nock-border text-nock-text-dim hover:text-nock-text transition-colors flex items-center justify-center"
      >
        <svg
          className={`w-4 h-4 transition-transform ${collapsed ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
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
      className={`flex items-center gap-2 px-2 py-1.5 rounded transition-colors ${
        active
          ? 'bg-nock-card text-nock-text border border-nock-border'
          : 'text-nock-text-dim hover:text-nock-text hover:bg-nock-card/50'
      } ${collapsed ? 'justify-center' : ''}`}
      title={collapsed ? label : undefined}
    >
      {icon}
      {!collapsed && <span className="text-xs font-medium">{label}</span>}
    </button>
  );
}

function GridIcon() {
  return (
    <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
    </svg>
  );
}

function TerminalIcon() {
  return (
    <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  );
}
