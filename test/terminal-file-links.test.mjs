import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveTerminalFileCandidate } from '../src/utils/terminalFileLinks.mjs';

test('resolveTerminalFileCandidate resolves relative markdown paths from cwd', () => {
  assert.deepEqual(
    resolveTerminalFileCandidate('docs/ROADMAP.md:42', '/Users/kevin/Dev/nock-terminal'),
    { filePath: '/Users/kevin/Dev/nock-terminal/docs/ROADMAP.md' }
  );
});

test('resolveTerminalFileCandidate preserves absolute markdown paths', () => {
  assert.deepEqual(
    resolveTerminalFileCandidate('/Users/kevin/Dev/nock-terminal/README.md', '/Users/kevin/Dev/nock-terminal'),
    { filePath: '/Users/kevin/Dev/nock-terminal/README.md' }
  );
});

test('resolveTerminalFileCandidate decodes file URLs', () => {
  assert.deepEqual(
    resolveTerminalFileCandidate('file:///Users/kevin/Dev/nock-terminal/docs/Release%20Notes.md', '/Users/kevin/Dev/nock-terminal'),
    { filePath: '/Users/kevin/Dev/nock-terminal/docs/Release Notes.md' }
  );
});

test('resolveTerminalFileCandidate rejects non-markdown text and web URLs', () => {
  assert.equal(resolveTerminalFileCandidate('https://nocktechnologies.com/docs.md', '/repo'), null);
  assert.equal(resolveTerminalFileCandidate('npm run build', '/repo'), null);
});
