const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_SETTINGS,
  normalizeSettingValue,
  sanitizeSettingsForExport,
  sanitizeStoredSettings,
} = require('../electron/settings-utils');

test('normalizeSettingValue rejects invalid types for known settings', () => {
  assert.equal(normalizeSettingValue('windowOpacity', '100').ok, false);
  assert.equal(normalizeSettingValue('temperature', { bad: true }).ok, false);
  assert.equal(normalizeSettingValue('alwaysOnTop', 'yes').ok, false);
  assert.equal(normalizeSettingValue('ollamaUrl', 'ftp://localhost:11434').ok, false);
  assert.equal(normalizeSettingValue('telegramQuietStart', '25:99').ok, false);
  assert.equal(normalizeSettingValue('defaultShell', '/tmp/evil').ok, false);
  assert.equal(normalizeSettingValue('shellArgs', '--login\n-c whoami').ok, false);
});

test('normalizeSettingValue accepts valid values across setting groups', () => {
  assert.deepEqual(normalizeSettingValue('windowBounds', { width: 1600, height: 900, x: 10, y: 20 }), {
    ok: true,
    value: { width: 1600, height: 900, x: 10, y: 20 },
  });
  assert.deepEqual(normalizeSettingValue('windowOpacity', 85), { ok: true, value: 85 });
  assert.deepEqual(normalizeSettingValue('temperature', 1.2), { ok: true, value: 1.2 });
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
    maxTokens: 1024,
  });

  assert.equal(sanitized.windowOpacity, DEFAULT_SETTINGS.windowOpacity);
  assert.equal(sanitized.alwaysOnTop, DEFAULT_SETTINGS.alwaysOnTop);
  assert.equal(sanitized.ollamaUrl, DEFAULT_SETTINGS.ollamaUrl);
  assert.equal(sanitized.cursorStyle, DEFAULT_SETTINGS.cursorStyle);
  assert.equal(sanitized.maxTokens, 1024);
});

test('sanitizeSettingsForExport excludes current and future token-like values', () => {
  const exported = sanitizeSettingsForExport({
    theme: 'dark',
    telegramBotToken: '123:secret',
    nockccApiKey: 'nock-secret',
    futureAccessToken: 'future-secret',
    nested: { apiToken: 'nested-secret' },
    projectSkipList: ['ok'],
  });

  assert.equal(exported.theme, 'dark');
  assert.deepEqual(exported.projectSkipList, ['ok']);
  assert.equal(exported.telegramBotToken, undefined);
  assert.equal(exported.nockccApiKey, undefined);
  assert.equal(exported.futureAccessToken, undefined);
  assert.equal(exported.nested, undefined);
});
