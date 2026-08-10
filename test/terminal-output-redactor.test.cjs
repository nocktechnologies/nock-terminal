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

test('resumes capture when CAN or SUB aborts OSC 52', () => {
  const redactor = new TerminalOutputRedactor();

  assert.equal(
    redactor.redact('\x1b]52;c;c2VjcmV0\x18visible'),
    '[OSC 52 clipboard request redacted]visible',
  );
  assert.equal(
    redactor.redact('\x1b]52;c;c2VjcmV0\x1avisible'),
    '[OSC 52 clipboard request redacted]visible',
  );
});

test('reprocesses a non-ST escape after an OSC 52 value', () => {
  const redactor = new TerminalOutputRedactor();
  const output = [
    redactor.redact('\x1b]52;c;c2VjcmV0\x1b'),
    redactor.redact('[31mvisible'),
  ].join('');

  assert.equal(output, '[OSC 52 clipboard request redacted]\x1b[31mvisible');
});

test('preserves non-clipboard terminal escape sequences', () => {
  const redactor = new TerminalOutputRedactor();

  assert.equal(redactor.redact('before\x1b['), 'before\x1b[');
  assert.equal(redactor.redact('31mred\x1b[0m'), '31mred\x1b[0m');
});
