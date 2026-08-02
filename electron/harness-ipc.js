const { CONTROL_ACTIONS } = require('./harness-seat-service');

const HARNESS_MODES = new Set(['console', 'watch', 'shell']);

function error(code, message) {
  return { success: false, code, error: message };
}

function hasControlCharacters(value) {
  return [...String(value)].some((character) => {
    const code = character.codePointAt(0);
    return code < 32 || code === 127;
  });
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
  const controlInFlight = new Map();
  const messageInFlight = new Set();

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
    if (!CONTROL_ACTIONS.has(payload.action)) {
      return error('IPC_VALIDATION_ERROR', 'Harness control action is not supported.');
    }

    const options = {};
    if (payload.action === 'queue-retry' || payload.action === 'queue-acknowledge') {
      if (!Number.isSafeInteger(payload.wakeId) || payload.wakeId < 1) {
        return error('IPC_VALIDATION_ERROR', 'Queue controls require a positive wake id.');
      }
      options.wakeId = payload.wakeId;
    }
    if (payload.action === 'queue-acknowledge') {
      const note = typeof payload.note === 'string' ? payload.note.trim() : '';
      if (note.length < 10 || note.length > 500) {
        return error('IPC_VALIDATION_ERROR', 'Acknowledging a wake requires a 10–500 character review note.');
      }
      options.note = note;
    }
    if (controlInFlight.has(resolved.seat.id)) {
      return error('HARNESS_CONTROL_IN_FLIGHT', 'Another harness control is still awaiting confirmation for this seat.');
    }
    const pending = Promise.resolve(service.control(resolved.seat, payload.action, options)).finally(() => {
      if (controlInFlight.get(resolved.seat.id) === pending) {
        controlInFlight.delete(resolved.seat.id);
      }
    });
    controlInFlight.set(resolved.seat.id, pending);
    return pending;
  });

  ipcMain.handle('harness:message', (_, payload) => {
    const resolved = requestSeat(payload, getSettingsSnapshot);
    if (resolved.error) return resolved.error;
    const text = typeof payload.text === 'string' ? payload.text.trim() : '';
    if (text.length < 1 || text.length > 2000 || hasControlCharacters(text)) {
      return error('IPC_VALIDATION_ERROR', 'Harness messages must contain 1–2000 characters.');
    }
    if (messageInFlight.has(resolved.seat.id)) {
      return error('HARNESS_MESSAGE_IN_FLIGHT', 'Another operator message is still awaiting confirmation for this seat.');
    }
    messageInFlight.add(resolved.seat.id);
    return Promise.resolve(service.message(resolved.seat, text)).finally(() => {
      messageInFlight.delete(resolved.seat.id);
    });
  });
}

module.exports = {
  registerHarnessIPC,
};
