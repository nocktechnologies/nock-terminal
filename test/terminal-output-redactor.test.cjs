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

test('redacts numeric OSC 52 identifiers with leading zeros', () => {
  const standard = new TerminalOutputRedactor();
  const c1 = new TerminalOutputRedactor();

  assert.equal(
    [standard.redact('\x1b]0'), standard.redact('52;c;c2VjcmV0\x07')].join(''),
    '[OSC 52 clipboard request redacted]',
  );
  assert.equal(
    [c1.redact('\x9d00'), c1.redact('52;c;c2VjcmV0\x9c')].join(''),
    '[OSC 52 clipboard request redacted]',
  );
});

test('matches xterm control handling while parsing an OSC identifier', () => {
  const redactor = new TerminalOutputRedactor();

  assert.equal(
    redactor.redact('\x1b]5\x002;c;c2VjcmV0\x07'),
    '[OSC 52 clipboard request redacted]',
  );
});

test('bounds malformed OSC identifiers without missing a later numeric 52', () => {
  const redactor = new TerminalOutputRedactor();
  const leadingZeros = '0'.repeat(10_000);

  assert.equal(
    redactor.redact(`\x1b]${leadingZeros}52;c;c2VjcmV0\x07`),
    '[OSC 52 clipboard request redacted]',
  );

  const malformed = new TerminalOutputRedactor().redact(`\x1b]${leadingZeros}1;visible`);
  assert.ok(malformed.length < 200);
  assert.match(malformed, /\[identifier truncated\];visible$/);
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

test('resumes capture or starts a new OSC after a C1 transition', () => {
  const aborted = new TerminalOutputRedactor();
  const nested = new TerminalOutputRedactor();

  assert.equal(
    aborted.redact('\x1b]52;c;c2VjcmV0\x9bvisible'),
    '[OSC 52 clipboard request redacted]\x9bvisible',
  );
  assert.equal(
    nested.redact('\x1b]52;c;b25l\x9d052;c;dHdv\x07'),
    '[OSC 52 clipboard request redacted][OSC 52 clipboard request redacted]',
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
