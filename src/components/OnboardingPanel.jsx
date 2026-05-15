import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Circle, Settings2, TerminalSquare, RefreshCw } from 'lucide-react';

export default function OnboardingPanel({
  sessions,
  activeProjectPath,
  ollamaStatus,
  onOpenSettings,
  onNewTerminal,
  onRefresh,
}) {
  const [complete, setComplete] = useState(true);
  const [devRoots, setDevRoots] = useState([]);
  const [agents, setAgents] = useState([]);

  const refresh = async () => {
    try {
      const [allSettings, detectedAgents] = await Promise.all([
        window.nockTerminal.settings.getAll(),
        window.nockTerminal.system.detectAgents?.() || Promise.resolve([]),
      ]);
      setComplete(allSettings?.onboardingComplete === true);
      setDevRoots(Array.isArray(allSettings?.devRoots) ? allSettings.devRoots : []);
      setAgents(Array.isArray(detectedAgents) ? detectedAgents : []);
    } catch (err) {
      console.error('Failed to refresh onboarding state:', err);
      setComplete(false);
      setDevRoots([]);
      setAgents([]);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const steps = useMemo(() => {
    const hasAgent = agents.some(agent => agent.installed);
    return [
      {
        label: 'Choose dev roots',
        done: devRoots.length > 0,
        detail: devRoots.length > 0 ? `${devRoots.length} configured` : 'Add folders in Settings',
      },
      {
        label: 'Detect an agent CLI',
        done: hasAgent,
        detail: hasAgent
          ? agents.filter(agent => agent.installed).map(agent => agent.label).join(', ')
          : 'Install Claude Code or Codex CLI',
      },
      {
        label: 'Discover a project',
        done: sessions.length > 0,
        detail: sessions.length > 0 ? `${sessions.length} found` : 'Refresh after configuring roots',
      },
      {
        label: 'Verify project context',
        done: Boolean(activeProjectPath),
        detail: activeProjectPath ? activeProjectPath.split(/[\\/]/).pop() : 'Open a project and check context files',
      },
      {
        label: 'Check local model status',
        done: ollamaStatus === true,
        detail: ollamaStatus ? 'Ollama online' : 'Optional: start Ollama for local chat',
      },
    ];
  }, [activeProjectPath, agents, devRoots.length, ollamaStatus, sessions.length]);

  const dismiss = () => {
    window.nockTerminal.settings.set('onboardingComplete', true);
    setComplete(true);
  };

  if (complete) return null;

  return (
    <section className="mb-6 border border-nock-border rounded-lg bg-nock-card/40 overflow-hidden" aria-label="First-run setup">
      <div className="px-4 py-3 border-b border-nock-border flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-sm font-semibold text-nock-text">First-run setup</h2>
          <p className="font-mono text-[10px] text-nock-text-muted mt-0.5">
            Configure the minimum pieces needed for a useful agent cockpit.
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="px-3 py-2 rounded border border-nock-border text-[10px] font-mono uppercase tracking-wider text-nock-text-muted hover:text-nock-text hover:bg-nock-card transition-colors"
        >
          Dismiss
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 divide-y lg:divide-y-0 lg:divide-x divide-nock-border">
        {steps.map(step => (
          <div key={step.label} className="px-4 py-3 min-w-0">
            <div className="flex items-center gap-2">
              {step.done ? (
                <CheckCircle2 className="w-4 h-4 text-nock-green shrink-0" aria-hidden="true" />
              ) : (
                <Circle className="w-4 h-4 text-nock-text-muted shrink-0" aria-hidden="true" />
              )}
              <span className="text-xs text-nock-text truncate">{step.label}</span>
            </div>
            <p className="mt-1 font-mono text-[9px] text-nock-text-muted truncate">{step.detail}</p>
          </div>
        ))}
      </div>

      <div className="px-4 py-3 border-t border-nock-border flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onOpenSettings}
          className="inline-flex items-center gap-2 px-3 py-2 rounded bg-nock-card border border-nock-border text-xs text-nock-text hover:border-nock-accent-blue transition-colors"
        >
          <Settings2 className="w-3.5 h-3.5" aria-hidden="true" />
          Open Settings
        </button>
        <button
          type="button"
          onClick={() => onNewTerminal()}
          className="inline-flex items-center gap-2 px-3 py-2 rounded bg-nock-card border border-nock-border text-xs text-nock-text hover:border-nock-accent-purple transition-colors"
        >
          <TerminalSquare className="w-3.5 h-3.5" aria-hidden="true" />
          New Terminal
        </button>
        <button
          type="button"
          onClick={() => {
            onRefresh();
            refresh();
          }}
          className="inline-flex items-center gap-2 px-3 py-2 rounded bg-nock-card border border-nock-border text-xs text-nock-text hover:border-nock-accent-cyan transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
          Recheck
        </button>
      </div>
    </section>
  );
}
