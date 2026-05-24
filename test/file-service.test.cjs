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

test('tree returns bounded entries with truncation metadata', () => {
  const sandbox = makeSandbox();
  const root = path.join(sandbox, 'workspace');
  fs.mkdirSync(root, { recursive: true });

  for (let index = 0; index < 8; index += 1) {
    fs.writeFileSync(path.join(root, `file-${index}.txt`), String(index), 'utf8');
  }

  const fileService = new FileService(createStore([root]));
  const result = fileService.tree(root, { maxEntries: 3 });

  assert.equal(Array.isArray(result.entries), true);
  assert.equal(result.entries.length, 3);
  assert.equal(result.meta.truncated, true);
  assert.equal(result.meta.truncatedByEntries, true);
  assert.equal(result.meta.entryCount, 3);
  assert.equal(result.meta.maxEntries, 3);
});

test('tree reports partial results when depth is capped', () => {
  const sandbox = makeSandbox();
  const root = path.join(sandbox, 'workspace');
  const nested = path.join(root, 'a', 'b', 'c');
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(nested, 'deep.txt'), 'deep', 'utf8');

  const fileService = new FileService(createStore([root]));
  const result = fileService.tree(root, { maxDepth: 1 });

  assert.equal(result.meta.truncated, true);
  assert.equal(result.meta.truncatedByDepth, true);
  assert.equal(result.meta.maxDepth, 1);
  assert.deepEqual(result.entries.map(entry => entry.name), ['a']);
  assert.deepEqual(result.entries[0].children, []);
});

test('read returns a preview for large files without reading the whole file', () => {
  const sandbox = makeSandbox();
  const root = path.join(sandbox, 'workspace');
  const filePath = path.join(root, 'large.txt');
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(filePath, `${'a'.repeat(8192)}${'b'.repeat(1024 * 1024)}`, 'utf8');

  const originalReadFileSync = fs.readFileSync;
  fs.readFileSync = (...args) => {
    if (args[0] === filePath) {
      throw new Error('large file should not be fully read');
    }
    return originalReadFileSync(...args);
  };

  try {
    const fileService = new FileService(createStore([root]));
    const result = fileService.read(filePath);

    assert.equal(result.error, undefined);
    assert.equal(result.readOnly, true);
    assert.equal(result.truncated, true);
    assert.equal(result.content.length, 8192);
    assert.match(result.content, /^a+$/);
  } finally {
    fs.readFileSync = originalReadFileSync;
  }
});

test('read rejects symlinked files outside the allowed root', { skip: process.platform === 'win32' }, () => {
  const sandbox = makeSandbox();
  const root = path.join(sandbox, 'workspace');
  const outsideDir = path.join(sandbox, 'outside');
  const outsideFile = path.join(outsideDir, 'secret.txt');
  const linkPath = path.join(root, 'secret-link.txt');

  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(outsideDir, { recursive: true });
  fs.writeFileSync(outsideFile, 'classified', 'utf8');
  fs.symlinkSync(outsideFile, linkPath);

  const fileService = new FileService(createStore([root]));
  const result = fileService.read(linkPath);

  assert.equal(result.error, 'Path not allowed');
});
