const HARNESS_MODES = new Set(['console', 'watch', 'shell']);

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
  ipcMain.handle('harness:list', () => {
    const seats = getSettingsSnapshot()?.harnessSeats;
    return Array.isArray(seats) ? seats.map((seat) => ({ ...seat })) : [];
  });

  ipcMain.handle('harness:snapshot', async (_, payload) => {
    const resolved = requestSeat(payload, getSettingsSnapshot);
    if (resolved.error) return resolved.error;
    return service.snapshot(resolved.seat);
  });

  ipcMain.handle('harness:launch', (_, payload) => {
    const resolved = requestSeat(payload, getSettingsSnapshot);
    if (resolved.error) return resolved.error;
    if (!HARNESS_MODES.has(payload.mode)) {
      return error('IPC_VALIDATION_ERROR', 'Harness launch mode must be console, watch, or shell.');
    }
    return service.launch(resolved.seat, payload.mode);
  });
}

module.exports = {
  registerHarnessIPC,
};
