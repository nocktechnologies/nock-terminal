const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_SETTINGS,
  SETTINGS_SCHEMA_KEY,
  SETTINGS_SCHEMA_VERSION,
  createSettingsResetSnapshot,
  getSecureSettingStatus,
  getSettingForRenderer,
  migrateSettingsStore,
  normalizeSettingValue,
  sanitizeSettingsForExport,
  sanitizeStoredSettings,
} = require('../electron/settings-utils');

test('normalizeSettingValue rejects invalid types for known settings', () => {
  assert.equal(normalizeSettingValue('windowOpacity', '100').ok, false);
  assert.equal(normalizeSettingValue('alwaysOnTop', 'yes').ok, false);
  assert.equal(normalizeSettingValue('ollamaUrl', 'ftp://localhost:11434').ok, false);
  assert.equal(normalizeSettingValue('telegramQuietStart', '25:99').ok, false);
  assert.equal(normalizeSettingValue('defaultShell', '/tmp/evil').ok, false);
  assert.equal(normalizeSettingValue('shellArgs', '--login\n-c whoami').ok, false);
});

test('normalizeSettingValue rejects removed no-op settings', () => {
  [
    'theme',
    'claudeCodePath',
    'maraBriefPath',
    'systemPrompt',
    'temperature',
    'maxTokens',
    'showThinking',
    'bellSound',
    'copyOnSelect',
    'rightClickPaste',
    'fileTreeOpen',
    'showDotfiles',
    'desktopNotifications',
    'notificationSound',
    'notifyPrMerged',
    'notifyBuildComplete',
    'notifySessionEnded',
    'notifyFenceEvent',
  ].forEach((key) => {
    assert.equal(normalizeSettingValue(key, DEFAULT_SETTINGS[key]).ok, false, key);
  });
});

test('normalizeSettingValue accepts valid values across setting groups', () => {
  assert.deepEqual(normalizeSettingValue('windowBounds', { width: 1600, height: 900, x: 10, y: 20 }), {
    ok: true,
    value: { width: 1600, height: 900, x: 10, y: 20 },
  });
  assert.deepEqual(normalizeSettingValue('windowOpacity', 85), { ok: true, value: 85 });
  assert.deepEqual(normalizeSettingValue('ollamaUrl', 'http://localhost:11434/'), {
    ok: true,
    value: 'http://localhost:11434',
  });
  assert.deepEqual(normalizeSettingValue('cursorStyle', 'underline'), {
    ok: true,
    value: 'underline',
  });
});

test('sanitizeStoredSettings falls back to defaults for invalid persisted values', () => {
  const sanitized = sanitizeStoredSettings({
    windowOpacity: 'loud',
    alwaysOnTop: 'nope',
    ollamaUrl: 'not-a-url',
    cursorStyle: 'triangle',
    terminalFontSize: 18,
  });

  assert.equal(sanitized.windowOpacity, DEFAULT_SETTINGS.windowOpacity);
  assert.equal(sanitized.alwaysOnTop, DEFAULT_SETTINGS.alwaysOnTop);
  assert.equal(sanitized.ollamaUrl, DEFAULT_SETTINGS.ollamaUrl);
  assert.equal(sanitized.cursorStyle, DEFAULT_SETTINGS.cursorStyle);
  assert.equal(sanitized.terminalFontSize, 18);
});

test('migrateSettingsStore stamps current schema and removes legacy settings', () => {
  const backing = {
    theme: 'dark',
    systemPrompt: 'removed prompt',
    temperature: 0.4,
    defaultModel: 'llama3.2',
    windowOpacity: 'invalid',
    telegramBotToken: 'keep-secret',
  };
  const fakeStore = {
    get store() {
      return backing;
    },
    clear() {
      for (const key of Object.keys(backing)) delete backing[key];
    },
    set(key, value) {
      backing[key] = value;
    },
  };

  const result = migrateSettingsStore(fakeStore);

  assert.equal(result.changed, true);
  assert.equal(backing[SETTINGS_SCHEMA_KEY], SETTINGS_SCHEMA_VERSION);
  assert.equal(backing.theme, undefined);
  assert.equal(backing.systemPrompt, undefined);
  assert.equal(backing.temperature, undefined);
  assert.equal(backing.defaultModel, 'llama3.2');
  assert.equal(backing.windowOpacity, DEFAULT_SETTINGS.windowOpacity);
  assert.equal(backing.telegramBotToken, 'keep-secret');

  assert.equal(migrateSettingsStore(fakeStore).changed, false);
});

