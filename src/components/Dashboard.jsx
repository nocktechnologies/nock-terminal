import React, { useMemo, useState, useCallback } from 'react';
import ProjectCard from './ProjectCard';
import ContextMenu from './ContextMenu';
import ProjectSettingsModal from './ProjectSettingsModal';

export default function Dashboard({ sessions, onSessionClick, onNewTerminal, onRefresh }) {
  const [contextMenu, setContextMenu] = useState(null);
  const [settingsProject, setSettingsProject] = useState(null);

  const stats = useMemo(() => {
    const active = sessions.filter(s => s.status === 'active').length;
    const recent = sessions.filter(s => s.status === 'recent').length;
    const dirty = sessions.filter(s => s.dirty).length;
    return { total: sessions.length, active, recent, dirty };
  }, [sessions]);

  const handleCardContextMenu = useCallback((e, session) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, session });
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const buildCardMenuItems = (session) => [
    {
      label: 'Open Terminal',
      icon: (
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      ),
      onClick: () => onSessionClick(session),
    },
    {
      label: 'Open in VS Code',
      icon: (
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
        </svg>
      ),
      disabled: true,
      onClick: () => {},
    },
    {
      label: 'Open in Explorer',
      icon: (
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
      ),
      onClick: () => {
        window.nockTerminal.shell.showItemInFolder?.(session.path);
      },
    },
    {
      label: 'Project Settings',
      icon: (
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
      onClick: () => setSettingsProject(session),
    },
    { separator: true },
    {
      label: 'Copy Path',
      icon: (
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
        </svg>
      ),
      onClick: () => {
        window.nockTerminal.clipboard.write(session.path);
      },
    },
  ];

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Editorial header band */}
      <div className="relative border-b border-nock-border">
        {/* Subtle grid scan line effect */}
        <div className="absolute inset-0 pointer-events-none opacity-[0.03]"
          style={{
            backgroundImage: 'linear-gradient(to right, #7C5CFC 1px, transparent 1px), linear-gradient(to bottom, #7C5CFC 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />

        <div className="relative px-8 py-7">
          <div className="flex items-end justify-between mb-6">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="font-mono text-[10px] text-nock-accent-cyan tracking-widest uppercase">
                  // 01 — Fleet Overview
                </span>
              </div>
              <h1 className="font-display font-bold text-4xl tracking-tight leading-none">
                <span className="nock-gradient-text">Sessions</span>
              </h1>
              <p className="font-mono text-xs text-nock-text-dim mt-2 tracking-wide">
                Claude Code sessions + git repos from configured dev roots
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={onRefresh}
                className="group px-3 py-2 text-[11px] font-mono tracking-wider uppercase border border-nock-border rounded hover:border-nock-accent-blue/50 hover:bg-nock-card transition-all text-nock-text-dim hover:text-nock-text"
              >
                <span className="inline-flex items-center gap-1.5">
                  <svg className="w-3 h-3 group-hover:rotate-180 transition-transform duration-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Refresh
                </span>
              </button>
              <button
                onClick={() => onNewTerminal()}
                className="px-3.5 py-2 text-[11px] font-mono tracking-wider uppercase nock-gradient-bg rounded text-white font-semibold hover:shadow-glow-purple transition-shadow"
              >
                + New Terminal
              </button>
            </div>
          </div>

          {/* Stat strip — cockpit telemetry */}
          <div className="grid grid-cols-4 gap-0 border border-nock-border rounded-md overflow-hidden bg-nock-card/30 backdrop-blur-sm">
            <StatCell label="Total" value={stats.total} accent="blue" />
            <StatCell label="Active" value={stats.active} accent="green" pulse={stats.active > 0} />
            <StatCell label="Recent" value={stats.recent} accent="yellow" />
            <StatCell label="Modified" value={stats.dirty} accent="purple" />
          </div>
        </div>
      </div>

      {/* Cards grid */}
      <div className="px-8 py-6">
        {sessions.length > 0 ? (
          <>
            <div className="flex items-center gap-2 mb-4">
              <span className="font-mono text-[10px] text-nock-text-muted tracking-widest uppercase">
                // Projects
              </span>
              <div className="flex-1 h-px bg-gradient-to-r from-nock-border to-transparent" />
            </div>
            <div
              key={sessions.length}
              className="stagger-reveal grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
            >
              {sessions.map((session, i) => (
                <div
                  key={session.id}
                  onContextMenu={(e) => handleCardContextMenu(e, session)}
                >
                  <ProjectCard
                    session={session}
                    index={i}
                    onClick={() => onSessionClick(session)}
                  />
                </div>
              ))}
            </div>
          </>
        ) : (
          <EmptyState />
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={buildCardMenuItems(contextMenu.session)}
          onClose={closeContextMenu}
        />
      )}

      {/* Project settings modal */}
      {settingsProject && (
        <ProjectSettingsModal
          projectPath={settingsProject.path}
          projectName={settingsProject.name}
          onClose={() => setSettingsProject(null)}
        />
      )}
    </div>
  );
}

function StatCell({ label, value, accent, pulse }) {
  const colors = {
    blue: 'text-nock-accent-blue',
    green: 'text-nock-green',
    yellow: 'text-nock-yellow',
    purple: 'text-nock-accent-purple',
  };
  return (
    <div className="relative px-5 py-4 border-r border-nock-border last:border-r-0 group">
      <p className="font-mono text-[9px] text-nock-text-muted tracking-widest uppercase mb-1">
        {label}
      </p>
      <div className="flex items-baseline gap-2">
        <p className={`font-display font-bold text-3xl tabular-nums ${colors[accent]} ${pulse ? 'animate-pulse-glow' : ''}`}>
          {String(value).padStart(2, '0')}
        </p>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex items-center justify-center h-96">
      <div className="text-center">
        <div className="w-20 h-20 mx-auto mb-5 rounded-full border border-nock-border flex items-center justify-center relative">
          <div className="absolute inset-0 rounded-full bg-gradient-to-br from-nock-accent-blue/10 to-nock-accent-purple/10" />
          <img src="./nock-logo.png" alt="" className="w-12 h-12 opacity-40 relative" />
        </div>
        <p className="font-display text-sm text-nock-text mb-1 tracking-wide">No sessions detected</p>
        <p className="font-mono text-[10px] text-nock-text-muted tracking-wider uppercase">
          Run Claude Code in any dev project to begin
        </p>
      </div>
    </div>
  );
}
