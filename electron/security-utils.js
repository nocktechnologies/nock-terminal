const fs = require('fs');
const os = require('os');
const path = require('path');

function canonicalizePath(targetPath) {
  if (typeof targetPath !== 'string' || targetPath.trim() === '') {
    throw new Error('Path must be a non-empty string');
  }

  const resolved = path.resolve(targetPath);
  const realpath = fs.realpathSync.native || fs.realpathSync;

  try {
    return realpath(resolved);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;

    const parent = path.dirname(resolved);
    if (parent === resolved) return resolved;

    return path.join(canonicalizePath(parent), path.basename(resolved));
  }
}

function isPathWithinRoots(targetPath, roots) {
  if (!Array.isArray(roots) || roots.length === 0) return false;

  let normalizedTarget;
  try {
    normalizedTarget = canonicalizePath(targetPath);
  } catch {
    return false;
  }

  return roots.some((root) => {
    try {
      const normalizedRoot = canonicalizePath(root);
      const relative = path.relative(normalizedRoot, normalizedTarget);
      return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
    } catch {
      return false;
    }
  });
}

function sanitizeStringList(value, { maxItems = 100, maxLength = 200 } = {}) {
  if (!Array.isArray(value)) return [];

  const seen = new Set();
  const result = [];

  for (const entry of value) {
    if (result.length >= maxItems) break;
    if (typeof entry !== 'string') continue;

    const trimmed = entry.trim();
    if (!trimmed || trimmed.length > maxLength) continue;

    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }

  return result;
}

function sanitizeDevRoots(value) {
  if (!Array.isArray(value)) return [];

  const roots = [];
  const seen = new Set();
  const realpath = fs.realpathSync.native || fs.realpathSync;
  const homeDir = realpath(os.homedir());

  for (const entry of value) {
    if (roots.length >= 20) break;
    if (typeof entry !== 'string') continue;

    const trimmed = entry.trim();
    if (!trimmed) continue;

    let normalized;
    try {
      normalized = canonicalizePath(trimmed);
      const stat = fs.statSync(normalized);
      if (!stat.isDirectory()) continue;
    } catch {
      continue;
    }

    const rootPath = path.parse(normalized).root;
    if (normalized === rootPath) continue;
    if (normalized === homeDir) continue;

    if (seen.has(normalized)) continue;
    seen.add(normalized);
    roots.push(normalized);
  }

  return roots;
}

module.exports = {
  canonicalizePath,
  isPathWithinRoots,
  sanitizeDevRoots,
  sanitizeStringList,
};
