export function upsertHarnessSeat(seats, nextSeat) {
  const current = Array.isArray(seats) ? seats : [];
  const index = current.findIndex((seat) => seat?.id === nextSeat?.id);
  if (index === -1) return [...current, nextSeat];
  return current.map((seat, seatIndex) => seatIndex === index ? nextSeat : seat);
}

export function removeHarnessSeat(seats, seatId) {
  return (Array.isArray(seats) ? seats : []).filter((seat) => seat?.id !== seatId);
}

export function findHarnessSeatCollision(seats, candidateId, editingSeatId = '') {
  const current = Array.isArray(seats) ? seats : [];
  return current.find((seat) => seat?.id === candidateId && seat.id !== editingSeatId) || null;
}

export function harnessAccessSurface(mode) {
  return mode === 'shell' ? 'terminal' : 'embedded';
}

export function isHarnessLaunchPending(pendingLaunch, seatId, mode = '') {
  if (!pendingLaunch || pendingLaunch.seatId !== seatId) return false;
  return !mode || pendingLaunch.mode === mode;
}

export function isCurrentHarnessSeat(selectedSeatId, launchSeatId) {
  return Boolean(selectedSeatId) && selectedSeatId === launchSeatId;
}

export function harnessControlState(snapshot) {
  const control = snapshot?.control;
  const available = control?.available === true;
  const capabilities = available && control.capabilities && typeof control.capabilities === 'object'
    ? control.capabilities
    : {};
  return {
    available,
    seatState: available ? String(control.seatState || 'unknown') : 'unknown',
    paused: available && control.paused === true,
    turnActive: available && control.turn?.active === true,
    steerable: available && control.turn?.steerable === true,
    canPause: available && capabilities.pause === true,
    canResume: available && capabilities.resume === true,
    canCancelTurn: available && capabilities.cancelTurn === true,
    canQueueRetry: available && capabilities.queueRetry === true,
    canQueueAcknowledge: available && capabilities.queueAcknowledge === true,
  };
}

const EMPTY_AGENT_PULSE = Object.freeze({
  available: false,
  disposition: 'unknown',
  reasonCode: 'PULSE_UNAVAILABLE',
  reasonSummary: 'This engine has not published Agent Pulse yet.',
  objective: '',
  currentAction: null,
  nextAction: null,
  initiative: Object.freeze({
    state: 'unknown',
    reasonCode: '',
    attentionRequired: false,
    wakeId: null,
    nextJudgmentAt: null,
  }),
  lastOutcome: null,
  updatedAt: null,
});

export function harnessAgentPulse(snapshot) {
  const pulse = snapshot?.control?.available === true ? snapshot.control.pulse : null;
  if (!pulse || pulse.schemaVersion !== 1) {
    return {
      ...EMPTY_AGENT_PULSE,
      initiative: { ...EMPTY_AGENT_PULSE.initiative },
    };
  }
  return {
    available: true,
    disposition: String(pulse.disposition || 'unknown'),
    reasonCode: String(pulse.reason?.code || ''),
    reasonSummary: String(pulse.reason?.summary || ''),
    objective: String(pulse.objective || ''),
    currentAction: pulse.currentAction || null,
    nextAction: pulse.nextAction || null,
    initiative: pulse.initiative || { ...EMPTY_AGENT_PULSE.initiative },
    lastOutcome: pulse.lastOutcome || null,
    updatedAt: Number.isFinite(pulse.updatedAt) ? pulse.updatedAt : null,
  };
}

export function harnessPresence(snapshot) {
  const presence = snapshot?.control?.available === true ? snapshot.control.presence : null;
  if (!presence || presence.schemaVersion !== 1 || !Array.isArray(presence.events)) {
    return { available: false, events: [] };
  }
  return {
    available: true,
    events: presence.events,
  };
}

export function harnessQueueActions(wake, capabilities = {}) {
  const dead = wake?.state === 'dead';
  return {
    canRetry: dead && capabilities.queueRetry === true,
    canAcknowledge: dead && capabilities.queueAcknowledge === true,
  };
}
