import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Command, Play, Search, Send, Settings, Terminal, X } from 'lucide-react';
import {
  AGENT_LAUNCHERS,
  buildLauncherTargets,
  getAgentLauncher,
  resolveSessionLaunch,
  sanitizeStagedTerminalInput,
} from '../utils/agentLaunchers.mjs';
import { orderTaskTargets } from '../utils/fleetOps.mjs';

export default function CommandPalette({
  open,
  sessions,
  profilesByPath,
  activeProjectPath,
  onClose,
  onOpenSession,
  onLaunchSessionWithAgent,
  onNewTerminal,
  onOpenSettings,
}) {
  const [query, setQuery] = useState('');
  const [taskText, setTaskText] = useState('');
  const [taskTargetId, setTaskTargetId] = useState('');
  const [taskAgentId, setTaskAgentId] = useState('claude');
  const inputRef = useRef(null);

  const targets = useMemo(
    () => buildLauncherTargets(sessions, profilesByPath, query).slice(0, 12),
    [sessions, profilesByPath, query]
  );

  const taskTargets = useMemo(
    () => orderTaskTargets(sessions, activeProjectPath).slice(0, 18),
    [sessions, activeProjectPath]
  );

  const selectedTaskTarget = useMemo(() => {
    if (!taskTargets.length) return null;
    return taskTargets.find((session) => session.id === taskTargetId) || taskTargets[0];
  }, [taskTargetId, taskTargets]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    if (!open || taskTargetId || !taskTargets[0]) return;
    setTaskTargetId(taskTargets[0].id);
  }, [open, taskTargetId, taskTargets]);

  useEffect(() => {
    const firstMatch = targets[0]?.session;
    if (!open || !query.trim() || !firstMatch || taskTargetId === firstMatch.id) return;
    setTaskTargetId(firstMatch.id);
  }, [open, query, targets, taskTargetId]);

  useEffect(() => {
    if (!selectedTaskTarget || selectedTaskTarget.kind === 'agent') return;
    const profile = profilesByPath?.[selectedTaskTarget.path] || {};
    setTaskAgentId(profile.defaultAgent || 'claude');
  }, [profilesByPath, selectedTaskTarget?.id, selectedTaskTarget?.kind, selectedTaskTarget?.path]);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === 'Enter' && event.target?.tagName !== 'TEXTAREA') {
        const firstTarget = targets[0];
        if (!firstTarget) return;
        event.preventDefault();
        onOpenSession(firstTarget.session);
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose, onOpenSession, targets]);

  if (!open) return null;

  const sanitizedTask = sanitizeStagedTerminalInput(taskText);
  const canStageTask = Boolean(sanitizedTask && selectedTaskTarget);

  const stageTask = () => {
    if (!canStageTask) return;
    onLaunchSessionWithAgent(selectedTaskTarget, taskAgentId, {
      launchFresh: true,
      initialInput: sanitizedTask,
    });
    setTaskText('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/65 px-4 pt-[7vh]" role="dialog" aria-modal="true" aria-label="Command launcher">
      <div className="w-full max-w-5xl overflow-hidden rounded-lg border border-nock-border-bright bg-nock-bg shadow-2xl">
        <div className="flex items-center gap-3 border-b border-nock-border px-4 py-3">
          <Command className="h-4 w-4 text-nock-accent-cyan" aria-hidden="true" />
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-nock-text-muted" aria-hidden="true" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find repos, agents, branches, commands..."
              className="h-9 w-full rounded border border-nock-border bg-nock-card/80 pl-8 pr-3 font-mono text-[12px] text-nock-text outline-none placeholder:text-nock-text-muted focus:border-nock-accent-blue/60"
              aria-label="Find repos, agents, branches, and commands"
            />
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded text-nock-text-muted transition-colors hover:bg-white/5 hover:text-nock-text"
            aria-label="Close command launcher"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="grid max-h-[74vh] grid-cols-1 overflow-hidden lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-h-0 overflow-y-auto border-b border-nock-border lg:border-b-0 lg:border-r">
            <div className="flex items-center gap-2 border-b border-nock-border px-4 py-2">
              <button
                type="button"
                onClick={() => {
                  onNewTerminal();
                  onClose();
                }}
                className="inline-flex h-8 items-center gap-2 rounded border border-nock-border bg-nock-card px-3 font-mono text-[10px] uppercase tracking-wider text-nock-text-dim transition-colors hover:border-nock-border-bright hover:text-nock-text"
              >
                <Terminal className="h-3.5 w-3.5" aria-hidden="true" />
                New Terminal
              </button>
              <button
                type="button"
                onClick={() => {
                  onOpenSettings();
                  onClose();
                }}
                className="inline-flex h-8 items-center gap-2 rounded border border-nock-border bg-nock-card px-3 font-mono text-[10px] uppercase tracking-wider text-nock-text-dim transition-colors hover:border-nock-border-bright hover:text-nock-text"
              >
                <Settings className="h-3.5 w-3.5" aria-hidden="true" />
                Settings
              </button>
              <span className="ml-auto font-mono text-[9px] uppercase tracking-widest text-nock-text-muted">
                Enter opens first match
              </span>
            </div>

            <div className="p-3">
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="font-mono text-[9px] uppercase tracking-widest text-nock-text-muted">// Find And Launch</span>
                <span className="font-mono text-[9px] tabular-nums text-nock-text-muted">{targets.length} matches</span>
              </div>
              <div className="space-y-1">
                {targets.map((target) => (
                  <LaunchRow
                    key={target.session.id}
                    target={target}
                    onOpen={() => {
                      onOpenSession(target.session);
                      onClose();
                    }}
                    onLaunch={(agentId) => {
                      onLaunchSessionWithAgent(target.session, agentId, { launchFresh: true });
                      onClose();
                    }}
                  />
                ))}
                {targets.length === 0 && (
                  <div className="flex h-44 items-center justify-center rounded border border-dashed border-nock-border">
                    <p className="font-mono text-[10px] uppercase tracking-wider text-nock-text-muted">No launcher matches</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex min-h-0 flex-col bg-nock-card/25">
            <div className="border-b border-nock-border px-4 py-3">
              <div className="mb-1 flex items-center gap-2">
                <Send className="h-3.5 w-3.5 text-nock-accent-cyan" aria-hidden="true" />
                <span className="font-mono text-[10px] uppercase tracking-widest text-nock-text">// Task Staging</span>
              </div>
              <p className="font-mono text-[9px] leading-4 text-nock-text-muted">
                Launch an agent and place the task text into the terminal without submitting it.
              </p>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              <label className="block">
                <span className="mb-1 block font-mono text-[9px] uppercase tracking-widest text-nock-text-muted">Target</span>
                <select
                  value={selectedTaskTarget?.id || ''}
                  onChange={(event) => setTaskTargetId(event.target.value)}
                  className="h-9 w-full rounded border border-nock-border bg-nock-card px-3 font-mono text-[11px] text-nock-text outline-none focus:border-nock-accent-blue/60"
                >
                  {taskTargets.map((session) => (
                    <option key={session.id} value={session.id}>
                      {session.kind === 'agent' ? 'Agent' : 'Repo'} · {session.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block font-mono text-[9px] uppercase tracking-widest text-nock-text-muted">Agent</span>
                <select
                  value={taskAgentId}
                  onChange={(event) => setTaskAgentId(event.target.value)}
                  disabled={selectedTaskTarget?.kind === 'agent'}
                  className="h-9 w-full rounded border border-nock-border bg-nock-card px-3 font-mono text-[11px] text-nock-text outline-none disabled:opacity-50 focus:border-nock-accent-blue/60"
                >
                  {AGENT_LAUNCHERS.map((launcher) => (
                    <option key={launcher.id} value={launcher.id}>{launcher.label}</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block font-mono text-[9px] uppercase tracking-widest text-nock-text-muted">Task</span>
                <textarea
                  value={taskText}
                  onChange={(event) => setTaskText(event.target.value)}
                  rows={8}
                  className="w-full resize-none rounded border border-nock-border bg-nock-bg px-3 py-2 font-mono text-[11px] leading-5 text-nock-text outline-none placeholder:text-nock-text-muted focus:border-nock-accent-blue/60"
                  placeholder="Ask the selected agent to investigate, fix, test, or summarize..."
                />
              </label>
            </div>

            <div className="border-t border-nock-border p-4">
              <button
                type="button"
                onClick={stageTask}
                disabled={!canStageTask}
                className="flex h-9 w-full items-center justify-center gap-2 rounded nock-gradient-bg font-mono text-[10px] font-semibold uppercase tracking-wider text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Play className="h-3.5 w-3.5" aria-hidden="true" />
                Launch And Stage Task
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function LaunchRow({ target, onOpen, onLaunch }) {
  const { session, profile } = target;
  const isAgent = session.kind === 'agent';
  const defaultLaunch = resolveSessionLaunch(session, profile);
  const defaultLauncher = isAgent ? null : getAgentLauncher(target.defaultAgentId);

  return (
    <div className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded border border-transparent px-3 py-2 transition-colors hover:border-nock-border hover:bg-nock-card/70">
      <button type="button" onClick={onOpen} className="min-w-0 text-left">
        <div className="mb-1 flex min-w-0 items-center gap-2">
          <span className={`flex h-5 w-5 items-center justify-center rounded border ${isAgent ? 'border-nock-green/30 text-nock-green' : 'border-nock-accent-blue/30 text-nock-accent-blue'}`}>
            {isAgent ? <Bot className="h-3 w-3" aria-hidden="true" /> : <Terminal className="h-3 w-3" aria-hidden="true" />}
          </span>
          <span className="truncate font-display text-sm font-semibold text-nock-text">{session.name}</span>
          <span className="rounded border border-nock-border px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider text-nock-text-muted">
            {isAgent ? session.agent?.lifecycle || 'agent' : defaultLauncher?.shortLabel || 'Shell'}
          </span>
        </div>
        <p className="truncate font-mono text-[10px] text-nock-text-muted">{session.path}</p>
      </button>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onOpen}
          className="h-8 rounded border border-nock-border px-2.5 font-mono text-[9px] uppercase tracking-wider text-nock-text-dim transition-colors hover:border-nock-border-bright hover:text-nock-text"
        >
          Open
        </button>
        <button
          type="button"
          onClick={() => onLaunch(target.defaultAgentId)}
          disabled={!defaultLaunch.command}
          title={defaultLaunch.disabledReason || `Launch ${defaultLaunch.label}`}
          className="h-8 rounded border border-nock-accent-blue/40 px-2.5 font-mono text-[9px] uppercase tracking-wider text-nock-accent-blue transition-colors hover:bg-nock-accent-blue/10 disabled:cursor-not-allowed disabled:border-nock-border disabled:text-nock-text-muted"
        >
          Launch
        </button>
      </div>
    </div>
  );
}
