const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const FileService = require('../electron/file-service');

function makeSandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nock-terminal-file-service-'));
  test.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

function createStore(devRoots) {
  return {
    get(key) {
      if (key === 'devRoots') return devRoots;
      return undefined;
    },
  };
}

test('write rejects non-string content', () => {
  const sandbox = makeSandbox();
  const root = path.join(sandbox, 'workspace');
  const filePath = path.join(root, 'notes.txt');

  fs.mkdirSync(root, { recursive: true });

  const fileService = new FileService(createStore([root]));
  const result = fileService.write(filePath, { nope: true });

  assert.equal(result.success, false);
  assert.match(result.error, /Content must be a string/);
});

test('write does not follow a pre-created temp-file symlink', { skip: process.platform === 'win32' }, () => {
  const sandbox = makeSandbox();
  const root = path.join(sandbox, 'workspace');
  const outsideDir = path.join(sandbox, 'outside');
  const filePath = path.join(root, 'notes.txt');
  const outsideFile = path.join(outsideDir, 'escape.txt');
  const tmpPath = `${filePath}.nock-tmp`;

  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(outsideDir, { recursive: true });
  fs.writeFileSync(outsideFile, 'outside', 'utf8');
  fs.symlinkSync(outsideFile, tmpPath);

  const fileService = new FileService(createStore([root]));
  const result = fileService.write(filePath, 'updated');

  assert.equal(result.success, false);
  assert.equal(fs.readFileSync(outsideFile, 'utf8'), 'outside');
});
