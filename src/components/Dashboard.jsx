import React, { useMemo, useState, useCallback } from 'react';
import { Activity, Command, GitBranch, Radio, Search, Terminal, Trash2, X } from 'lucide-react';
import ProjectCard from './ProjectCard';
import ContextMenu from './ContextMenu';
import ProjectSettingsModal from './ProjectSettingsModal';
import OnboardingPanel from './OnboardingPanel';
import { filterSessionsBySearch } from '../utils/sessionSearch.mjs';
import { summarizeFleet } from '../utils/fleetOps.mjs';

export default function Dashboard({
  sessions,
  onSessionClick,
  onLaunchAgentFresh,
  onNewTerminal,
  onRefresh,
  onOpenSettings,
  activeProjectPath,
  ollamaStatus,
  tabs = [],
  processStatus = {},
  lastDataTimestamps = {},
  profilesByPath = {},
  dispatchRuns = [],
  onOpenCommandPalette,
  onLaunchSessionWithAgent,
  onCleanupStaleTerminals,
}) {
  const [contextMenu, setContextMenu] = useState(null);
  const [settingsProject, setSettingsProject] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  const stats = useMemo(() => {
    const agents = sessions.filter(s => s.kind === 'agent').length;
    const repos = sessions.length - agents;
    const active = sessions.filter(s => s.status === 'active').length;
    const dirty = sessions.filter(s => s.dirty).length;
    return { agents, repos, active, dirty };
  }, [sessions]);

  const visibleSessions = useMemo(
    () => filterSessionsBySearch(sessions, searchQuery),
    [sessions, searchQuery]
  );

  const groupedSessions = useMemo(() => ({
    agents: visibleSessions.filter(session => session.kind === 'agent'),
    projects: visibleSessions.filter(session => session.kind !== 'agent'),
  }), [visibleSessions]);

  const searchActive = searchQuery.trim().length > 0;

  const handleCardContextMenu = useCallback((e, session) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, session });
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const buildCardMenuItems = useCallback((session) => {
    const items = [
      {
        label: session.kind === 'agent' ? 'Open Agent Folder' : 'Open Terminal',
        icon: (
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        ),
        onClick: () => onSessionClick(session, session.kind === 'agent' ? { openFolderOnly: true } : undefined),
      },
    ];

    if (session.kind === 'agent') {
      const isDispatchAgent = session.launch?.mode === 'dispatch';
      const actionLabel = session.launch?.actionLabel || 'Launch';
      const launchLabel = actionLabel === 'Attach' ? 'Attach Session' : `${actionLabel} Fresh`;
      const nonDispatchCanLaunch = typeof session.launch?.canLaunch === 'boolean'
        ? session.launch.canLaunch === true
        : Boolean(session.agent?.enabled && session.launch?.command);
      items.push({
        label: isDispatchAgent ? 'Stage Dispatch Task' : launchLabel,
        icon: (
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        ),
        disabled: isDispatchAgent ? !session.launch?.canLaunch : !nonDispatchCanLaunch,
        onClick: () => {
          if (isDispatchAgent) {
            onOpenCommandPalette?.({
              sessionId: session.id,
              query: session.agent?.name || session.name,
              focusTask: true,
            });
          } else {
            onLaunchAgentFresh?.(session);
          }
        },
      });
    } else {
      items.push({
        label: 'Launch Default Agent',
        icon: (
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M7 8h10M7 12h6m-6 4h10" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        ),
        onClick: () => onLaunchSessionWithAgent?.(session, undefined, { launchFresh: true }),
      });
    }

    items.push(
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
    );

    return items;
  }, [onSessionClick, onOpenCommandPalette, onLaunchAgentFresh, onLaunchSessionWithAgent]);

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
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between mb-6">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <span className="font-mono text-[10px] text-nock-accent-cyan tracking-widest uppercase">
                  // 01 — Fleet Overview
                </span>
              </div>
              <h1 className="font-display font-bold text-4xl tracking-tight leading-none text-nock-text">
                Sessions
              </h1>
              <p className="font-mono text-xs text-nock-text-dim mt-2 tracking-wide">
                Agent folders, running sessions, and git repos from configured dev roots
              </p>
            </div>

            <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center xl:w-auto xl:justify-end">
              <SessionSearch
                value={searchQuery}
                onChange={setSearchQuery}
                resultCount={visibleSessions.length}
                totalCount={sessions.length}
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={onOpenCommandPalette}
                  className="group px-3 py-2 text-[11px] font-mono tracking-wider uppercase border border-nock-border rounded hover:border-nock-accent-cyan/50 hover:bg-nock-card transition-all text-nock-text-dim hover:text-nock-text"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Command className="h-3 w-3" aria-hidden="true" />
                    Launcher
                  </span>
                </button>
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
          </div>

          {/* Stat strip — cockpit telemetry */}
          <div className="grid grid-cols-4 gap-0 border border-nock-border rounded-md overflow-hidden bg-nock-card/30 backdrop-blur-sm">
            <StatCell label="Agents" value={stats.agents} accent="neutral" />
            <StatCell label="Active" value={stats.active} accent="cyan" pulse={stats.active > 0} />
            <StatCell label="Repos" value={stats.repos} accent="neutral" />
            <StatCell label="Modified" value={stats.dirty} accent="amber" />
          </div>
        </div>
      </div>

      {/* Cards grid */}
      <div className="px-8 py-6">
        <OnboardingPanel
          sessions={sessions}
          activeProjectPath={activeProjectPath}
          ollamaStatus={ollamaStatus}
          onOpenSettings={onOpenSettings}
          onNewTerminal={onNewTerminal}
          onRefresh={onRefresh}
        />

        <OperationsPanel
          sessions={sessions}
          tabs={tabs}
          processStatus={processStatus}
          lastDataTimestamps={lastDataTimestamps}
          dispatchRuns={dispatchRuns}
          onOpenCommandPalette={onOpenCommandPalette}
          onCleanupStaleTerminals={onCleanupStaleTerminals}
        />

        {sessions.length > 0 && visibleSessions.length > 0 ? (
          <>
            <SessionSection
              label="// Agents"
              sessions={groupedSessions.agents}
              offset={0}
              onSessionClick={onSessionClick}
              onContextMenu={handleCardContextMenu}
              profilesByPath={profilesByPath}
            />
            <SessionSection
              label="// Projects"
              sessions={groupedSessions.projects}
              offset={groupedSessions.agents.length}
              onSessionClick={onSessionClick}
              onContextMenu={handleCardContextMenu}
              profilesByPath={profilesByPath}
            />
          </>
        ) : sessions.length > 0 && searchActive ? (
          <NoSearchResults query={searchQuery} onClear={() => setSearchQuery('')} />
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

function SessionSearch({ value, onChange, resultCount, totalCount }) {
  const hasValue = value.trim().length > 0;
  return (
    <div className="relative w-full sm:w-80 xl:w-96">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-nock-text-muted" aria-hidden="true" />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search repos and agents..."
        aria-label="Search repos and agents"
        className="h-9 w-full rounded border border-nock-border bg-nock-card/80 pl-9 pr-20 font-mono text-[11px] text-nock-text outline-none transition-colors placeholder:text-nock-text-muted focus:border-nock-accent-blue/60 focus:bg-nock-card"
      />
      <span className="pointer-events-none absolute right-9 top-1/2 -translate-y-1/2 font-mono text-[9px] text-nock-text-muted tabular-nums">
        {resultCount}/{totalCount}
      </span>
      {hasValue && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-nock-text-muted transition-colors hover:bg-white/5 hover:text-nock-text"
          aria-label="Clear repo search"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

const OperationsPanel = React.memo(function OperationsPanel({
  sessions,
  tabs,
  processStatus,
  lastDataTimestamps,
  dispatchRuns = [],
  onOpenCommandPalette,
  onCleanupStaleTerminals,
}) {
  const summary = useMemo(
    () => summarizeFleet({ sessions, tabs, processStatus, lastDataTimestamps }),
    [sessions, tabs, processStatus, lastDataTimestamps]
  );
  const visibleAgents = useMemo(() => sessions
    .filter((session) => session.kind === 'agent' && ['running', 'idle', 'stale'].includes(session.agent?.lifecycle))
    .slice(0, 4), [sessions]);
  const dispatchAgents = useMemo(() => sessions
    .filter((session) => session.kind === 'agent' && session.launch?.mode === 'dispatch')
    .sort((a, b) => {
      const launchableA = a.launch?.canLaunch === true ? 1 : 0;
      const launchableB = b.launch?.canLaunch === true ? 1 : 0;
      if (launchableA !== launchableB) return launchableB - launchableA;
      return String(a.name || '').localeCompare(String(b.name || ''));
    }), [sessions]);
  const recentDispatchRuns = Array.isArray(dispatchRuns) ? dispatchRuns.slice(0, 4) : [];

  if (sessions.length === 0 && tabs.length === 0) return null;

  return (
    <div className="mb-6 overflow-hidden rounded-md border border-nock-border bg-nock-card/25">
      <div className="grid grid-cols-2 border-b border-nock-border md:grid-cols-4 xl:grid-cols-6">
        <OpsCell Icon={Activity} label="Agent Folders" value={summary.activeAgentFolders} detail={`${summary.agents} known`} tone="green" />
        <OpsCell Icon={Radio} label="Agent Procs" value={summary.activeAgentProcesses} detail="live agents" tone="cyan" />
        <OpsCell Icon={Terminal} label="Terminals" value={summary.terminals} detail={`${summary.quietAgentTabs} quiet`} tone="cyan" />
        <OpsCell Icon={GitBranch} label="Dirty Repos" value={summary.dirtyRepos} detail={`${summary.repos} repos`} tone="amber" />
        <OpsCell Icon={Activity} label="Stale" value={summary.staleAgentFolders} detail="needs glance" tone="amber" />
        <div className="flex items-center justify-end gap-2 border-t border-nock-border px-4 py-3 md:border-t-0 xl:border-l">
          <button
            type="button"
            onClick={onCleanupStaleTerminals}
            className="inline-flex h-8 items-center gap-2 rounded border border-nock-border px-3 font-mono text-[10px] uppercase tracking-wider text-nock-text-dim transition-colors hover:border-nock-green/40 hover:bg-nock-green/10 hover:text-nock-text"
            title="Clean stale terminal sessions"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            Clean
          </button>
          <button
            type="button"
            onClick={onOpenCommandPalette}
            className="inline-flex h-8 items-center gap-2 rounded border border-nock-accent-cyan/40 px-3 font-mono text-[10px] uppercase tracking-wider text-nock-accent-cyan transition-colors hover:bg-nock-accent-cyan/10"
          >
            <Command className="h-3.5 w-3.5" aria-hidden="true" />
            Cmd K
          </button>
        </div>
      </div>
      {visibleAgents.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          <span className="font-mono text-[9px] uppercase tracking-widest text-nock-text-muted">// Now</span>
          {visibleAgents.map((agent) => (
            <span key={agent.id} className="inline-flex min-w-0 items-center gap-1.5 rounded border border-nock-border bg-nock-bg/70 px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-nock-text-dim">
              <span className={`h-1.5 w-1.5 rounded-full ${agent.agent?.lifecycle === 'stale' ? 'bg-nock-yellow' : 'bg-nock-green'}`} />
              <span className="max-w-[140px] truncate text-nock-text">{agent.name}</span>
              <span>{agent.agent?.lifecycle}</span>
            </span>
          ))}
        </div>
      )}
      {(dispatchAgents.length > 0 || recentDispatchRuns.length > 0) && (
        <div className="flex flex-wrap items-center gap-2 border-t border-nock-border px-4 py-3">
          <span className="font-mono text-[9px] uppercase tracking-widest text-nock-text-muted">// Dispatch</span>
          {dispatchAgents.map((agent) => (
            <span key={agent.id} title={agent.launch?.aliasCommand || agent.launch?.commandTemplate || undefined} className="inline-flex min-w-0 items-center gap-1.5 rounded border border-nock-accent-purple/30 bg-nock-accent-purple/5 px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-nock-text-dim">
              <span className={`h-1.5 w-1.5 rounded-full ${agent.launch?.canLaunch ? 'bg-nock-accent-cyan' : 'bg-nock-text-muted'}`} />
              <span className="max-w-[120px] truncate text-nock-text">{agent.name}</span>
              <span>{agent.agent?.runtime || 'dispatch'}</span>
            </span>
          ))}
          {recentDispatchRuns.map((run) => (
            <span key={run.id} className="inline-flex min-w-0 items-center gap-1.5 rounded border border-nock-border bg-nock-bg/70 px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-nock-text-dim">
              <span className={`h-1.5 w-1.5 rounded-full ${dispatchStatusDotClass(run.status)}`} />
              <span className="max-w-[100px] truncate text-nock-text">{run.agentDisplayName || run.agentName}</span>
              <span>{run.mode}</span>
              <span>{run.status}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
});

function dispatchStatusDotClass(status) {
  const tones = {
    accepted: 'bg-nock-accent-cyan',
    blocked: 'bg-nock-yellow',
    completed: 'bg-nock-green',
    expired: 'bg-nock-text-muted',
    failed: 'bg-nock-red',
    launched: 'bg-nock-accent-cyan',
    running: 'bg-nock-accent-cyan',
    sent: 'bg-nock-accent-cyan',
    unknown: 'bg-nock-text-muted',
  };
  return tones[status] || 'bg-nock-text-muted';
}

function OpsCell({ Icon, label, value, detail, tone }) {
  const tones = {
    neutral: 'text-nock-text',
    cyan: 'text-nock-accent-cyan',
    green: 'text-nock-green',
    amber: 'text-nock-accent-amber',
  };
  // A zero metric carries no signal — let it recede so the eye lands on
  // whatever is actually live or needs attention.
  const isZero = Number(value) === 0;
  const accentClass = isZero ? 'text-nock-text-muted' : tones[tone];
  return (
    <div className="border-r border-nock-border px-4 py-3 last:border-r-0">
      <div className="mb-1 flex items-center gap-2">
        <Icon className={`h-3 w-3 ${isZero ? 'text-nock-text-muted' : tones[tone]}`} aria-hidden="true" />
        <span className="font-mono text-[9px] uppercase tracking-widest text-nock-text-muted">{label}</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className={`font-display text-2xl font-bold tabular-nums ${accentClass}`}>
          {String(value).padStart(2, '0')}
        </span>
        <span className="font-mono text-[9px] uppercase tracking-wider text-nock-text-muted">{detail}</span>
      </div>
    </div>
  );
}

const SessionSection = React.memo(function SessionSection({ label, sessions, offset, onSessionClick, onContextMenu, profilesByPath }) {
  if (sessions.length === 0) return null;
  return (
    <div className="mb-7 last:mb-0">
      <div className="flex items-center gap-2 mb-4">
        <span className="font-mono text-[10px] text-nock-text-muted tracking-widest uppercase">
          {label}
        </span>
        <div className="flex-1 h-px bg-gradient-to-r from-nock-border to-transparent" />
      </div>
      <div
        key={`${label}-${sessions.length}`}
        className="stagger-reveal grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
      >
        {sessions.map((session, i) => (
          <div
            key={session.id}
            onContextMenu={(e) => onContextMenu(e, session)}
          >
            <ProjectCard
              session={session}
              profile={profilesByPath?.[session.path]}
              index={offset + i}
              onClick={() => onSessionClick(session)}
            />
          </div>
        ))}
      </div>
    </div>
  );
});

function StatCell({ label, value, accent, pulse }) {
  // Plain counts stay quiet (text color); only state-bearing stats earn an
  // accent — cyan for live, amber for what needs attention. A zero recedes.
  const colors = {
    neutral: 'text-nock-text',
    cyan: 'text-nock-accent-cyan',
    amber: 'text-nock-accent-amber',
    green: 'text-nock-green',
  };
  const isZero = Number(value) === 0;
  const colorClass = isZero ? 'text-nock-text-muted' : colors[accent];
  return (
    <div className="relative px-5 py-4 border-r border-nock-border last:border-r-0 group">
      <p className="font-mono text-[9px] text-nock-text-muted tracking-widest uppercase mb-1">
        {label}
      </p>
      <div className="flex items-baseline gap-2">
        <p className={`font-display font-bold text-3xl tabular-nums ${colorClass} ${pulse && !isZero ? 'animate-pulse-glow' : ''}`}>
          {String(value).padStart(2, '0')}
        </p>
      </div>
    </div>
  );
}

function NoSearchResults({ query, onClear }) {
  return (
    <div className="flex items-center justify-center h-80">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded border border-nock-border bg-nock-card/70">
          <Search className="h-5 w-5 text-nock-text-muted" aria-hidden="true" />
        </div>
        <p className="font-display text-sm text-nock-text mb-1 tracking-wide">No matches for "{query.trim()}"</p>
        <button
          type="button"
          onClick={onClear}
          className="font-mono text-[10px] text-nock-text-muted transition-colors hover:text-nock-text uppercase tracking-wider"
        >
          Clear search
        </button>
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
        <p className="font-display text-sm text-nock-text mb-1 tracking-wide">No agents or projects detected</p>
        <p className="font-mono text-[10px] text-nock-text-muted tracking-wider uppercase">
          Add a dev root or run an agent in a local project
        </p>
      </div>
    </div>
  );
}
