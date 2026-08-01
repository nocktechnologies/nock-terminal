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
