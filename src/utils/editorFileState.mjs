export function normalizeFilePathForCompare(filePath) {
  return String(filePath || '').replace(/\\/g, '/');
}

function utf8ByteLength(value) {
  if (typeof TextEncoder === 'function') {
    return new TextEncoder().encode(value).length;
  }
  return String(value || '').length;
}

export function shouldRefreshOpenFile(filePath, event, entry = {}) {
  if (!filePath || !event || event.type !== 'change') return false;
  if (entry?.modified) return false;
  return normalizeFilePathForCompare(event.path) === normalizeFilePathForCompare(filePath);
}

export function updateSavedFileContent(fileContents, filePath, content) {
  return {
    ...(fileContents || {}),
    [filePath]: {
      ...((fileContents || {})[filePath] || {}),
      content,
      size: utf8ByteLength(content),
      readOnly: false,
      truncated: false,
    },
  };
}
