const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('SplitPane gives pane contents a full-height flex container', () => {
  const source = readFileSync(path.join(__dirname, '../src/components/SplitPane.jsx'), 'utf8');

  assert.match(source, /className=\{`flex-1 flex min-h-0 min-w-0 overflow-hidden/);
  assert.match(source, /className="flex h-full min-h-0 min-w-0 overflow-hidden relative"/);
});
