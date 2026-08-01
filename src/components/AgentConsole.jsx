import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  Clock3,
  Eye,
  Gauge,
  HardDrive,
  Plus,
  Radio,
  RefreshCw,
  Server,
  Settings2,
  ShieldCheck,
  Terminal,
  Trash2,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { removeHarnessSeat, upsertHarnessSeat } from '../utils/harnessConsole.mjs';

const EMPTY_FORM = {
  label: '',
  agent: '',
  host: '',
  user: '',
  port: '22',
  enginePath: '',
};

const ACCESS_MODES = [
  {
    mode: 'console',
    Icon: Radio,
    eyebrow: 'Interactive',
    title: 'Enter live console',
    detail: 'Watch her work and speak into the current turn from one protected input line.',
  },
  {
    mode: 'watch',
    Icon: Eye,
    eyebrow: 'Read only',
    title: 'Watch the stream',
    detail: 'Follow speech, tools, results, and turn boundaries without any chance of sending.',
  },
  {
    mode: 'shell',
    Icon: Terminal,
    eyebrow: 'Engine',
    title: 'Open harness shell',
    detail: 'Start a normal remote terminal in the shared engine repository.',
  },
];

function draftSeatId(form) {
  const port = Number(form.port) || 22;
  return `${form.user.trim()}@${form.host.trim()}:${port}/${form.agent.trim().toLowerCase()}`;
}

function statusPresentation(snapshot, loading, error) {
  if (loading && !snapshot) return { label: 'CHECKING', tone: 'checking', Icon: Activity };
  if (error || !snapshot?.connected) return { label: 'OFFLINE', tone: 'offline', Icon: WifiOff };
  if (snapshot.daemonStatus === 'active') return { label: 'LIVE', tone: 'live', Icon: Wifi };
  return { label: String(snapshot.daemonStatus || 'UNKNOWN').toUpperCase(), tone: 'degraded', Icon: Activity };
}

