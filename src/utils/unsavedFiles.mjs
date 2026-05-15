export function normalizeUnsavedFiles(files) {
  if (!Array.isArray(files)) return [];

  const seen = new Set();
  const result = [];
  for (const file of files) {
    if (typeof file !== 'string') continue;
    const trimmed = file.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

export function fileBasename(filePath) {
  if (typeof filePath !== 'string') return '';
  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1] || filePath;
}

export function buildUnsavedFilesMessage(files) {
  const normalized = normalizeUnsavedFiles(files);
  if (normalized.length === 0) return '';
  if (normalized.length === 1) {
    return `Discard unsaved changes to ${fileBasename(normalized[0])}?`;
  }
  const preview = normalized.slice(0, 3).map(fileBasename).join(', ');
  const suffix = normalized.length > 3 ? ', ...' : '';
  return `Discard unsaved changes to ${normalized.length} files? ${preview}${suffix}`;
}
