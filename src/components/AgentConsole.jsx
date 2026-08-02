import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Check,
  CircleDotDashed,
  Clock3,
  Eye,
  Gauge,
  HardDrive,
  MessageSquareText,
  Octagon,
  Pause,
  Play,
  Plus,
  Radio,
  RefreshCw,
  RotateCcw,
  Server,
  Send,
  Settings2,
  ShieldCheck,
  Target,
  Terminal,
  TriangleAlert,
  Trash2,
  Wrench,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import {
  findHarnessSeatCollision,
  harnessAccessSurface,
  harnessAgentPulse,
  harnessControlState,
  harnessPresence,
  harnessQueueActions,
  isCurrentHarnessSeat,
  isHarnessLaunchPending,
  removeHarnessSeat,
  upsertHarnessSeat,
} from '../utils/harnessConsole.mjs';
import { createTabId } from '../utils/tabOps.mjs';
import TerminalView from './TerminalView';

const EMPTY_FORM = {
  label: '',
  agent: '',
  host: '',
  user: '',
  port: '22',
  enginePath: '',
};

const EMBEDDED_ACCESS_MODES = [
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

function formatPulseTime(value, fallback = 'not scheduled') {
  if (!Number.isFinite(value)) return fallback;
  return new Date(value * 1000).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatPresenceTime(value) {
  if (!Number.isFinite(value)) return '--:--:--';
  return new Date(value * 1000).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function pulseTone(disposition) {
  if (disposition === 'working') return 'live';
  if (disposition === 'ready') return 'signal';
  if (['blocked', 'degraded', 'stalled'].includes(disposition)) return 'danger';
  if (['paused', 'held'].includes(disposition)) return 'warning';
  return 'quiet';
}

export default function AgentConsole({ active, onOpenTerminal }) {
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
  const [embeddedSession, setEmbeddedSession] = useState(null);
  const [pendingLaunch, setPendingLaunch] = useState(null);
  const [launchError, setLaunchError] = useState('');
  const [pendingControl, setPendingControl] = useState(null);
  const [controlFeedback, setControlFeedback] = useState(null);
  const [cancelArmed, setCancelArmed] = useState(false);
  const [acknowledgingWakeId, setAcknowledgingWakeId] = useState(null);
  const [ackNote, setAckNote] = useState('');
  const [messageDraft, setMessageDraft] = useState('');
  const [messagePending, setMessagePending] = useState(false);
  const [messageFeedback, setMessageFeedback] = useState(null);
  const selectedSeatIdRef = useRef(selectedSeatId);
  const controlInFlightSeatsRef = useRef(new Set());

  const selectedSeat = useMemo(
    () => seats.find((seat) => seat.id === selectedSeatId) || seats[0] || null,
    [seats, selectedSeatId]
  );
  const snapshot = selectedSeat ? snapshots[selectedSeat.id] : null;
  const seatError = selectedSeat ? seatErrors[selectedSeat.id] : '';
  const loading = selectedSeat?.id === loadingSeatId;
  const presentation = statusPresentation(snapshot, loading, seatError);
  const StatusIcon = presentation.Icon;
  const selectedSeatLaunchPending = isHarnessLaunchPending(pendingLaunch, selectedSeat?.id);
  const launchingMode = selectedSeatLaunchPending ? pendingLaunch.mode : '';
  const controlState = harnessControlState(snapshot);
  const agentPulse = harnessAgentPulse(snapshot);
  const presence = harnessPresence(snapshot);
  const controlCapabilities = {
    queueRetry: controlState.canQueueRetry,
    queueAcknowledge: controlState.canQueueAcknowledge,
  };
  const selectedSeatControlPending = Boolean(selectedSeat?.id)
    && pendingControl?.seatId === selectedSeat.id;

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

  const refreshSeat = useCallback(async (seatId, { background = false } = {}) => {
    if (!seatId) return;
    if (!background) setLoadingSeatId(seatId);
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
      if (!background) {
        setLoadingSeatId((current) => current === seatId ? '' : current);
      }
    }
  }, []);

  useEffect(() => {
    loadSeats();
  }, [loadSeats]);

  useEffect(() => {
    if (!active || !selectedSeat?.id) return undefined;
    refreshSeat(selectedSeat.id);
    const interval = setInterval(
      () => refreshSeat(selectedSeat.id, { background: true }),
      4_000,
    );
    return () => clearInterval(interval);
  }, [active, refreshSeat, selectedSeat?.id]);

  useEffect(() => {
    selectedSeatIdRef.current = selectedSeatId;
    setEmbeddedSession((current) => (
      current && current.seatId !== selectedSeatId ? null : current
    ));
    setPendingLaunch((current) => (
      current && current.seatId !== selectedSeatId ? null : current
    ));
    setLaunchError('');
    setPendingControl(null);
    setControlFeedback(null);
    setCancelArmed(false);
    setAcknowledgingWakeId(null);
    setAckNote('');
    setMessageDraft('');
    setMessagePending(false);
    setMessageFeedback(null);
  }, [selectedSeatId]);

  useEffect(() => {
    if (!cancelArmed) return undefined;
    const timeout = setTimeout(() => setCancelArmed(false), 5_000);
    return () => clearTimeout(timeout);
  }, [cancelArmed]);

  const openHarnessAccess = useCallback(async (seat, mode) => {
    if (!seat?.id) return;
    if (harnessAccessSurface(mode) === 'terminal') {
      onOpenTerminal(seat, mode);
      return;
    }
    if (isHarnessLaunchPending(pendingLaunch, seat.id)) return;

    setPendingLaunch({ seatId: seat.id, mode });
    setLaunchError('');
    try {
      const launch = await window.nockTerminal.harness.launch(seat.id, mode);
      if (!isCurrentHarnessSeat(selectedSeatIdRef.current, seat.id)) return;
      if (!launch?.success || !launch.command) {
        setLaunchError(launch?.error || `Nock Terminal could not open ${seat.label}.`);
        return;
      }
      setEmbeddedSession({
        id: createTabId('harness-live'),
        seatId: seat.id,
        label: seat.label,
        mode,
        title: launch.title,
        command: launch.command,
        cwd: launch.cwd,
      });
    } catch {
      if (isCurrentHarnessSeat(selectedSeatIdRef.current, seat.id)) {
        setLaunchError(`Nock Terminal could not open ${seat.label}. Check the saved SSH connection.`);
      }
    } finally {
      setPendingLaunch((current) => (
        isHarnessLaunchPending(current, seat.id, mode) ? null : current
      ));
    }
  }, [onOpenTerminal, pendingLaunch]);

  const runHarnessControl = useCallback(async (action, options = {}) => {
    const seat = selectedSeat;
    if (!seat?.id || controlInFlightSeatsRef.current.has(seat.id)) return;
    controlInFlightSeatsRef.current.add(seat.id);
    setPendingControl({ seatId: seat.id, action, wakeId: options.wakeId });
    setControlFeedback(null);
    try {
      const result = await window.nockTerminal.harness.control(seat.id, action, options);
      if (!isCurrentHarnessSeat(selectedSeatIdRef.current, seat.id)) return;
      if (!result?.success) {
        setControlFeedback({ tone: 'error', message: result?.error || 'The harness did not confirm that control action.' });
        return;
      }
      setControlFeedback({ tone: 'success', message: result.control?.message || 'Harness control confirmed.' });
      setCancelArmed(false);
      setAcknowledgingWakeId(null);
      setAckNote('');
      await refreshSeat(seat.id);
    } catch {
      if (isCurrentHarnessSeat(selectedSeatIdRef.current, seat.id)) {
        setControlFeedback({ tone: 'error', message: 'The harness control link failed. No action was confirmed.' });
      }
    } finally {
      controlInFlightSeatsRef.current.delete(seat.id);
      setPendingControl((current) => current?.seatId === seat.id ? null : current);
    }
  }, [refreshSeat, selectedSeat]);

  const sendHarnessMessage = useCallback(async (event) => {
    event.preventDefault();
    const text = messageDraft.trim();
    const seat = selectedSeat;
    if (!seat?.id || !text || text.length > 2000 || messagePending) return;
    setMessagePending(true);
    setMessageFeedback(null);
    try {
      const result = await window.nockTerminal.harness.message(seat.id, text);
      if (!isCurrentHarnessSeat(selectedSeatIdRef.current, seat.id)) return;
      if (!result?.success) {
        setMessageFeedback({ tone: 'error', message: result?.error || 'The harness did not confirm that message.' });
        return;
      }
      setMessageDraft('');
      setMessageFeedback({
        tone: 'success',
        message: result.disposition === 'steered'
          ? 'Inside the active turn.'
          : 'Queued as the next operator turn.',
      });
      await refreshSeat(seat.id, { background: true });
    } catch {
      if (isCurrentHarnessSeat(selectedSeatIdRef.current, seat.id)) {
        setMessageFeedback({ tone: 'error', message: 'The harness link failed. No delivery was confirmed.' });
      }
    } finally {
      if (isCurrentHarnessSeat(selectedSeatIdRef.current, seat.id)) {
        setMessagePending(false);
      }
    }
  }, [messageDraft, messagePending, refreshSeat, selectedSeat]);

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
    const collision = findHarnessSeatCollision(seats, candidate.id, editingSeatId);
    if (collision) {
      setFormError(`Another seat (${collision.label}) already uses this SSH host, user, port, and agent.`);
      return;
    }
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

                <AgentPulsePanel pulse={agentPulse} />

                <div className="px-7 py-7">
                  <SectionLabel number="02" title="Live channel" detail="Public progress, direct steering, and the full PTY when you want it." />
                  <AgentPresencePanel
                    presence={presence}
                    agentLabel={selectedSeat.label}
                    turnActive={controlState.turnActive}
                    steerable={controlState.steerable}
                    messageDraft={messageDraft}
                    messagePending={messagePending}
                    messageFeedback={messageFeedback}
                    onMessageChange={setMessageDraft}
                    onMessageSubmit={sendHarnessMessage}
                  />
                  <div className="ac-live-frame mt-4">
                    <div className="ac-live-toolbar">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className={`ac-live-link-dot ${embeddedSession ? 'ac-live-link-dot-connected' : ''}`} aria-hidden="true" />
                        <div className="min-w-0">
                          <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-[var(--ac-muted)]">Operator link</div>
                          <div className="truncate text-[11px] font-semibold text-[var(--ac-text-strong)]">
                            {embeddedSession ? `${embeddedSession.label} · ${embeddedSession.mode === 'console' ? 'interactive' : 'read only'}` : 'No live session attached'}
                          </div>
                        </div>
                      </div>
                      <div className="ml-auto flex items-center gap-1" role="group" aria-label="Live channel mode">
                        {EMBEDDED_ACCESS_MODES.map(({ mode, Icon, eyebrow }) => (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => openHarnessAccess(selectedSeat, mode)}
                            disabled={selectedSeatLaunchPending}
                            className={`ac-mode-button ${embeddedSession?.mode === mode ? 'ac-mode-button-active' : ''}`}
                            aria-pressed={embeddedSession?.mode === mode}
                          >
                            <Icon className="h-3 w-3" aria-hidden="true" />
                            {launchingMode === mode ? 'Connecting…' : eyebrow}
                          </button>
                        ))}
                        {embeddedSession && (
                          <button type="button" onClick={() => setEmbeddedSession(null)} className="ac-mode-button" aria-label="Disconnect live channel">
                            <X className="h-3 w-3" aria-hidden="true" />
                            Disconnect
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="ac-live-terminal" aria-live="polite">
                      {embeddedSession ? (
                        <TerminalView
                          key={embeddedSession.id}
                          tabId={embeddedSession.id}
                          cwd={embeddedSession.cwd}
                          active={active}
                          launchCommand={embeddedSession.command}
                          destroyOnUnmount
                        />
                      ) : (
                        <div className="ac-live-empty">
                          <Radio className="h-6 w-6 text-[var(--ac-signal-bright)]" aria-hidden="true" />
                          <div className="mt-3 font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--ac-text-strong)]">Live PTY ready</div>
                          <p className="mt-2 max-w-md text-center text-[11px] leading-5 text-[var(--ac-muted)]">Attach interactively to watch and speak, or open the same harness stream in protected read-only mode.</p>
                          <div className="mt-4 flex flex-wrap justify-center gap-2">
                            {EMBEDDED_ACCESS_MODES.map(({ mode, Icon, title }) => (
                              <button key={mode} type="button" onClick={() => openHarnessAccess(selectedSeat, mode)} disabled={selectedSeatLaunchPending} className={mode === 'console' ? 'ac-button ac-button-signal' : 'ac-button ac-button-quiet'}>
                                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                                {launchingMode === mode ? 'Connecting…' : title}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="ac-control-deck" role="group" aria-label="Harness operator controls">
                      <div className="ac-control-identity">
                        <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                        <div>
                          <div className="ac-control-kicker">Harness control</div>
                          <div className="ac-control-state">
                            {controlState.available ? controlState.seatState : 'engine update required'}
                          </div>
                        </div>
                      </div>
                      <ControlReadout
                        label="Intake"
                        value={!controlState.available ? 'Unknown' : (controlState.paused ? 'Paused' : 'Open')}
                        tone={!controlState.available ? 'quiet' : (controlState.paused ? 'warning' : 'live')}
                      />
                      <ControlReadout
                        label="Turn"
                        value={!controlState.available ? 'Unknown' : (controlState.turnActive ? 'Running' : 'Idle')}
                        detail={controlState.steerable ? 'steer open' : 'no live steer'}
                        tone={controlState.turnActive ? 'signal' : 'quiet'}
                      />
                      <div className="ac-control-actions">
                        {controlState.paused ? (
                          <button
                            type="button"
                            className="ac-control-button ac-control-button-primary"
                            disabled={!controlState.canResume || selectedSeatControlPending}
                            onClick={() => runHarnessControl('resume')}
                          >
                            <Play className="h-3 w-3" aria-hidden="true" />
                            {pendingControl?.action === 'resume' ? 'Resuming…' : 'Resume intake'}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="ac-control-button"
                            disabled={!controlState.canPause || selectedSeatControlPending}
                            onClick={() => runHarnessControl('pause')}
                          >
                            <Pause className="h-3 w-3" aria-hidden="true" />
                            {pendingControl?.action === 'pause' ? 'Pausing…' : 'Pause intake'}
                          </button>
                        )}
                        <button
                          type="button"
                          className={`ac-control-button ac-control-button-danger ${cancelArmed ? 'ac-control-button-armed' : ''}`}
                          disabled={!controlState.canCancelTurn || selectedSeatControlPending}
                          onClick={() => {
                            if (cancelArmed) runHarnessControl('cancel-turn');
                            else setCancelArmed(true);
                          }}
                        >
                          <Octagon className="h-3 w-3" aria-hidden="true" />
                          {pendingControl?.action === 'cancel-turn'
                            ? 'Stopping…'
                            : (cancelArmed ? 'Confirm stop' : 'Stop turn')}
                        </button>
                      </div>
                    </div>
                    {controlFeedback && (
                      <div className={`ac-control-feedback ac-control-feedback-${controlFeedback.tone}`} role="status">
                        {controlFeedback.message}
                      </div>
                    )}
                  </div>
                  {launchError && <p className="mt-3 text-[11px] text-[var(--ac-danger)]" role="alert">{launchError}</p>}

                  <button type="button" onClick={() => openHarnessAccess(selectedSeat, 'shell')} className="ac-access-row mt-3 border-y border-[var(--ac-line)]">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-current">
                      <Terminal className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1 text-left">
                      <span className="block text-[9px] font-semibold uppercase tracking-[0.2em] opacity-65">Engine</span>
                      <span className="mt-0.5 block text-sm font-semibold">Open harness shell</span>
                      <span className="mt-1 block max-w-2xl text-[11px] leading-5 opacity-60">Open a separate terminal tab in the shared engine repository.</span>
                    </span>
                    <ArrowUpRight className="h-4 w-4 shrink-0" aria-hidden="true" />
                  </button>
                </div>

                <div className="border-t border-[var(--ac-line)] px-7 py-7">
                  <SectionLabel number="03" title="Wake queue" detail="Read directly from the harness ledger; no inferred activity." />
                  <div className="mt-4 grid grid-cols-3 border border-[var(--ac-line)]">
                    <Metric label="Working" value={queueCounts.working} tone="signal" />
                    <Metric label="Queued" value={queueCounts.queued} />
                    <Metric label="Dead" value={queueCounts.dead} tone={queueCounts.dead ? 'danger' : 'quiet'} />
                  </div>
                  <div className="mt-4 divide-y divide-[var(--ac-line)] border-y border-[var(--ac-line)]">
                    {(snapshot?.queue || []).length > 0 ? snapshot.queue.map((wake) => {
                      const actions = harnessQueueActions(wake, controlCapabilities);
                      const pendingThisWake = selectedSeatControlPending && pendingControl?.wakeId === wake.id;
                      const acknowledging = acknowledgingWakeId === wake.id;
                      return (
                        <div key={wake.id} className="ac-wake-row">
                          <div className="grid grid-cols-[64px_92px_minmax(0,1fr)_40px] items-start gap-3 font-mono text-[10px]">
                            <span className="text-[var(--ac-signal)]">#{wake.id}</span>
                            <span className={`uppercase ${wake.state === 'dead' ? 'text-[var(--ac-danger)]' : 'text-[var(--ac-text)]'}`}>{wake.state}</span>
                            <span className="min-w-0 truncate text-[var(--ac-muted-strong)]" title={wake.summary}>{wake.class}/{wake.source} · {wake.summary}</span>
                            <span className="text-right text-[var(--ac-muted)]">a{wake.attempts}</span>
                          </div>
                          {(actions.canRetry || actions.canAcknowledge) && (
                            <div className="ac-wake-actions">
                              <span className="mr-auto text-[9px] text-[var(--ac-muted)]">Dead-letter review required</span>
                              {actions.canRetry && (
                                <button
                                  type="button"
                                  className="ac-wake-button"
                                  disabled={selectedSeatControlPending}
                                  onClick={() => runHarnessControl('queue-retry', { wakeId: wake.id })}
                                >
                                  <RotateCcw className="h-3 w-3" aria-hidden="true" />
                                  {pendingThisWake && pendingControl?.action === 'queue-retry' ? 'Retrying…' : 'Retry'}
                                </button>
                              )}
                              {actions.canAcknowledge && (
                                <button
                                  type="button"
                                  className={`ac-wake-button ${acknowledging ? 'ac-wake-button-active' : ''}`}
                                  disabled={selectedSeatControlPending}
                                  onClick={() => {
                                    setAcknowledgingWakeId(acknowledging ? null : wake.id);
                                    setAckNote('');
                                  }}
                                >
                                  <Check className="h-3 w-3" aria-hidden="true" />
                                  Acknowledge
                                </button>
                              )}
                            </div>
                          )}
                          {acknowledging && actions.canAcknowledge && (
                            <form
                              className="ac-wake-ack"
                              onSubmit={(event) => {
                                event.preventDefault();
                                runHarnessControl('queue-acknowledge', { wakeId: wake.id, note: ackNote });
                              }}
                            >
                              <label htmlFor={`ack-note-${wake.id}`}>Review disposition</label>
                              <div className="mt-2 flex gap-2">
                                <input
                                  id={`ack-note-${wake.id}`}
                                  className="ac-input"
                                  value={ackNote}
                                  minLength={10}
                                  maxLength={500}
                                  required
                                  onChange={(event) => setAckNote(event.target.value)}
                                  placeholder="Reviewed the failure and confirmed this wake is terminal."
                                />
                                <button type="submit" className="ac-control-button ac-control-button-primary" disabled={selectedSeatControlPending || ackNote.trim().length < 10}>
                                  {pendingThisWake && pendingControl?.action === 'queue-acknowledge' ? 'Saving…' : 'Save review'}
                                </button>
                              </div>
                            </form>
                          )}
                        </div>
                      );
                    }) : (
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
                  <ContractRow label="Pause / resume" value={controlState.available ? 'Published' : 'Not published'} available={controlState.available} />
                  <ContractRow label="Turn interrupt" value={controlState.available ? 'Confirmation gated' : 'Not published'} available={controlState.available} />
                  <ContractRow label="Dead-wake review" value={controlCapabilities.queueAcknowledge ? 'Journalled' : 'Not published'} available={controlCapabilities.queueAcknowledge} />
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

function AgentPulsePanel({ pulse }) {
  const tone = pulseTone(pulse.disposition);
  const initiativeLabel = pulse.initiative.state.replaceAll('_', ' ');
  const CurrentIcon = pulse.currentAction ? Activity : CircleDotDashed;
  const NextIcon = pulse.nextAction ? Target : CircleDotDashed;
  const outcome = pulse.lastOutcome;
  const outcomeCandidate = outcome?.selectedCandidate?.title || outcome?.selectedCandidate?.id || '';

  return (
    <section className={`ac-pulse ac-pulse-${tone}`} aria-labelledby="agent-pulse-title">
      <div className="ac-pulse-heading">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-mono text-[9px] text-[var(--ac-signal)]">01</span>
          <h3 id="agent-pulse-title" className="font-display text-lg font-semibold text-[var(--ac-text-strong)]">Agent Pulse</h3>
          <p className="text-[11px] text-[var(--ac-muted)]">Engine-authored work state. No inferred activity.</p>
        </div>
        <span className={`ac-pulse-disposition ac-pulse-disposition-${tone}`}>
          <span className="ac-pulse-beacon" aria-hidden="true" />
          {pulse.available ? pulse.disposition : 'unavailable'}
        </span>
      </div>

      {!pulse.available ? (
        <div className="ac-pulse-unavailable">
          <CircleDotDashed className="h-5 w-5 shrink-0 text-[var(--ac-muted)]" aria-hidden="true" />
          <div>
            <div className="text-sm font-semibold text-[var(--ac-text-strong)]">Agent Pulse is not published by this engine.</div>
            <p className="mt-1 text-[11px] leading-5 text-[var(--ac-muted)]">The live terminal and typed controls still work. Update the harness engine to expose objective, action, and initiative evidence here.</p>
          </div>
        </div>
      ) : (
        <>
          <div className="ac-pulse-reason">
            {pulse.initiative.attentionRequired
              ? <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
              : <Activity className="h-4 w-4 shrink-0" aria-hidden="true" />}
            <div className="min-w-0">
              <div className="ac-pulse-kicker">Why this state · {pulse.reasonCode}</div>
              <div className="ac-pulse-reason-copy">{pulse.reasonSummary || 'The engine did not provide a summary.'}</div>
            </div>
            <time className="ac-pulse-updated" dateTime={pulse.updatedAt ? new Date(pulse.updatedAt * 1000).toISOString() : undefined}>
              {formatPulseTime(pulse.updatedAt, 'time unavailable')}
            </time>
          </div>

          <div className="ac-pulse-work">
            <div className="ac-pulse-objective">
              <div className="ac-pulse-kicker">Owned objective</div>
              <p>{pulse.objective || 'No durable objective is recorded.'}</p>
            </div>

            <div className="ac-pulse-chain" aria-label="Current and next work">
              <PulseAction
                Icon={CurrentIcon}
                label="Now"
                action={pulse.currentAction}
                empty="No turn is active"
              />
              <ArrowRight className="ac-pulse-arrow" aria-hidden="true" />
              <PulseAction
                Icon={NextIcon}
                label="Next"
                action={pulse.nextAction}
                empty="No executable next action"
              />
            </div>
          </div>

          <div className="ac-pulse-ledger">
            <div className="ac-pulse-ledger-item">
              <span>Initiative</span>
              <strong className={pulse.initiative.attentionRequired ? 'text-[var(--ac-danger)]' : ''}>{initiativeLabel}</strong>
              <small>{pulse.initiative.reasonCode || 'No initiative reason'}</small>
            </div>
            <div className="ac-pulse-ledger-item">
              <span>Next judgment</span>
              <strong>{formatPulseTime(pulse.initiative.nextJudgmentAt)}</strong>
              <small>{pulse.initiative.wakeId ? `wake #${pulse.initiative.wakeId}` : 'durable schedule'}</small>
            </div>
            <div className="ac-pulse-outcome">
              <div className="flex min-w-0 items-center gap-2">
                {outcome?.verified ? (
                  <Check className="h-3.5 w-3.5 shrink-0 text-[var(--ac-live)]" aria-hidden="true" />
                ) : (
                  <CircleDotDashed className="h-3.5 w-3.5 shrink-0 text-[var(--ac-muted)]" aria-hidden="true" />
                )}
                <div className="min-w-0">
                  <div className="ac-pulse-kicker">{outcome?.verified ? 'Last verified outcome' : 'Last recorded outcome'}</div>
                  <div className="ac-pulse-outcome-copy">
                    {outcome ? `${outcome.transition} · ${outcome.summary || 'No summary published.'}` : 'No drive outcome has been recorded yet.'}
                  </div>
                  {outcome && (outcomeCandidate || outcome.observedAt) && (
                    <div className="ac-pulse-outcome-meta">
                      {[
                        outcomeCandidate ? `candidate · ${outcomeCandidate}` : '',
                        outcome.observedAt ? `observed · ${formatPulseTime(outcome.observedAt)}` : '',
                      ].filter(Boolean).join('  /  ')}
                    </div>
                  )}
                </div>
              </div>
              {outcome?.evidence?.length > 0 && (
                <details className="ac-pulse-evidence">
                  <summary>{outcome.evidence.length} evidence {outcome.evidence.length === 1 ? 'item' : 'items'}</summary>
                  <ul>
                    {outcome.evidence.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}
                  </ul>
                </details>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

const PRESENCE_PRESENTATION = {
  turn_started: { label: 'Turn', Icon: Radio, tone: 'signal' },
  progress: { label: 'Mira', Icon: MessageSquareText, tone: 'voice' },
  tool_started: { label: 'Tool', Icon: Wrench, tone: 'tool' },
  tool_finished: { label: 'Tool', Icon: Check, tone: 'quiet' },
  operator_steered: { label: 'Kevin', Icon: ArrowRight, tone: 'operator' },
  operator_queued: { label: 'Kevin', Icon: Clock3, tone: 'operator' },
  still_working: { label: 'Active', Icon: Activity, tone: 'live' },
  milestone: { label: 'Done', Icon: Check, tone: 'live' },
  waiting: { label: 'Waiting', Icon: Clock3, tone: 'warning' },
  error: { label: 'Attention', Icon: TriangleAlert, tone: 'danger' },
};

function AgentPresencePanel({
  presence,
  agentLabel,
  turnActive,
  steerable,
  messageDraft,
  messagePending,
  messageFeedback,
  onMessageChange,
  onMessageSubmit,
}) {
  const feedRef = useRef(null);
  const events = presence.events.slice(-12);
  const latestId = events.at(-1)?.id;

  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [latestId]);

  return (
    <section className="ac-presence mt-4" aria-labelledby="agent-presence-title">
      <div className="ac-presence-heading">
        <div className="flex min-w-0 items-center gap-3">
          <span className={`ac-presence-radio ${turnActive ? 'ac-presence-radio-live' : ''}`} aria-hidden="true">
            <Radio className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <div id="agent-presence-title" className="font-display text-sm font-semibold text-[var(--ac-text-strong)]">Presence stream</div>
            <div className="mt-0.5 font-mono text-[8px] uppercase tracking-[0.16em] text-[var(--ac-muted)]">
              Public working notes · engine-observed tools · no private reasoning
            </div>
          </div>
        </div>
        <div className={`ac-presence-state ${turnActive ? 'ac-presence-state-live' : ''}`}>
          <span aria-hidden="true" />
          {turnActive ? 'On task' : 'Standing by'}
        </div>
      </div>

      <div ref={feedRef} className="ac-presence-feed" role="log" aria-live="polite" aria-relevant="additions text">
        {events.length > 0 ? events.map((item) => {
          const presentation = PRESENCE_PRESENTATION[item.kind] || PRESENCE_PRESENTATION.progress;
          const EventIcon = presentation.Icon;
          return (
            <div key={item.id} className={`ac-presence-event ac-presence-event-${presentation.tone}`}>
              <time dateTime={new Date(item.at * 1000).toISOString()}>{formatPresenceTime(item.at)}</time>
              <span className="ac-presence-node" aria-hidden="true"><EventIcon /></span>
              <div className="min-w-0">
                <div className="ac-presence-event-label">
                  {item.kind === 'progress' ? agentLabel : presentation.label}
                  {item.wakeId ? <span>wake #{item.wakeId}</span> : null}
                </div>
                <div className="ac-presence-event-copy">{item.summary}</div>
              </div>
            </div>
          );
        }) : (
          <div className="ac-presence-empty">
            <Activity className="h-4 w-4" aria-hidden="true" />
            <span>
              {presence.available
                ? `No public activity from ${agentLabel} yet. The next turn will write here.`
                : 'This seat needs the Presence-enabled harness update.'}
            </span>
          </div>
        )}
      </div>

      <form className="ac-presence-composer" onSubmit={onMessageSubmit}>
        <label htmlFor="agent-presence-message" className="sr-only">Speak to {agentLabel}</label>
        <input
          id="agent-presence-message"
          type="text"
          value={messageDraft}
          maxLength={2000}
          onChange={(event) => onMessageChange(event.target.value)}
          placeholder={steerable ? `Speak into ${agentLabel}'s active turn…` : `Queue the next turn for ${agentLabel}…`}
          className="ac-presence-input"
          disabled={messagePending || !presence.available}
        />
        <div className="ac-presence-delivery" aria-live="polite">
          {messageFeedback ? (
            <span className={`ac-presence-feedback ac-presence-feedback-${messageFeedback.tone}`}>{messageFeedback.message}</span>
          ) : (
            <span>{steerable ? 'Enter steers live' : 'Enter queues durably'}</span>
          )}
        </div>
        <button
          type="submit"
          className="ac-presence-send"
          disabled={messagePending || !presence.available || !messageDraft.trim()}
        >
          <Send className="h-3.5 w-3.5" aria-hidden="true" />
          {messagePending ? 'Sending…' : 'Speak'}
        </button>
      </form>
    </section>
  );
}

function PulseAction({ Icon, label, action, empty }) {
  return (
    <div className={`ac-pulse-action ${action ? '' : 'ac-pulse-action-empty'}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        <div className="ac-pulse-kicker">{label}</div>
        <div className="ac-pulse-action-title">{action?.title || empty}</div>
        <div className="ac-pulse-action-meta">
          {action ? [action.source, action.status, action.id].filter(Boolean).join(' · ') : 'engine idle'}
        </div>
      </div>
    </div>
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

function ControlReadout({ label, value, detail = '', tone = 'quiet' }) {
  return (
    <div className={`ac-control-readout ac-control-readout-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
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
