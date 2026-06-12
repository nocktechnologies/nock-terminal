const { sanitizeDevRoots, sanitizeStringList } = require('./security-utils');

const SETTINGS_SCHEMA_KEY = 'schemaVersion';
const SETTINGS_SCHEMA_VERSION = 1;
const INTERNAL_SETTINGS_KEYS = new Set(['secureSettings']);

const DEFAULT_SETTINGS = {
  windowBounds: { width: 1400, height: 900 },
  // General
  startMinimized: false,
  alwaysOnTop: false,
  launchAtStartup: false,
  windowOpacity: 100,
  // AI / Models
  ollamaUrl: 'http://localhost:11434',
  defaultModel: 'qwen3.5:9b',
  // Terminal
  terminalFontSize: 16,
  terminalFontFamily: "'JetBrains Mono', 'Consolas', monospace",
  defaultShell: '',
  shellArgs: '',
  scrollbackSize: 5000,
  cursorStyle: 'block',
  cursorBlink: true,
  // Editor
  editorFontFamily: "'JetBrains Mono', 'Consolas', monospace",
  editorFontSize: 15,
  editorMinimap: false,
  editorWordWrap: false,
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
  onboardingComplete: false,
  // Projects
  devRoots: process.platform === 'win32' ? ['C:\\Dev'] : [],
  projectSkipList: ['Gym-App', 'github.com-kkwills13-nock-technologies-site'],
  // NockCC integration
  nockccApiKey: '',
  nockccUrl: 'https://cc.nocktechnologies.io',
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

function normalizeString(value, { maxLength = 500, trim = true, allowControl = false } = {}) {
  if (typeof value !== 'string') return invalid();
  const normalized = trim ? value.trim() : value;
  if (normalized.length > maxLength) return invalid();
  if (!allowControl && /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(normalized)) return invalid();
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

function normalizeShellPath(value) {
  const normalized = normalizeString(value, { maxLength: 1000 });
  if (!normalized.ok) return normalized;
  if (!normalized.value) return ok('');

  const base = normalized.value.split(/[\\/]/).pop().toLowerCase();
  const allowedNames = process.platform === 'win32'
    ? new Set(['pwsh.exe', 'powershell.exe', 'cmd.exe', 'wsl.exe', 'pwsh', 'powershell', 'cmd', 'wsl'])
    : new Set(['zsh', 'bash', 'fish', 'dash', 'sh']);
  const hasPathSeparator = /[\\/]/.test(normalized.value);

  if (!allowedNames.has(base)) return invalid();
  if (process.platform !== 'win32' && !normalized.value.startsWith('/')) return invalid();
  if (process.platform === 'win32' && !hasPathSeparator && !allowedNames.has(normalized.value.toLowerCase())) return invalid();

  return ok(normalized.value);
}

function normalizeShellArgs(value) {
  const normalized = normalizeString(value, { maxLength: 1000, trim: false });
  if (!normalized.ok) return normalized;
  if (/[\r\n\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(normalized.value)) return invalid();
  return normalized;
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
  'cursorBlink',
  'editorMinimap',
  'editorWordWrap',
  'telegramEnabled',
  'telegramNotifyPrMerged',
  'telegramNotifyBuildComplete',
  'telegramNotifySessionEnded',
  'telegramNotifyFenceEvent',
  'autoCaptureSessions',
  'sidebarCollapsed',
  'onboardingComplete',
]);

const STRING_KEYS = {
  defaultModel: { maxLength: 200 },
  terminalFontFamily: { maxLength: 200, trim: false },
  editorFontFamily: { maxLength: 200, trim: false },
  telegramBotToken: { maxLength: 500 },
  telegramChatId: { maxLength: 200 },
  nockccApiKey: { maxLength: 500 },
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
    case 'nockccUrl':
      return normalizeUrl(value);
    case 'terminalFontSize':
    case 'editorFontSize':
      return normalizeInteger(value, { min: 10, max: 24 });
    case 'scrollbackSize':
      return normalizeInteger(value, { min: 1000, max: 50000 });
    case 'defaultShell':
      return normalizeShellPath(value);
    case 'shellArgs':
      return normalizeShellArgs(value);
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

function sortForStableStringify(value) {
  if (Array.isArray(value)) {
    return value.map(sortForStableStringify);
  }
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((sorted, key) => {
      sorted[key] = sortForStableStringify(value[key]);
      return sorted;
    }, {});
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(sortForStableStringify(value));
}

function canReplaceStoreObject(store) {
  let current = store;
  while (current) {
    const descriptor = Object.getOwnPropertyDescriptor(current, 'store');
    if (descriptor) return typeof descriptor.set === 'function';
    current = Object.getPrototypeOf(current);
  }
  return false;
}

function preserveInternalSettings(settings = {}) {
  const preserved = {};
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return preserved;
  }

  for (const key of INTERNAL_SETTINGS_KEYS) {
    const value = settings[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      preserved[key] = value;
    }
  }
  return preserved;
}

function migrateSettingsObject(settings = {}) {
  const source = settings && typeof settings === 'object' ? settings : {};
  return {
    ...sanitizeStoredSettings(source),
    ...preserveInternalSettings(source),
    [SETTINGS_SCHEMA_KEY]: SETTINGS_SCHEMA_VERSION,
  };
}

function migrateSettingsStore(store) {
  const current = store && typeof store.store === 'object' && store.store !== null
    ? store.store
    : {};
  const migrated = migrateSettingsObject(current);
  const currentKeys = Object.keys(current).sort();
  const migratedKeys = Object.keys(migrated).sort();
  const changed = stableStringify(currentKeys) !== stableStringify(migratedKeys)
    || migratedKeys.some((key) => stableStringify(current[key]) !== stableStringify(migrated[key]));

  if (changed && store) {
    if (canReplaceStoreObject(store)) {
      store.store = migrated;
    } else if (typeof store.clear === 'function' && typeof store.set === 'function') {
      store.clear();
      for (const [key, value] of Object.entries(migrated)) {
        store.set(key, value);
      }
    }
  }

  return {
    changed,
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    removedKeys: currentKeys.filter((key) => !Object.prototype.hasOwnProperty.call(migrated, key)),
  };
}

function isSensitiveSettingKey(key) {
  return /(?:token|secret|password|credential|private(?:_|-)?key|api(?:_|-)?key|apikey)/i.test(String(key || ''));
}

function sanitizeSettingsForExport(settings = {}) {
  const sanitized = sanitizeStoredSettings(settings);
  const exported = {};

  for (const [key, value] of Object.entries(sanitized)) {
    if (isSensitiveSettingKey(key)) continue;
    exported[key] = value;
  }

  return exported;
}

function sanitizeSettingsForRenderer(settings = {}) {
  const sanitized = sanitizeStoredSettings(settings);
  for (const key of Object.keys(sanitized)) {
    if (isSensitiveSettingKey(key)) {
      sanitized[key] = '';
    }
  }
  return sanitized;
}

function getSettingForRenderer(settings = {}, key) {
  if (!Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key)) {
    return undefined;
  }
  if (isSensitiveSettingKey(key)) {
    return undefined;
  }
  return sanitizeStoredSettings(settings)[key];
}

const SECURE_SETTING_KEYS = new Set(['telegramBotToken', 'nockccApiKey']);

function getSecureSettingStatus(settings = {}, key) {
  if (!SECURE_SETTING_KEYS.has(key)) return null;
  const sanitized = sanitizeStoredSettings(settings);
  return {
    key,
    configured: typeof sanitized[key] === 'string' && sanitized[key].length > 0,
  };
}

function cloneDefaultSettings() {
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}

function createSettingsResetSnapshot(settings = {}, { preserveWindowBounds = true } = {}) {
  const reset = cloneDefaultSettings();

  if (preserveWindowBounds) {
    const normalizedBounds = normalizeSettingValue('windowBounds', settings.windowBounds);
    if (normalizedBounds.ok) {
      reset.windowBounds = normalizedBounds.value;
    }
  }

  return reset;
}

module.exports = {
  DEFAULT_SETTINGS,
  SETTINGS_SCHEMA_KEY,
  SETTINGS_SCHEMA_VERSION,
  createSettingsResetSnapshot,
  getSecureSettingStatus,
  getSettingForRenderer,
  migrateSettingsStore,
  normalizeSettingValue,
  sanitizeSettingsForExport,
  sanitizeSettingsForRenderer,
  sanitizeStoredSettings,
};
