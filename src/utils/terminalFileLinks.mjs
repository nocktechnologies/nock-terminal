const MARKDOWN_FILE_RE = /\.(md|markdown|mdx)$/i;

function stripWrapping(text) {
  return text
    .trim()
    .replace(/^["'`(<[]+/, '')
    .replace(/[)"'`>\],.;:]+$/, '');
}

function stripLineSuffix(text) {
  return text.replace(/:(\d+)(?::\d+)?$/, '');
}

function isAbsolutePath(text) {
  return text.startsWith('/') || /^[A-Za-z]:[\\/]/.test(text);
}

function normalizeRelativePath(cwd, candidate) {
  const separator = cwd.includes('\\') && !cwd.includes('/') ? '\\' : '/';
  const base = cwd.replace(/[\\/]+$/, '');
  const relative = candidate.replace(/^[.][\\/]/, '').replace(/[\\/]+/g, separator);
  const parts = `${base}${separator}${relative}`.split(/[\\/]+/);
  const root = parts[0] === '' ? [''] : [];
  const stack = root.length ? root : [parts.shift()];

  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (stack.length > root.length) stack.pop();
      continue;
    }
    stack.push(part);
  }

  return stack.join(separator).replace(/^$/, separator);
}

function decodeFileUrl(text) {
  if (!/^file:\/\//i.test(text)) return null;
  try {
    const url = new URL(text);
    return decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
}

export function resolveTerminalFileCandidate(value, cwd) {
  if (typeof value !== 'string') return null;
  if (/^https?:\/\//i.test(value.trim())) return null;

  const fileUrlPath = decodeFileUrl(stripWrapping(value));
  const rawCandidate = fileUrlPath || stripLineSuffix(stripWrapping(value));
  if (!rawCandidate || !MARKDOWN_FILE_RE.test(rawCandidate)) return null;

  const filePath = isAbsolutePath(rawCandidate)
    ? rawCandidate
    : (typeof cwd === 'string' && cwd.trim() ? normalizeRelativePath(cwd, rawCandidate) : null);

  return filePath ? { filePath } : null;
}
