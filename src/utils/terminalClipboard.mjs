const MAX_OSC52_BYTES = 256 * 1024;
const OSC52_SELECTION = /^[cpsq0-7]*$/;
const BASE64_PAYLOAD = /^[A-Za-z0-9+/]*={0,2}$/;

export const OSC52_COPY_WINDOW_MS = 2000;

export function decodeOsc52Clipboard(data) {
  if (typeof data !== 'string') return null;

  const separator = data.indexOf(';');
  if (separator < 0 || !OSC52_SELECTION.test(data.slice(0, separator))) return null;

  const payload = data.slice(separator + 1);
  if (!payload || payload === '?' || payload.length > Math.ceil(MAX_OSC52_BYTES * 4 / 3) + 4) return null;
  if (!BASE64_PAYLOAD.test(payload) || payload.length % 4 === 1) return null;

  try {
    const padded = payload.padEnd(Math.ceil(payload.length / 4) * 4, '=');
    const binary = atob(padded);
    if (binary.length > MAX_OSC52_BYTES) return null;
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export function decodeAuthorizedOsc52Clipboard(data, {
  active,
  focused,
  armedUntil,
  now = Date.now(),
}) {
  if (!active || !focused || !Number.isFinite(armedUntil) || armedUntil <= now) return null;
  return decodeOsc52Clipboard(data);
}