test('migrateSettingsStore uses whole-store replacement when available', () => {
  let backing = {
    theme: 'dark',
    defaultModel: 'llama3.2',
  };
  let writes = 0;
  class FakeElectronStore {
    get store() {
      return backing;
    }

    set store(value) {
      writes += 1;
      backing = value;
    }

    clear() {
      throw new Error('clear should not be used');
    }

    set() {
      throw new Error('set should not be used');
    }
  }

  const result = migrateSettingsStore(new FakeElectronStore());

  assert.equal(result.changed, true);
  assert.equal(writes, 1);
  assert.equal(backing.theme, undefined);
  assert.equal(backing.defaultModel, 'llama3.2');
  assert.equal(backing[SETTINGS_SCHEMA_KEY], SETTINGS_SCHEMA_VERSION);
});

test('migrateSettingsStore does not rewrite objects solely due to key order', () => {
  const backing = {
    ...DEFAULT_SETTINGS,
    windowBounds: { y: 24, x: 12, height: 900, width: 1600 },
    [SETTINGS_SCHEMA_KEY]: SETTINGS_SCHEMA_VERSION,
  };
  const fakeStore = {
    get store() {
      return backing;
    },
    clear() {
      throw new Error('clear should not be used');
    },
    set() {
      throw new Error('set should not be used');
    },
  };

  assert.equal(migrateSettingsStore(fakeStore).changed, false);
});

test('createSettingsResetSnapshot restores defaults and can preserve window bounds', () => {
  const currentBounds = { width: 1600, height: 900, x: 12, y: 24 };
  const reset = createSettingsResetSnapshot({
    windowBounds: currentBounds,
    alwaysOnTop: true,
    ollamaUrl: 'https://example.com',
    nockccApiKey: 'secret',
    systemPrompt: 'removed no-op',
  });

  assert.deepEqual(reset.windowBounds, currentBounds);
  assert.equal(reset.alwaysOnTop, DEFAULT_SETTINGS.alwaysOnTop);
  assert.equal(reset.ollamaUrl, DEFAULT_SETTINGS.ollamaUrl);
  assert.equal(reset.nockccApiKey, DEFAULT_SETTINGS.nockccApiKey);
  assert.equal(Object.prototype.hasOwnProperty.call(reset, 'systemPrompt'), false);
});

test('createSettingsResetSnapshot resets window bounds when requested', () => {
  const reset = createSettingsResetSnapshot(
    { windowBounds: { width: 1600, height: 900, x: 12, y: 24 } },
    { preserveWindowBounds: false }
  );

  assert.deepEqual(reset.windowBounds, DEFAULT_SETTINGS.windowBounds);
});

test('sanitizeSettingsForExport excludes sensitive values and preserves known safe settings', () => {
  const exported = sanitizeSettingsForExport({
    theme: 'dark',
    defaultModel: 'qwen3.5:9b',
    telegramBotToken: '123:secret',
    nockccApiKey: 'nock-secret',
    futureAccessToken: 'future-secret',
    nested: { apiToken: 'nested-secret' },
    projectSkipList: ['ok'],
  });

  assert.equal(exported.defaultModel, 'qwen3.5:9b');
  assert.equal(exported.theme, undefined);
  assert.deepEqual(exported.projectSkipList, ['ok']);
  assert.equal(exported.telegramBotToken, undefined);
  assert.equal(exported.nockccApiKey, undefined);
  assert.equal(exported.futureAccessToken, undefined);
  assert.equal(exported.nested, undefined);
});

test('getSettingForRenderer does not expose sensitive settings by key', () => {
  const settings = {
    defaultModel: 'llama3.2',
    telegramBotToken: '123:secret',
    nockccApiKey: 'nock-secret',
  };

  assert.equal(getSettingForRenderer(settings, 'defaultModel'), 'llama3.2');
  assert.equal(getSettingForRenderer(settings, 'telegramBotToken'), undefined);
  assert.equal(getSettingForRenderer(settings, 'nockccApiKey'), undefined);
  assert.equal(getSettingForRenderer(settings, 'notASetting'), undefined);
});

test('getSecureSettingStatus exposes only configured state for allowlisted secrets', () => {
  const settings = {
    telegramBotToken: '123:secret',
    nockccApiKey: '',
  };

  assert.deepEqual(getSecureSettingStatus(settings, 'telegramBotToken'), {
    key: 'telegramBotToken',
    configured: true,
  });
  assert.deepEqual(getSecureSettingStatus(settings, 'nockccApiKey'), {
    key: 'nockccApiKey',
    configured: false,
  });
  assert.equal(getSecureSettingStatus(settings, 'futureAccessToken'), null);
});
