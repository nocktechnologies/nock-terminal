const MAX_OSC52_BYTES = 8 * 1024;
const MAX_OSC52_CHARACTERS = 2000;
const OSC52_SELECTION = /^[cpsq0-7]*$/;
const BASE64_PAYLOAD = /^[A-Za-z0-9+/]*={0,2}$/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;
const INVISIBLE_UNICODE = /[\p{Cf}\p{Default_Ignorable_Code_Point}\p{Zl}\p{Zp}]/u;

const OSC52_PROMPT_WINDOW_MS = 2000;

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
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (
      text.length > MAX_OSC52_CHARACTERS
      || CONTROL_CHARACTERS.test(text)
      || INVISIBLE_UNICODE.test(text)
    ) return null;
    return text;
  } catch {
    return null;
  }
}

export function getOsc52PromptDeadline(data, {
  active,
  focused,
  now = Date.now(),
}) {
  return data === 'c' && active && focused ? now + OSC52_PROMPT_WINDOW_MS : 0;
}

export function decodeOsc52ClipboardRequest(data, {
  active,
  focused,
  armedUntil,
  now = Date.now(),
}) {
  if (!active || !focused || !Number.isFinite(armedUntil) || armedUntil <= now) return null;
  return decodeOsc52Clipboard(data);
}
