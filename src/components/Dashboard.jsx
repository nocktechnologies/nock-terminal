import React, { useMemo } from 'react';
import ProjectCard from './ProjectCard';

export default function Dashboard({ sessions, onSessionClick, onNewTerminal, onRefresh }) {
  const stats = useMemo(() => {
    const active = sessions.filter(s => s.status === 'active').length;
    const recent = sessions.filter(s => s.status === 'recent').length;
    const dirty = sessions.filter(s => s.dirty).length;
    return { total: sessions.length, active, recent, dirty };
  }, [sessions]);

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
                <ProjectCard
                  key={session.id}
                  session={session}
                  index={i}
                  onClick={() => onSessionClick(session)}
                />
              ))}
            </div>
          </>
        ) : (
          <EmptyState />
        )}
      </div>
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
