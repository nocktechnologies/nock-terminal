const assert = require('node:assert/strict');
const test = require('node:test');

const TerminalOutputRedactor = require('../electron/terminal-output-redactor');

test('redacts OSC 52 clipboard values across PTY chunks', () => {
  const redactor = new TerminalOutputRedactor();
  const output = [
    redactor.redact('before\x1b]5'),
    redactor.redact('2;c;c2VjcmV0'),
    redactor.redact('\x07after'),
  ].join('');

  assert.equal(output, 'before[OSC 52 clipboard request redacted]after');
});

test('redacts ST-terminated and C1 OSC 52 clipboard values', () => {
  const redactor = new TerminalOutputRedactor();

  assert.equal(
    redactor.redact('\x1b]52;c;c2VjcmV0\x1b\\visible'),
    '[OSC 52 clipboard request redacted]visible',
  );
  assert.equal(
    redactor.redact('\x9d52;c;c2VjcmV0\x9cvisible'),
    '[OSC 52 clipboard request redacted]visible',
  );
});

test('preserves non-clipboard terminal escape sequences', () => {
  const redactor = new TerminalOutputRedactor();

  assert.equal(redactor.redact('before\x1b['), 'before\x1b[');
  assert.equal(redactor.redact('31mred\x1b[0m'), '31mred\x1b[0m');
});
