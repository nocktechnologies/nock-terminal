export function formatTreeMetaNotice(meta, scope = 'tree') {
  if (!meta) return null;
  if (meta.error) return meta.error;

  if (!meta.truncated || meta.truncatedByDepth) return null;

  if (meta.truncatedByEntries) {
    const label = scope === 'folder' ? 'Partial folder shown' : 'Partial tree shown';
    return `${label} (${meta.entryCount}/${meta.maxEntries} entries)`;
  }

  return scope === 'folder' ? 'Partial folder shown' : 'Partial tree shown';
}
