const path = require('path');

const MAX_HARNESS_SEATS = 24;
const SSH_HOST = /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,253}[A-Za-z0-9])?$/;
const SSH_USER = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;
const AGENT_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

function cleanString(value, maxLength) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) return '';
  if (/[\u0000-\u001F\u007F]/.test(normalized)) return '';
  return normalized;
}

function normalizeHarnessSeat(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const label = cleanString(value.label, 80);
  const agent = cleanString(value.agent, 64).toLowerCase();
  const host = cleanString(value.host, 255);
  const user = cleanString(value.user, 64);
  const rawEnginePath = cleanString(value.enginePath, 1000);
  const port = value.port === undefined ? 22 : value.port;

  if (!label || !AGENT_NAME.test(agent) || !SSH_HOST.test(host) || !SSH_USER.test(user)) {
    return null;
  }
  if (!rawEnginePath.startsWith('/') || rawEnginePath.includes('%')) return null;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;

  const enginePath = path.posix.normalize(rawEnginePath);
  if (enginePath === '/' || path.posix.basename(enginePath) !== 'nock-agent-harness') return null;

  return {
    id: `${user}@${host}:${port}/${agent}`,
    label,
    agent,
    host,
    user,
    port,
    enginePath,
    transport: 'ssh',
  };
}

function normalizeHarnessSeats(value) {
  if (!Array.isArray(value) || value.length > MAX_HARNESS_SEATS) return null;
  const seats = [];
  const seen = new Set();

  for (const candidate of value) {
    const seat = normalizeHarnessSeat(candidate);
    if (!seat || seen.has(seat.id)) return null;
    seen.add(seat.id);
    seats.push(seat);
  }
  return seats;
}

module.exports = {
  MAX_HARNESS_SEATS,
  normalizeHarnessSeat,
  normalizeHarnessSeats,
};
