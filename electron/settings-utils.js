const { sanitizeDevRoots, sanitizeStringList } = require('./security-utils');

const DEFAULT_SETTINGS = {
  windowBounds: { width: 1400, height: 900 },
  // General
  theme: 'dark',
  startMinimized: false,
  alwaysOnTop: false,
  launchAtStartup: false,
  windowOpacity: 100,
  // AI / Models
  ollamaUrl: 'http://localhost:11434',
  defaultModel: 'qwen3.5:9b',
  systemPrompt: '',
  temperature: 0.7,
  maxTokens: 4096,
  showThinking: false,
  // Claude Code
  claudeCodePath: '',
  maraBriefPath: '',
  // Terminal
  terminalFontSize: 16,
  terminalFontFamily: "'JetBrains Mono', 'Consolas', monospace",
  defaultShell: '',
  shellArgs: '',
  scrollbackSize: 5000,
  cursorStyle: 'block',
  cursorBlink: true,
  bellSound: false,
  copyOnSelect: false,
  rightClickPaste: true,
  // Editor
  editorFontFamily: "'JetBrains Mono', 'Consolas', monospace",
  editorFontSize: 15,
  editorMinimap: false,
  editorWordWrap: false,
  // File Tree
  fileTreeOpen: true,
  showDotfiles: false,
  // Notifications
  desktopNotifications: true,
  notificationSound: false,
  notifyPrMerged: true,
  notifyBuildComplete: true,
  notifySessionEnded: true,
  notifyFenceEvent: false,
  // Telegram
  telegramEnabled: false,
  telegramBotToken: '',
  telegramChatId: '',
  telegramQuietStart: '22:00',
  telegramQuietEnd: '07:00',
  telegramNotifyPrMerged: true,
  telegramNotifyBuildComplete: true,
  telegramNotifySessionEnded: true,
  telegramNotifyFenceEvent: false,
  // Session
  autoCaptureSessions: false,
  // Layout
  sidebarCollapsed: false,
  // Projects
  devRoots: process.platform === 'win32' ? ['C:\\Dev'] : [],
  projectSkipList: ['Gym-App', 'github.com-kkwills13-nock-technologies-site'],
};

function ok(value) {
  return { ok: true, value };
}

function invalid() {
  return { ok: false, value: undefined };
}

function normalizeBoolean(value) {
  return typeof value === 'boolean' ? ok(value) : invalid();
}

function normalizeString(value, { maxLength = 500, trim = true } = {}) {
  if (typeof value !== 'string') return invalid();
  const normalized = trim ? value.trim() : value;
  if (normalized.length > maxLength) return invalid();
  return ok(normalized);
}

function normalizeStringEnum(value, allowedValues) {
  if (typeof value !== 'string') return invalid();
  return allowedValues.includes(value) ? ok(value) : invalid();
}

function normalizeInteger(value, { min, max } = {}) {
  if (!Number.isFinite(value)) return invalid();
  const normalized = Math.round(value);
  if ((min != null && normalized < min) || (max != null && normalized > max)) {
    return invalid();
  }
  return ok(normalized);
}

function normalizeNumber(value, { min, max, decimals } = {}) {
  if (!Number.isFinite(value)) return invalid();
  const factor = Number.isInteger(decimals) ? 10 ** decimals : 1;
  const normalized = factor > 1 ? Math.round(value * factor) / factor : value;
  if ((min != null && normalized < min) || (max != null && normalized > max)) {
    return invalid();
  }
  return ok(normalized);
}

function normalizeUrl(value) {
  const normalized = normalizeString(value, { maxLength: 1000 });
  if (!normalized.ok) return normalized;
  if (!normalized.value) return ok('');

  try {
    const parsed = new URL(normalized.value);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return invalid();
    }
    return ok(parsed.toString().replace(/\/$/, ''));
  } catch {
    return invalid();
  }
}

function normalizeTime(value) {
  const normalized = normalizeString(value, { maxLength: 5 });
  if (!normalized.ok) return normalized;
  if (!/^\d{2}:\d{2}$/.test(normalized.value)) return invalid();

  const [hours, minutes] = normalized.value.split(':').map(Number);
  if (hours > 23 || minutes > 59) return invalid();
  return ok(normalized.value);
}

