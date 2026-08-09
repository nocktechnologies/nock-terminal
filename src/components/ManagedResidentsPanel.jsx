import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  CheckCircle2,
  CirclePause,
  CirclePlay,
  Compass,
  KeyRound,
  Loader2,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldCheck,
  Square,
  Terminal,
  TriangleAlert,
  Wrench,
  X,
} from 'lucide-react';
import AgentCreateWizard from './AgentCreateWizard';
import {
  buildAgentInventory,
  DEFAULT_MODEL,
  describeAgentError,
  normalizePrerequisites,
  unwrapManagedResponse,
} from '../utils/agentConsole.mjs';

const LIFECYCLE_TONES = {
  running: 'bg-nock-green',
  starting: 'bg-nock-accent-cyan',
  paused: 'bg-nock-accent-amber',
  needs_auth: 'bg-nock-accent-amber',
  invalid: 'bg-nock-red',
  terminal_failed: 'bg-nock-red',
};

export default function ManagedResidentsPanel({ active, onOpenTerminal }) {
  const [managedRows, setManagedRows] = useState([]);
  const [prerequisites, setPrerequisites] = useState([]);
  const [supportedModels, setSupportedModels] = useState([DEFAULT_MODEL]);
  const [selectedKey, setSelectedKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeAction, setActiveAction] = useState('');
  const [notice, setNotice] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingAgent, setEditingAgent] = useState(null);
  const [steerText, setSteerText] = useState('');
  const refreshInFlightRef = useRef(false);
  const activeActionRef = useRef('');
  const api = window.nockTerminal?.managedAgents;

  const refresh = useCallback(async ({ background = false, checkPrerequisites = true } = {}) => {
    if (!api) {
      setLoading(false);
      setNotice({ tone: 'error', text: 'Managed resident controls are unavailable in this build.' });
      return;
    }
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    if (!background) setRefreshing(true);
    try {
      const [prerequisiteResponse, listResponse] = await Promise.all([
        checkPrerequisites ? api.prerequisites() : Promise.resolve(null),
        api.list(),
      ]);
      if (prerequisiteResponse) {
        const prerequisiteResult = unwrapManagedResponse(prerequisiteResponse);
        setPrerequisites(normalizePrerequisites(prerequisiteResult));
        if (Array.isArray(prerequisiteResult?.supportedModels) && prerequisiteResult.supportedModels.length > 0) {
          setSupportedModels(prerequisiteResult.supportedModels);
        }
      }
      const rows = unwrapManagedResponse(listResponse);
      setManagedRows(Array.isArray(rows) ? rows : []);
    } catch (error) {
      const message = describeAgentError(error);
      setPrerequisites([{ id: 'managed-residents', label: 'Managed residents', available: false, reason: message }]);
      setNotice({ tone: 'error', text: message });
    } finally {
      refreshInFlightRef.current = false;
      setLoading(false);
      if (!background) setRefreshing(false);
    }
  }, [api]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!active) return undefined;
    const interval = setInterval(() => refresh({ background: true, checkPrerequisites: false }), 4_000);
    return () => clearInterval(interval);
  }, [active, refresh]);

  const inventory = useMemo(() => buildAgentInventory(managedRows), [managedRows]);
  const selected = inventory.find((agent) => agent.key === selectedKey) || inventory[0] || null;
  const editingValues = useMemo(() => editingAgent ? draftValues(editingAgent) : undefined, [editingAgent]);
  const failedPrerequisites = prerequisites.filter((item) => !item.available);
  const createBlockedReason = !api
    ? 'Managed resident controls are unavailable in this build.'
    : loading
      ? 'Checking managed resident prerequisites.'
      : failedPrerequisites[0]?.reason || (failedPrerequisites.length ? 'Resolve runtime prerequisites before creating a resident.' : '');
  const createDisabledReason = activeAction ? 'Wait for the current resident action to finish.' : createBlockedReason;

  const run = useCallback(async (agent, action, operation) => {
    if (activeActionRef.current) throw new Error('Wait for the current resident action to finish.');
    const actionKey = `${agent.key}:${action}`;
    activeActionRef.current = actionKey;
    setActiveAction(actionKey);
    setNotice(null);
    try {
      const result = unwrapManagedResponse(await operation());
      await refresh({ background: true, checkPrerequisites: false });
      setNotice({ tone: 'success', text: result?.message || `${action} completed for ${agent.displayName}.` });
      return result;
    } catch (error) {
      setNotice({ tone: 'error', text: describeAgentError(error) });
      throw error;
    } finally {
      activeActionRef.current = '';
      setActiveAction('');
    }
  }, [refresh]);

  const createResident = useCallback(
    (draft) => run({ key: 'create', displayName: draft.displayName }, 'create', () => api.create(draft)),
    [api, run],
  );
  const updateResident = useCallback(
    (draft) => run(editingAgent, 'edit', () => api.update(editingAgent.id, draft)),
    [api, editingAgent, run],
  );
  const authenticate = useCallback(async (agent) => {
    const launch = await run(agent, 'authenticate', () => api.authLaunch(agent.id));
    if (launch) onOpenTerminal?.(launch);
  }, [api, onOpenTerminal, run]);
  const attach = useCallback((agent) => {
    onOpenTerminal?.({
      ...agent.raw.launch,
      agentId: agent.id,
      title: agent.displayName,
    });
  }, [onOpenTerminal]);
  const validate = useCallback(
    (agent) => run(agent, 'validate', () => api.validate(agent.id)),
    [api, run],
  );
  const supervise = useCallback(
    (agent, action) => run(agent, action, () => api.supervise(agent.id, action)),
    [api, run],
  );
  const control = useCallback(
    (agent, action, params) => run(agent, action, () => api.control(agent.id, action, params)),
    [api, run],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-nock-bg">
      {notice && <Notice notice={notice} onDismiss={() => setNotice(null)} />}
      {prerequisites.length > 0 && <PrerequisiteStrip items={prerequisites} />}

      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-nock-border px-5 py-3">
        <div>
          <p className="font-mono text-[9px] uppercase tracking-widest text-nock-accent-cyan">Local / launchd / tmux</p>
          <p className="mt-1 font-mono text-[10px] text-nock-text-muted">{inventory.length} managed resident{inventory.length === 1 ? '' : 's'}</p>
        </div>
        <div className="flex items-center gap-2">
          <IconButton label="Refresh residents" onClick={() => refresh()} disabled={refreshing}>
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
          </IconButton>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            disabled={Boolean(createDisabledReason)}
            title={createDisabledReason || 'Create resident'}
            className="ac-button ac-button-signal"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Create resident
          </button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(260px,0.75fr)_minmax(0,1.7fr)]">
        <aside className="min-h-0 overflow-y-auto border-b border-nock-border lg:border-b-0 lg:border-r">
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-nock-border bg-nock-bg px-4 py-2.5">
            <span className="font-mono text-[9px] uppercase tracking-widest text-nock-text-muted">Residences</span>
            <span className="font-mono text-[9px] tabular-nums text-nock-text-muted">{inventory.length}</span>
          </div>
          {loading ? <LoadingLine label="Loading managed residents" /> : inventory.length === 0 ? <EmptyInventory /> : (
            <div className="p-2">
              {inventory.map((agent) => (
                <InventoryRow
                  key={agent.key}
                  agent={agent}
                  selected={agent.key === selected?.key}
                  onClick={() => setSelectedKey(agent.key)}
                />
              ))}
            </div>
          )}
        </aside>

        <section className="min-h-0 overflow-y-auto" aria-label="Managed resident details">
          {selected ? (
            <ResidentInspector
              agent={selected}
              activeAction={activeAction}
              steerText={steerText}
              onSteerText={setSteerText}
              onAttach={() => attach(selected)}
              onEdit={() => setEditingAgent(selected)}
              onAuthenticate={() => authenticate(selected)}
              onValidate={() => validate(selected)}
              onSupervise={(action) => supervise(selected, action)}
              onControl={(action, params) => control(selected, action, params)}
            />
          ) : <EmptyInspector />}
        </section>
      </div>

      <AgentCreateWizard
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreate={createResident}
        blockedReason={createDisabledReason}
        supportedModels={supportedModels}
      />
      <AgentCreateWizard
        open={Boolean(editingAgent)}
        onClose={() => setEditingAgent(null)}
        onCreate={updateResident}
        mode="edit"
        initialValues={editingValues}
        supportedModels={supportedModels}
      />
    </div>
  );
}

