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
  assert.equal(loaded.preferredModel, undefined);
  assert.equal(loaded.systemPrompt, undefined);
  assert.equal(loaded.notes, 'keep me');

  const listed = profiles.list();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].preferredModel, undefined);
  assert.equal(listed[0].systemPrompt, undefined);

  const saved = profiles.save(projectPath, {
    preferredModel: 'still removed',
    systemPrompt: 'still removed',
    notes: 'still keep',
  });
  assert.equal(saved.success, true);
  assert.equal(saved.data.preferredModel, undefined);
  assert.equal(saved.data.systemPrompt, undefined);
  assert.equal(saved.data.notes, 'still keep');
});
