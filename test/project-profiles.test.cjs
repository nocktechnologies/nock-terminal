const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ProjectProfiles = require('../electron/project-profiles');

function makeProfilesStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nock-terminal-profiles-'));
  const profiles = new ProjectProfiles();
  profiles.dir = dir;
  profiles._ensureDir();
  test.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return profiles;
}

test('project profiles strip removed legacy fields on get, save, and list', () => {
  const profiles = makeProfilesStore();
  const projectPath = path.join(os.tmpdir(), 'nock-terminal-project');
  const filePath = profiles._filePath(projectPath);

  fs.writeFileSync(
    filePath,
    JSON.stringify({
      projectPath,
      defaultAgent: 'codex',
      preferredModel: 'removed-model',
      systemPrompt: 'removed prompt',
      notes: 'keep me',
    }),
    'utf8'
  );

  const loaded = profiles.get(projectPath);
  assert.equal(loaded.schemaVersion, ProjectProfiles.SCHEMA_VERSION);
  assert.equal(loaded.preferredModel, undefined);
  assert.equal(loaded.systemPrompt, undefined);
  assert.equal(loaded.notes, 'keep me');

  const listed = profiles.list();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].schemaVersion, ProjectProfiles.SCHEMA_VERSION);
  assert.equal(listed[0].preferredModel, undefined);
  assert.equal(listed[0].systemPrompt, undefined);
  assert.equal(listed[0].notes, 'keep me');
  assert.equal(listed[0].defaultShell, '');

  const saved = profiles.save(projectPath, {
    preferredModel: 'still removed',
    systemPrompt: 'still removed',
    notes: 'still keep',
  });
  assert.equal(saved.success, true);
  assert.equal(saved.data.preferredModel, undefined);
  assert.equal(saved.data.systemPrompt, undefined);
  assert.equal(saved.data.notes, 'still keep');

  const persisted = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.equal(persisted.schemaVersion, ProjectProfiles.SCHEMA_VERSION);
  assert.equal(persisted.preferredModel, undefined);
  assert.equal(persisted.systemPrompt, undefined);
  assert.equal(persisted.notes, 'still keep');
});

test('project profiles migrate legacy files in place and drop unknown fields', () => {
  const profiles = makeProfilesStore();
  const projectPath = path.join(os.tmpdir(), 'nock-terminal-legacy-project');
  const filePath = profiles._filePath(projectPath);

  fs.writeFileSync(
    filePath,
    JSON.stringify({
      projectPath,
      defaultAgent: 'codex',
      shellArgs: '--login',
      preferredModel: 'removed-model',
      unknownSetting: 'drop me',
    }),
    'utf8'
  );

  const loaded = profiles.get(projectPath);
  assert.equal(loaded.schemaVersion, ProjectProfiles.SCHEMA_VERSION);
  assert.equal(loaded.defaultAgent, 'codex');
  assert.equal(loaded.shellArgs, '--login');
  assert.equal(loaded.unknownSetting, undefined);
  assert.equal(loaded.preferredModel, undefined);

  const persisted = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.equal(persisted.schemaVersion, ProjectProfiles.SCHEMA_VERSION);
  assert.equal(persisted.unknownSetting, undefined);
  assert.equal(persisted.preferredModel, undefined);
});

test('project profiles reset invalid legacy default agents during migration', () => {
  const profiles = makeProfilesStore();
  const projectPath = path.join(os.tmpdir(), 'nock-terminal-invalid-agent-project');
  const filePath = profiles._filePath(projectPath);

  fs.writeFileSync(
    filePath,
    JSON.stringify({
      projectPath,
      defaultAgent: 'not-real',
      codexCommand: 'codex',
    }),
    'utf8'
  );

  const loaded = profiles.get(projectPath);
  assert.equal(loaded.defaultAgent, ProjectProfiles.DEFAULT_PROFILE.defaultAgent);
  assert.equal(loaded.codexCommand, 'codex');

  const persisted = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.equal(persisted.defaultAgent, ProjectProfiles.DEFAULT_PROFILE.defaultAgent);
});