function normalizeWindowBounds(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();

  const width = normalizeInteger(value.width, { min: 900, max: 10000 });
  const height = normalizeInteger(value.height, { min: 600, max: 10000 });
  if (!width.ok || !height.ok) return invalid();

  const normalized = {
    width: width.value,
    height: height.value,
  };

  if (value.x !== undefined) {
    const x = normalizeInteger(value.x, { min: -50000, max: 50000 });
    if (!x.ok) return invalid();
    normalized.x = x.value;
  }

  if (value.y !== undefined) {
    const y = normalizeInteger(value.y, { min: -50000, max: 50000 });
    if (!y.ok) return invalid();
    normalized.y = y.value;
  }

  return ok(normalized);
}

const BOOLEAN_KEYS = new Set([
  'startMinimized',
  'alwaysOnTop',
  'launchAtStartup',
  'showThinking',
  'cursorBlink',
  'bellSound',
  'copyOnSelect',
  'rightClickPaste',
  'editorMinimap',
  'editorWordWrap',
  'fileTreeOpen',
  'showDotfiles',
  'desktopNotifications',
  'notificationSound',
  'notifyPrMerged',
  'notifyBuildComplete',
  'notifySessionEnded',
  'notifyFenceEvent',
  'telegramEnabled',
  'telegramNotifyPrMerged',
  'telegramNotifyBuildComplete',
  'telegramNotifySessionEnded',
  'telegramNotifyFenceEvent',
  'autoCaptureSessions',
  'sidebarCollapsed',
]);

const STRING_KEYS = {
  theme: { maxLength: 40 },
  defaultModel: { maxLength: 200 },
  systemPrompt: { maxLength: 20000, trim: false },
  claudeCodePath: { maxLength: 1000 },
  maraBriefPath: { maxLength: 1000 },
  terminalFontFamily: { maxLength: 200, trim: false },
  defaultShell: { maxLength: 1000 },
  shellArgs: { maxLength: 1000, trim: false },
  editorFontFamily: { maxLength: 200, trim: false },
  telegramBotToken: { maxLength: 500 },
  telegramChatId: { maxLength: 200 },
};

function normalizeSettingValue(key, value) {
  if (!Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key)) {
    return invalid();
  }

  if (value === undefined) {
    return invalid();
  }

  if (key === 'windowBounds') {
    return normalizeWindowBounds(value);
  }

  if (BOOLEAN_KEYS.has(key)) {
    return normalizeBoolean(value);
  }

  if (Object.prototype.hasOwnProperty.call(STRING_KEYS, key)) {
    return normalizeString(value, STRING_KEYS[key]);
  }

  switch (key) {
    case 'windowOpacity':
      return normalizeInteger(value, { min: 70, max: 100 });
    case 'ollamaUrl':
      return normalizeUrl(value);
    case 'temperature':
      return normalizeNumber(value, { min: 0, max: 2, decimals: 1 });
    case 'maxTokens':
      return normalizeInteger(value, { min: 256, max: 32768 });
    case 'terminalFontSize':
    case 'editorFontSize':
      return normalizeInteger(value, { min: 10, max: 24 });
    case 'scrollbackSize':
      return normalizeInteger(value, { min: 1000, max: 50000 });
    case 'cursorStyle':
      return normalizeStringEnum(value, ['block', 'underline', 'bar']);
    case 'telegramQuietStart':
    case 'telegramQuietEnd':
      return normalizeTime(value);
    case 'devRoots':
      return ok(sanitizeDevRoots(value));
    case 'projectSkipList':
      return ok(sanitizeStringList(value, { maxItems: 200, maxLength: 120 }));
    default:
      return invalid();
  }
}

function sanitizeStoredSettings(settings = {}) {
  const sanitized = {};

  for (const [key, defaultValue] of Object.entries(DEFAULT_SETTINGS)) {
    const normalized = normalizeSettingValue(key, settings[key]);
    sanitized[key] = normalized.ok ? normalized.value : defaultValue;
  }

  return sanitized;
}

module.exports = {
  DEFAULT_SETTINGS,
  normalizeSettingValue,
  sanitizeStoredSettings,
};