function formatCheckedAt(value) {
  if (!value) return 'not checked';
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatCount(value) {
  return Number(value || 0).toLocaleString();
}

export default function AgentConsole({ onOpenTerminal }) {
  const [seats, setSeats] = useState([]);
  const [selectedSeatId, setSelectedSeatId] = useState('');
  const [snapshots, setSnapshots] = useState({});
  const [loadingSeatId, setLoadingSeatId] = useState('');
  const [seatErrors, setSeatErrors] = useState({});
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingSeatId, setEditingSeatId] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const selectedSeat = useMemo(
    () => seats.find((seat) => seat.id === selectedSeatId) || seats[0] || null,
    [seats, selectedSeatId]
  );
  const snapshot = selectedSeat ? snapshots[selectedSeat.id] : null;
  const seatError = selectedSeat ? seatErrors[selectedSeat.id] : '';
  const loading = selectedSeat?.id === loadingSeatId;
  const presentation = statusPresentation(snapshot, loading, seatError);
  const StatusIcon = presentation.Icon;

  const loadSeats = useCallback(async () => {
    try {
      const configured = await window.nockTerminal.harness.list();
      const nextSeats = Array.isArray(configured) ? configured : [];
      setSeats(nextSeats);
      setSelectedSeatId((current) => (
        nextSeats.some((seat) => seat.id === current) ? current : (nextSeats[0]?.id || '')
      ));
      if (nextSeats.length === 0) setEditorOpen(true);
    } catch {
      setFormError('Nock Terminal could not read harness seat settings. Restart the app and try again.');
    }
  }, []);

  const refreshSeat = useCallback(async (seatId) => {
    if (!seatId) return;
    setLoadingSeatId(seatId);
    try {
      const result = await window.nockTerminal.harness.snapshot(seatId);
      if (result?.success && result.snapshot) {
        setSnapshots((current) => ({
          ...current,
          [seatId]: { ...result.snapshot, checkedAt: Date.now() },
        }));
        setSeatErrors((current) => ({ ...current, [seatId]: '' }));
      } else {
        setSeatErrors((current) => ({
          ...current,
          [seatId]: result?.error || 'Nock Terminal could not reach this harness seat.',
        }));
      }
    } catch {
      setSeatErrors((current) => ({
        ...current,
        [seatId]: 'Nock Terminal could not reach this harness seat. Check the SSH connection.',
      }));
    } finally {
      setLoadingSeatId((current) => current === seatId ? '' : current);
    }
  }, []);

  useEffect(() => {
    loadSeats();
  }, [loadSeats]);

  useEffect(() => {
    if (!selectedSeat?.id) return undefined;
    refreshSeat(selectedSeat.id);
    const interval = setInterval(() => refreshSeat(selectedSeat.id), 12_000);
    return () => clearInterval(interval);
  }, [refreshSeat, selectedSeat?.id]);

  const beginAdd = () => {
    setEditingSeatId('');
    setForm(EMPTY_FORM);
    setFormError('');
    setEditorOpen(true);
  };

  const beginEdit = (seat) => {
    setEditingSeatId(seat.id);
    setForm({
      label: seat.label,
      agent: seat.agent,
      host: seat.host,
      user: seat.user,
      port: String(seat.port),
      enginePath: seat.enginePath,
    });
    setFormError('');
    setEditorOpen(true);
  };

  const persistSeats = async (nextSeats, preferredSeatId = '') => {
    setSaving(true);
    setFormError('');
    try {
      const result = await window.nockTerminal.settings.set('harnessSeats', nextSeats);
      if (!result?.success || !Array.isArray(result.value)) {
        setFormError('That connection is not valid. Check the SSH host, user, agent, port, and absolute engine path.');
        return false;
      }
      setSeats(result.value);
      const nextSelected = result.value.find((seat) => seat.id === preferredSeatId)?.id
        || result.value[0]?.id
        || '';
      setSelectedSeatId(nextSelected);
      setEditorOpen(false);
      setEditingSeatId('');
      return true;
    } catch {
      setFormError('Nock Terminal could not save this connection. Try again.');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const saveSeat = async (event) => {
    event.preventDefault();
    const candidate = {
      id: draftSeatId(form),
      label: form.label,
      agent: form.agent,
      host: form.host,
      user: form.user,
      port: Number(form.port),
      enginePath: form.enginePath,
      transport: 'ssh',
    };
    const withoutPrevious = editingSeatId && editingSeatId !== candidate.id
      ? removeHarnessSeat(seats, editingSeatId)
      : seats;
    await persistSeats(upsertHarnessSeat(withoutPrevious, candidate), candidate.id);
  };

  const deleteSeat = async () => {
    if (!editingSeatId) return;
    await persistSeats(removeHarnessSeat(seats, editingSeatId));
  };

  const queueCounts = snapshot?.queueCounts || {};
  const contextPercent = Math.round((snapshot?.context?.ratio || 0) * 100);

  return (
    <main className="agent-console flex h-full min-h-0 flex-col overflow-hidden bg-[var(--ac-bg)] text-[var(--ac-text)]">
      <header className="flex h-16 shrink-0 items-center border-b border-[var(--ac-line)] bg-[var(--ac-surface)] px-5">
        <div className="mr-5 flex h-8 w-8 items-center justify-center border border-[var(--ac-signal)] text-[var(--ac-signal)]">
          <Radio className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--ac-muted)]">Nock persistent agent control</div>
          <h1 className="font-display text-xl font-semibold tracking-tight text-[var(--ac-text-strong)]">Agent Console</h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {selectedSeat && (
            <button type="button" onClick={() => refreshSeat(selectedSeat.id)} disabled={loading} className="ac-button ac-button-quiet" aria-label={`Refresh ${selectedSeat.label} status`}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
              Refresh
            </button>
          )}
          <button type="button" onClick={beginAdd} className="ac-button ac-button-signal">
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Add seat
          </button>
        </div>
      </header>

      {editorOpen && (
        <ConnectionEditor
          form={form}
          setForm={setForm}
          error={formError}
          saving={saving}
          editing={Boolean(editingSeatId)}
          onSave={saveSeat}
          onDelete={deleteSeat}
          onClose={() => {
            if (seats.length > 0) setEditorOpen(false);
            setFormError('');
          }}
        />
      )}

      {seats.length === 0 ? (
        <EmptyConsole onAdd={beginAdd} />
      ) : (
        <div className="flex min-h-0 flex-1">
          <nav className="w-48 shrink-0 overflow-y-auto border-r border-[var(--ac-line)] bg-[var(--ac-surface)] p-3" aria-label="Harness seats">
            <div className="mb-3 px-2 text-[9px] font-semibold uppercase tracking-[0.22em] text-[var(--ac-muted)]">Connected seats</div>
            <div className="space-y-1">
              {seats.map((seat, index) => {
                const seatSnapshot = snapshots[seat.id];
                const active = seat.id === selectedSeat?.id;
                return (
                  <button
                    key={seat.id}
                    type="button"
                    onClick={() => setSelectedSeatId(seat.id)}
                    className={`ac-seat ${active ? 'ac-seat-active' : ''}`}
                  >
                    <span className="font-mono text-[9px] tabular-nums text-[var(--ac-muted)]">{String(index + 1).padStart(2, '0')}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-semibold text-[var(--ac-text-strong)]">{seat.label}</span>
                      <span className="mt-0.5 block truncate font-mono text-[9px] text-[var(--ac-muted)]">{seat.user}@{seat.host}</span>
                    </span>
                    <span className={`ac-seat-dot ${seatSnapshot?.daemonStatus === 'active' ? 'ac-seat-dot-live' : ''}`} />
                  </button>
                );
              })}
            </div>
          </nav>

          <section className="min-w-0 flex-1 overflow-y-auto">
            <div className="agent-console-layout min-h-full">
              <div className="min-w-0 border-r border-[var(--ac-line)]">
                <div className="relative overflow-hidden border-b border-[var(--ac-line)] px-7 py-8">
                  <div className="ac-index-mark" aria-hidden="true">{selectedSeat.agent.slice(0, 1).toUpperCase()}</div>
                  <div className="relative flex min-w-0 items-start justify-between gap-6">
                    <div className="min-w-0">
                      <div className="mb-3 flex flex-wrap items-center gap-3">
                        <span className={`ac-status ac-status-${presentation.tone}`}>
                          <StatusIcon className="h-3 w-3" aria-hidden="true" />
                          {presentation.label}
                        </span>
                        <span className="font-mono text-[10px] text-[var(--ac-muted)]">{selectedSeat.user}@{selectedSeat.host}:{selectedSeat.port}</span>
                      </div>
                      <h2 className="font-display text-4xl font-semibold tracking-[-0.04em] text-[var(--ac-text-strong)]">{selectedSeat.label}</h2>
                      <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ac-muted-strong)]">
                        {seatError || 'Persistent harness seat. The engine owns turns and durability; this console gives you a live, direct operator surface.'}
                      </p>
                    </div>
                    <button type="button" onClick={() => beginEdit(selectedSeat)} className="ac-icon-button" aria-label={`Edit ${selectedSeat.label} connection`}>
                      <Settings2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>

                <div className="px-7 py-7">
                  <SectionLabel number="01" title="Live access" detail="Every mode opens in a real PTY-backed terminal." />
                  <div className="mt-4 divide-y divide-[var(--ac-line)] border-y border-[var(--ac-line)]">
                    {ACCESS_MODES.map(({ mode, Icon, eyebrow, title, detail }) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => onOpenTerminal(selectedSeat, mode)}
                        className={`ac-access-row ${mode === 'console' ? 'ac-access-primary' : ''}`}
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center border border-current">
                          <Icon className="h-4 w-4" aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1 text-left">
                          <span className="block text-[9px] font-semibold uppercase tracking-[0.2em] opacity-65">{eyebrow}</span>
                          <span className="mt-0.5 block text-sm font-semibold">{title}</span>
                          <span className="mt-1 block max-w-2xl text-[11px] leading-5 opacity-60">{detail}</span>
                        </span>
                        <ArrowUpRight className="h-4 w-4 shrink-0" aria-hidden="true" />
                      </button>
                    ))}
                  </div>
                </div>

                <div className="border-t border-[var(--ac-line)] px-7 py-7">
                  <SectionLabel number="02" title="Wake queue" detail="Read directly from the harness ledger; no inferred activity." />
                  <div className="mt-4 grid grid-cols-3 border border-[var(--ac-line)]">
                    <Metric label="Working" value={queueCounts.working} tone="signal" />
                    <Metric label="Queued" value={queueCounts.queued} />
                    <Metric label="Dead" value={queueCounts.dead} tone={queueCounts.dead ? 'danger' : 'quiet'} />
                  </div>
                  <div className="mt-4 divide-y divide-[var(--ac-line)] border-y border-[var(--ac-line)]">
                    {(snapshot?.queue || []).length > 0 ? snapshot.queue.map((wake) => (
                      <div key={wake.id} className="grid grid-cols-[64px_92px_minmax(0,1fr)_40px] items-start gap-3 py-3 font-mono text-[10px]">
                        <span className="text-[var(--ac-signal)]">#{wake.id}</span>
                        <span className="uppercase text-[var(--ac-text)]">{wake.state}</span>
                        <span className="min-w-0 truncate text-[var(--ac-muted-strong)]" title={wake.summary}>{wake.class}/{wake.source} · {wake.summary}</span>
                        <span className="text-right text-[var(--ac-muted)]">a{wake.attempts}</span>
                      </div>
                    )) : (
                      <div className="py-6 text-sm text-[var(--ac-muted)]">No nonterminal wakes. New operator work will appear here.</div>
                    )}
                  </div>
                </div>
              </div>

              <aside className="bg-[var(--ac-surface)]">
                <div className="border-b border-[var(--ac-line)] p-5">
                  <div className="mb-4 flex items-center justify-between">
                    <span className="text-[9px] font-semibold uppercase tracking-[0.22em] text-[var(--ac-muted)]">Context pressure</span>
                    <span className="font-display text-2xl font-semibold tabular-nums text-[var(--ac-text-strong)]">{contextPercent}%</span>
                  </div>
                  <div className="h-2 overflow-hidden bg-[var(--ac-line)]" aria-label={`Context ${contextPercent}% full`}>
                    <div className="h-full bg-[var(--ac-signal)] transition-transform duration-300" style={{ transform: `scaleX(${Math.min(1, contextPercent / 100)})`, transformOrigin: 'left' }} />
                  </div>
                  <div className="mt-3 flex justify-between font-mono text-[9px] text-[var(--ac-muted)]">
                    <span>{formatCount(snapshot?.context?.tokensUsed)} used</span>
                    <span>{formatCount(snapshot?.context?.contextWindow)} max</span>
                  </div>
                </div>

                <RailFact Icon={Clock3} label="Thread age" value={`${snapshot?.threadAgeHours || 0}h`} detail={`routine ${snapshot?.routineRotateHours || 0}h`} />
                <RailFact Icon={Activity} label="Last turn" value={snapshot?.lastTurn?.status || 'unknown'} detail={[snapshot?.lastTurn?.source, snapshot?.lastTurn?.age].filter(Boolean).join(' · ')} />
                <RailFact Icon={Server} label="Runtime" value={snapshot?.manifest?.runtime || 'unknown'} detail={snapshot?.manifest?.model || 'model unavailable'} />
                <RailFact Icon={HardDrive} label="Residence" value={snapshot?.manifest?.home ? 'separate home' : 'unknown'} detail={snapshot?.manifest?.home || selectedSeat.enginePath} />
                <RailFact Icon={Gauge} label="Turn budget" value={snapshot?.manifest?.turnBudget?.enabled ? `${snapshot.manifest.turnBudget.hardSeconds}s hard` : 'not reported'} detail="checkpointed continuation" />

                <div className="border-b border-[var(--ac-line)] p-5">
                  <div className="mb-4 flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-[var(--ac-live)]" aria-hidden="true" />
                    <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--ac-text-strong)]">Control contract</span>
                  </div>
                  <ContractRow label="Speak / steer" value="Supported" available />
                  <ContractRow label="Read-only watch" value="Supported" available />
                  <ContractRow label="Queue inspection" value="Supported" available />
                  <ContractRow label="Pause / resume" value="Not published" />
                </div>

                <div className="p-5 font-mono text-[9px] leading-5 text-[var(--ac-muted)]">
                  <div>Last substrate check</div>
                  <div className="text-[var(--ac-muted-strong)]">{formatCheckedAt(snapshot?.checkedAt)}</div>
                  <div className="mt-3 break-all">{selectedSeat.enginePath}</div>
                </div>
              </aside>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function ConnectionEditor({ form, setForm, error, saving, editing, onSave, onDelete, onClose }) {
  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  return (
    <section className="border-b border-[var(--ac-line)] bg-[var(--ac-panel)] px-5 py-5" aria-label={editing ? 'Edit harness seat' : 'Add harness seat'}>
      <form onSubmit={onSave} className="mx-auto max-w-6xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <div className="text-[9px] font-semibold uppercase tracking-[0.22em] text-[var(--ac-signal)]">Standalone SSH connection</div>
            <h2 className="mt-1 font-display text-lg font-semibold text-[var(--ac-text-strong)]">{editing ? 'Edit seat coordinates' : 'Connect a harness seat'}</h2>
          </div>
          <button type="button" onClick={onClose} className="ac-icon-button" aria-label="Close connection editor">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-[1fr_1fr_1fr_1fr_90px_2fr]">
          <ConsoleField label="Label" value={form.label} onChange={update('label')} placeholder="Mira" />
          <ConsoleField label="Agent" value={form.agent} onChange={update('agent')} placeholder="mira" />
          <ConsoleField label="SSH host" value={form.host} onChange={update('host')} placeholder="nock-fleet-02" />
          <ConsoleField label="SSH user" value={form.user} onChange={update('user')} placeholder="nock" />
          <ConsoleField label="Port" value={form.port} onChange={update('port')} placeholder="22" inputMode="numeric" />
          <ConsoleField label="Engine path" value={form.enginePath} onChange={update('enginePath')} placeholder="/home/nock/Dev/nock-agent-harness" />
        </div>
        {error && <p className="mt-3 text-[11px] text-[var(--ac-danger)]" role="alert">{error}</p>}
        <div className="mt-4 flex items-center gap-2">
          <button type="submit" disabled={saving} className="ac-button ac-button-signal">{saving ? 'Saving connection…' : 'Save connection'}</button>
          <button type="button" onClick={onClose} className="ac-button ac-button-quiet">Keep current</button>
          {editing && (
            <button type="button" onClick={onDelete} disabled={saving} className="ac-button ac-button-danger ml-auto">
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              Remove connection
            </button>
          )}
        </div>
      </form>
    </section>
  );
}