function InventoryRow({ agent, selected, onClick }) {
  const tone = LIFECYCLE_TONES[agent.lifecycle] || 'bg-nock-text-muted';
  return (
    <button type="button" onClick={onClick} className={`mb-1 w-full rounded border px-3 py-2.5 text-left transition-colors ${selected ? 'border-nock-accent-blue/60 bg-nock-card-hover' : 'border-transparent hover:border-nock-border hover:bg-nock-card/70'}`}>
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="truncate font-display text-sm font-semibold text-nock-text">{agent.displayName}</span>
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone}`} aria-label={agent.lifecycleLabel} />
      </div>
      <div className="mt-1.5 flex min-w-0 items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider">
        <span className="text-nock-accent-cyan">Managed</span>
        <span className="text-nock-text-muted">/</span>
        <span className="truncate text-nock-text-dim">{agent.lifecycleLabel}</span>
        <span className="ml-auto shrink-0 text-nock-text-muted">Local</span>
      </div>
      <p className="mt-1 truncate font-mono text-[10px] text-nock-text-muted">{agent.runtime} / {agent.model}</p>
    </button>
  );
}

function ResidentInspector({
  agent,
  activeAction,
  steerText,
  onSteerText,
  onAttach,
  onEdit,
  onAuthenticate,
  onValidate,
  onSupervise,
  onControl,
}) {
  const busy = (action) => activeAction === `${agent.key}:${action}`;
  const anyBusy = Boolean(activeAction);
  const commands = [
    ['authenticate', 'Authenticate', KeyRound, onAuthenticate],
    ['validate', 'Validate', ShieldCheck, onValidate],
    ['edit', 'Edit', Pencil, onEdit],
    ['start', 'Start', Play, () => onSupervise('start')],
    ['stop', 'Stop', Square, () => onSupervise('stop')],
    ['attach', 'Attach', Terminal, onAttach],
    ['pause', 'Pause', CirclePause, () => onControl('pause')],
    ['resume', 'Resume', CirclePlay, () => onControl('resume')],
    ['restart', 'Restart', RotateCcw, () => onControl('restart')],
    ['rotate', 'Rotate', Compass, () => onControl('rotate')],
  ];
  const invokeSteer = () => {
    const message = steerText.trim();
    if (!message) return;
    onControl('steer', { text: message }).then(() => onSteerText('')).catch(() => {});
  };

  return (
    <div className="py-5 pl-5 pr-20 lg:pl-7 lg:pr-20">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-nock-border pb-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-xl font-semibold text-nock-text">{agent.displayName}</h2>
            <LifecycleBadge agent={agent} />
          </div>
          <p className="mt-2 font-mono text-[10px] text-nock-text-muted">{agent.harness} / {agent.runtime} / {agent.model}</p>
        </div>
        <span className="rounded border border-nock-green/35 px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-nock-green">Local</span>
      </div>

      {agent.failureReason && (
        <div className="mt-4 border border-nock-red/40 bg-nock-card/50 px-3 py-2.5">
          <div className="flex items-start gap-2 text-nock-red">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <p className="font-mono text-[10px] leading-relaxed">{agent.failureReason}</p>
          </div>
        </div>
      )}

      <section className="border-b border-nock-border py-5">
        <SectionTitle icon={Wrench}>Commands</SectionTitle>
        <div className="mt-3 flex flex-wrap gap-2">
          {commands.map(([action, label, Icon, onClick]) => (
            <CommandButton
              key={action}
              busy={busy(action)}
              disabled={anyBusy || !agent.capabilities[action]}
              label={label}
              icon={Icon}
              onClick={onClick}
            />
          ))}
        </div>
      </section>

      <section className="border-b border-nock-border py-5">
        <SectionTitle icon={Send}>Steer</SectionTitle>
        <div className="mt-3 flex gap-2">
          <input
            value={steerText}
            onChange={(event) => onSteerText(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') invokeSteer();
            }}
            disabled={anyBusy || !agent.capabilities.steer}
            className="flex-1 rounded border border-nock-border bg-nock-card/70 px-2.5 py-2 font-mono text-[11px] text-nock-text outline-none transition-colors placeholder:text-nock-text-muted focus:border-nock-accent-blue/60 disabled:cursor-not-allowed disabled:opacity-40"
            placeholder="Send a directive"
            aria-label={`Steer ${agent.displayName}`}
          />
          <CommandButton disabled={anyBusy || !agent.capabilities.steer || !steerText.trim()} busy={busy('steer')} label="Send" icon={Send} onClick={invokeSteer} />
        </div>
      </section>

      <section className="border-b border-nock-border py-5">
        <SectionTitle icon={Bot}>Seat</SectionTitle>
        <dl className="mt-3 grid gap-x-6 md:grid-cols-2">
          <Info label="Role" value={agent.role || 'Unspecified'} />
          <Info label="Partner" value={agent.partner} />
          <Info label="Purpose" value={agent.purpose || 'Unspecified'} />
          <Info label="Work directory" value={agent.workDirectory || 'Generated residence'} mono />
          <Info label="Residence" value={agent.residencePath || 'Not exposed'} mono />
        </dl>
      </section>

      <section className="py-5">
        <SectionTitle icon={ShieldCheck}>Permissions</SectionTitle>
        <dl className="mt-3 grid gap-x-6 md:grid-cols-2">
          <Info label="Claude default mode" value={agent.permission.defaultMode} mono />
          <Info label="Preset" value={agent.permission.label} />
          <Info label="Allowed roots" value={agent.allowedRoots.join('\n') || 'Not specified'} mono multiline />
          <Info label="Denied roots" value={agent.deniedRoots.join('\n') || 'Not specified'} mono multiline />
        </dl>
      </section>
    </div>
  );
}

function CommandButton({ busy = false, disabled = false, label, icon: Icon, onClick }) {
  return (
    <button
      type="button"
      onClick={() => Promise.resolve(onClick?.()).catch(() => {})}
      disabled={disabled || busy}
      title={label}
      className="inline-flex h-8 items-center gap-1.5 rounded border border-nock-border bg-nock-card/60 px-2.5 font-mono text-[10px] uppercase tracking-wider text-nock-text-dim transition-colors hover:border-nock-accent-blue/60 hover:text-nock-text disabled:cursor-not-allowed disabled:opacity-40"
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
      {label}
    </button>
  );
}

function IconButton({ label, children, ...props }) {
  return (
    <button type="button" aria-label={label} title={label} className="inline-flex h-8 w-8 items-center justify-center rounded border border-nock-border text-nock-text-dim transition-colors hover:border-nock-border-bright hover:text-nock-text disabled:cursor-not-allowed disabled:opacity-40" {...props}>
      {children}
    </button>
  );
}

function LifecycleBadge({ agent }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-nock-text-dim">
      <span className={`h-1.5 w-1.5 rounded-full ${LIFECYCLE_TONES[agent.lifecycle] || 'bg-nock-text-muted'}`} />
      {agent.lifecycleLabel}
    </span>
  );
}

function SectionTitle({ icon: Icon, children }) {
  return (
    <h3 className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-nock-text-dim">
      <Icon className="h-3.5 w-3.5 text-nock-accent-cyan" aria-hidden="true" />
      {children}
    </h3>
  );
}

function Info({ label, value, mono = false, multiline = false }) {
  return (
    <div className="border-t border-nock-border/70 py-2.5">
      <dt className="font-mono text-[9px] uppercase tracking-wider text-nock-text-muted">{label}</dt>
      <dd className={`mt-1 whitespace-pre-wrap break-words text-xs text-nock-text ${mono ? 'font-mono text-[10px]' : ''} ${multiline ? 'max-h-28 overflow-y-auto' : 'truncate'}`} title={String(value)}>{value}</dd>
    </div>
  );
}

function Notice({ notice, onDismiss }) {
  const tone = notice.tone === 'success' ? 'border-nock-green/40 text-nock-green' : 'border-nock-red/40 text-nock-red';
  const Icon = notice.tone === 'success' ? CheckCircle2 : TriangleAlert;
  return (
    <div className={`flex items-center justify-between gap-3 border-b px-6 py-2 font-mono text-[10px] ${tone}`}>
      <span className="flex min-w-0 items-center gap-2">
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {notice.text}
      </span>
      <button type="button" onClick={onDismiss} className="inline-flex h-7 w-7 items-center justify-center text-nock-text-muted hover:text-nock-text" aria-label="Dismiss message">
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

function PrerequisiteStrip({ items }) {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1 border-b border-nock-border bg-nock-card/30 px-6 py-2">
      <span className="font-mono text-[9px] uppercase tracking-widest text-nock-text-muted">Prerequisites</span>
      {items.map((item) => (
        <span key={item.id} title={item.reason || item.label} className={`inline-flex items-center gap-1.5 font-mono text-[9px] ${item.available ? 'text-nock-green' : 'text-nock-accent-amber'}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${item.available ? 'bg-nock-green' : 'bg-nock-accent-amber'}`} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

function LoadingLine({ label }) {
  return <div className="flex items-center gap-2 px-4 py-5 font-mono text-[10px] text-nock-text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />{label}</div>;
}

function EmptyInventory() {
  return <div className="px-4 py-6 font-mono text-[10px] text-nock-text-muted">No managed residents configured.</div>;
}

function EmptyInspector() {
  return <div className="flex h-full items-center justify-center px-6 font-mono text-[10px] text-nock-text-muted">No resident selected</div>;
}

function draftValues(agent) {
  return {
    id: agent.id,
    displayName: agent.displayName,
    role: agent.role,
    purpose: agent.purpose,
    workDirectory: agent.workDirectory,
    allowedRoots: agent.allowedRoots.join('\n'),
    deniedRoots: agent.deniedRoots.join('\n'),
    model: agent.model,
    partner: agent.partner,
    permissionPreset: agent.permissionPreset,
  };
}
