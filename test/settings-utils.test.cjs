const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_SETTINGS,
  createSettingsResetSnapshot,
  normalizeSettingValue,
  sanitizeStoredSettings,
} = require('../electron/settings-utils');

test('normalizeSettingValue rejects invalid types for known settings', () => {
  assert.equal(normalizeSettingValue('windowOpacity', '100').ok, false);
  assert.equal(normalizeSettingValue('alwaysOnTop', 'yes').ok, false);
  assert.equal(normalizeSettingValue('ollamaUrl', 'ftp://localhost:11434').ok, false);
  assert.equal(normalizeSettingValue('telegramQuietStart', '25:99').ok, false);
});

test('normalizeSettingValue rejects removed no-op settings', () => {
  [
    'theme',
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
