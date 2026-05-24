const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PromptStore = require('../electron/prompt-store');
const SessionHistory = require('../electron/session-history');

function makeTempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  test.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

test('prompt store migrates legacy frontmatter to schema-versioned markdown', () => {
  const dir = makeTempDir('nock-terminal-prompts-');
  const prompts = new PromptStore();
  prompts.dir = dir;
  prompts._ensureDir();

  const filePath = path.join(dir, 'legacy.md');
  fs.writeFileSync(
    filePath,
    [
      '---',
      'title: Legacy prompt',
      'tags: audit, migration',
      'updatedAt: 2026-05-01T12:00:00.000Z',
      '---',
      'Keep this body.',
    ].join('\n'),
    'utf8'
  );

  const loaded = prompts.get('legacy');
  assert.equal(loaded.schemaVersion, PromptStore.SCHEMA_VERSION);
  assert.equal(loaded.title, 'Legacy prompt');
  assert.deepEqual(loaded.tags, ['audit', 'migration']);
  assert.equal(loaded.updatedAt, '2026-05-01T12:00:00.000Z');
  assert.equal(loaded.body, 'Keep this body.');

  const persisted = fs.readFileSync(filePath, 'utf8');
  assert.match(persisted, /^---\nschemaVersion: 1\n/);
  assert.match(persisted, /title: Legacy prompt/);
  assert.match(persisted, /Keep this body\./);
});

test('prompt store migrates body-only legacy prompts without losing text', () => {
  const dir = makeTempDir('nock-terminal-prompts-');
  const prompts = new PromptStore();
  prompts.dir = dir;
  prompts._ensureDir();

  const filePath = path.join(dir, 'body-only.md');
  fs.writeFileSync(filePath, 'A useful old prompt.', 'utf8');

  const listed = prompts.list();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].schemaVersion, PromptStore.SCHEMA_VERSION);
  assert.equal(listed[0].title, 'Untitled');
  assert.equal(listed[0].body, 'A useful old prompt.');

  const persisted = fs.readFileSync(filePath, 'utf8');
  assert.match(persisted, /^---\nschemaVersion: 1\n/);
  assert.match(persisted, /A useful old prompt\./);
});

test('session history migrates legacy metadata files and ignores corrupt files', () => {
  const dir = makeTempDir('nock-terminal-sessions-');
  const history = new SessionHistory({ get: () => true });
  history.dir = dir;
  history._ensureDir();

  const legacyFile = path.join(dir, '100-tab-1.json');
  fs.writeFileSync(
    legacyFile,
    JSON.stringify({
      project: 'Legacy terminal',
      shell: '/bin/zsh',
      cwd: '/Users/kevin/Dev/nock-terminal',
      tabId: 'tab-1',
      startTime: 100,
      endTime: 250,
      exitCode: 0,
      unknownField: 'drop me',
    }),
    'utf8'
  );
  fs.writeFileSync(path.join(dir, '100-tab-1.txt'), 'output', 'utf8');
  fs.writeFileSync(path.join(dir, 'bad.json'), '{ nope', 'utf8');

  const sessions = history.list();
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].schemaVersion, SessionHistory.SCHEMA_VERSION);
  assert.equal(sessions[0].project, 'Legacy terminal');
  assert.equal(sessions[0].hasOutput, true);
  assert.equal(sessions[0].unknownField, undefined);

  const persisted = JSON.parse(fs.readFileSync(legacyFile, 'utf8'));
  assert.equal(persisted.schemaVersion, SessionHistory.SCHEMA_VERSION);
  assert.equal(persisted.unknownField, undefined);
});
