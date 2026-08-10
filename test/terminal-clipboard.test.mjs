import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decodeOsc52ClipboardRequest,
  decodeOsc52Clipboard,
  getOsc52PromptDeadline,
} from '../src/utils/terminalClipboard.mjs';

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
  assert.equal(decodeOsc52Clipboard(osc52('x'.repeat(2001))), null);
});

test('rejects OSC 52 control characters hidden in clipboard text', () => {
  assert.equal(decodeOsc52Clipboard(osc52('safe prefix\rmalicious suffix')), null);
  assert.equal(decodeOsc52Clipboard(osc52('first line\nsecond line')), null);
  assert.equal(decodeOsc52Clipboard(osc52('safe\u202emalicious')), null);
  assert.equal(decodeOsc52Clipboard(osc52('safe\u200bmalicious')), null);
  assert.equal(decodeOsc52Clipboard(osc52('safe\u2028malicious')), null);
});

test('arms a prompt only for plain c in the active focused terminal', () => {
  const prompt = { active: true, focused: true, now: 1000 };

  assert.equal(getOsc52PromptDeadline('c', prompt), 3000);
  assert.equal(getOsc52PromptDeadline('c', { ...prompt, active: false }), 0);
  assert.equal(getOsc52PromptDeadline('c', { ...prompt, focused: false }), 0);
  assert.equal(getOsc52PromptDeadline('\u0003', prompt), 0);
});

test('offers a clipboard request only from a recent active focused gesture', () => {
  const data = osc52('https://claude.com/oauth');
  const promptable = { active: true, focused: true, armedUntil: 1200, now: 1000 };

  assert.equal(decodeOsc52ClipboardRequest(data, promptable), 'https://claude.com/oauth');
  assert.equal(decodeOsc52ClipboardRequest(data, { ...promptable, active: false }), null);
  assert.equal(decodeOsc52ClipboardRequest(data, { ...promptable, focused: false }), null);
  assert.equal(decodeOsc52ClipboardRequest(data, { ...promptable, now: 1200 }), null);
});
