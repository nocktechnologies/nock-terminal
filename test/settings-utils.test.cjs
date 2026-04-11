const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_SETTINGS,
  normalizeSettingValue,
  sanitizeStoredSettings,
} = require('../electron/settings-utils');

test('normalizeSettingValue rejects invalid types for known settings', () => {
  assert.equal(normalizeSettingValue('windowOpacity', '100').ok, false);
  assert.equal(normalizeSettingValue('temperature', { bad: true }).ok, false);
  assert.equal(normalizeSettingValue('alwaysOnTop', 'yes').ok, false);
  assert.equal(normalizeSettingValue('ollamaUrl', 'ftp://localhost:11434').ok, false);
  assert.equal(normalizeSettingValue('telegramQuietStart', '25:99').ok, false);
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
