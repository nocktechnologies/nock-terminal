const HARNESS_MODES = new Set(['console', 'watch', 'shell']);
const HARNESS_CONTROL_ACTIONS = new Set([
  'status',
  'pause',
  'resume',
  'cancel-turn',
  'queue-retry',
  'queue-acknowledge',
]);

function error(code, message) {
  return { success: false, code, error: message };
}

function requestSeat(payload, getSettingsSnapshot) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { error: error('IPC_VALIDATION_ERROR', 'Harness request payload must be an object.') };
  }
  if (typeof payload.seatId !== 'string' || !payload.seatId || payload.seatId.length > 400) {
    return { error: error('IPC_VALIDATION_ERROR', 'Harness request needs a valid seat id.') };
  }
  const seats = getSettingsSnapshot()?.harnessSeats;
  const seat = Array.isArray(seats) ? seats.find((entry) => entry?.id === payload.seatId) : null;
  if (!seat) {
    return { error: error('HARNESS_SEAT_NOT_FOUND', 'That harness seat is not configured.') };
  }
  return { seat };
}

function registerHarnessIPC({ ipcMain, service, getSettingsSnapshot }) {
  const snapshotInFlight = new Map();

  ipcMain.handle('harness:list', () => {
    const seats = getSettingsSnapshot()?.harnessSeats;
    return Array.isArray(seats) ? seats.map((seat) => ({ ...seat })) : [];
  });

  ipcMain.handle('harness:snapshot', (_, payload) => {
    const resolved = requestSeat(payload, getSettingsSnapshot);
    if (resolved.error) return resolved.error;
    const existing = snapshotInFlight.get(resolved.seat.id);
    if (existing) return existing;

    const pending = Promise.resolve(service.snapshot(resolved.seat)).finally(() => {
      if (snapshotInFlight.get(resolved.seat.id) === pending) {
        snapshotInFlight.delete(resolved.seat.id);
      }
    });
    snapshotInFlight.set(resolved.seat.id, pending);
    return pending;
  });

  ipcMain.handle('harness:launch', (_, payload) => {
    const resolved = requestSeat(payload, getSettingsSnapshot);
    if (resolved.error) return resolved.error;
    if (!HARNESS_MODES.has(payload.mode)) {
      return error('IPC_VALIDATION_ERROR', 'Harness launch mode must be console, watch, or shell.');
    }
    return service.launch(resolved.seat, payload.mode, {
      shell: getSettingsSnapshot()?.defaultShell,
    });
  });

  ipcMain.handle('harness:control', (_, payload) => {
    const resolved = requestSeat(payload, getSettingsSnapshot);
    if (resolved.error) return resolved.error;
    if (!HARNESS_CONTROL_ACTIONS.has(payload.action)) {
      return error('IPC_VALIDATION_ERROR', 'Harness control action is not supported.');
    }

    const options = { operator: 'nock-terminal' };
    if (payload.action === 'queue-retry' || payload.action === 'queue-acknowledge') {
      if (!Number.isSafeInteger(payload.wakeId) || payload.wakeId < 1) {
        return error('IPC_VALIDATION_ERROR', 'Queue controls require a positive wake id.');
      }
      options.wakeId = payload.wakeId;
    }
    if (payload.action === 'queue-acknowledge') {
      if (typeof payload.note !== 'string' || payload.note.trim().length < 10 || payload.note.trim().length > 500) {
        return error('IPC_VALIDATION_ERROR', 'Acknowledging a wake requires a 10–500 character review note.');
      }
      options.note = payload.note.trim();
    }
    return service.control(resolved.seat, payload.action, options);
  });
}

module.exports = {
  registerHarnessIPC,
};
