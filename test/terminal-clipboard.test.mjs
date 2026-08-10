import assert from 'node:assert/strict';
import test from 'node:test';

import { decodeOsc52Clipboard } from '../src/utils/terminalClipboard.mjs';

function osc52(text, selection = 'c') {
  return `${selection};${Buffer.from(text, 'utf8').toString('base64')}`;
}

test('decodes OSC 52 clipboard text', () => {
  assert.equal(
    decodeOsc52Clipboard(osc52('https://claude.com/oauth?code=true')),
    'https://claude.com/oauth?code=true',
  );
  assert.equal(decodeOsc52Clipboard(osc52('Mira says hello', '')), 'Mira says hello');
});

test('rejects OSC 52 queries and malformed payloads', () => {
  assert.equal(decodeOsc52Clipboard('c;?'), null);
  assert.equal(decodeOsc52Clipboard('invalid;SGVsbG8='), null);
  assert.equal(decodeOsc52Clipboard('c;not base64'), null);
  assert.equal(decodeOsc52Clipboard('c;A'), null);
});

test('rejects oversized OSC 52 payloads', () => {
  assert.equal(decodeOsc52Clipboard(osc52('x'.repeat(256 * 1024 + 1))), null);
});
