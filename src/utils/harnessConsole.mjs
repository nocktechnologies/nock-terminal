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

export function harnessQueueActions(wake, capabilities = {}) {
  const dead = wake?.state === 'dead';
  return {
    canRetry: dead && capabilities.queueRetry === true,
    canAcknowledge: dead && capabilities.queueAcknowledge === true,
  };
}