function ConsoleField({ label, ...props }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--ac-muted)]">{label}</span>
      <input required className="ac-input" {...props} />
    </label>
  );
}

function EmptyConsole({ onAdd }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-8">
      <div className="max-w-xl border-l-2 border-[var(--ac-signal)] pl-7">
        <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--ac-signal)]">No seats configured</div>
        <h2 className="font-display text-3xl font-semibold tracking-tight text-[var(--ac-text-strong)]">Bring a persistent agent into view.</h2>
        <p className="mt-3 text-sm leading-6 text-[var(--ac-muted-strong)]">Add the SSH coordinates for a Nock agent harness. Credentials remain in your SSH agent; Nock Terminal stores only the seat, host, and engine path.</p>
        <button type="button" onClick={onAdd} className="ac-button ac-button-signal mt-6">
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          Connect first seat
        </button>
      </div>
    </div>
  );
}

function SectionLabel({ number, title, detail }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="font-mono text-[9px] text-[var(--ac-signal)]">{number}</span>
      <h3 className="font-display text-lg font-semibold text-[var(--ac-text-strong)]">{title}</h3>
      <p className="text-[11px] text-[var(--ac-muted)]">{detail}</p>
    </div>
  );
}

function Metric({ label, value, tone = 'normal' }) {
  return (
    <div className={`ac-metric ac-metric-${tone}`}>
      <span className="text-[9px] font-semibold uppercase tracking-[0.18em] opacity-60">{label}</span>
      <span className="mt-1 font-display text-2xl font-semibold tabular-nums">{formatCount(value)}</span>
    </div>
  );
}

function RailFact({ Icon, label, value, detail }) {
  return (
    <div className="grid grid-cols-[28px_minmax(0,1fr)] gap-3 border-b border-[var(--ac-line)] p-5">
      <Icon className="mt-0.5 h-4 w-4 text-[var(--ac-signal)]" aria-hidden="true" />
      <div className="min-w-0">
        <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--ac-muted)]">{label}</div>
        <div className="mt-1 truncate text-sm font-semibold text-[var(--ac-text-strong)]">{value}</div>
        <div className="mt-1 break-all font-mono text-[9px] leading-4 text-[var(--ac-muted)]">{detail}</div>
      </div>
    </div>
  );
}

function ContractRow({ label, value, available = false }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-[var(--ac-line)] py-2.5 text-[10px] first:border-t-0">
      <span className="text-[var(--ac-muted-strong)]">{label}</span>
      <span className={available ? 'text-[var(--ac-live)]' : 'text-[var(--ac-muted)]'}>{value}</span>
    </div>
  );
}
