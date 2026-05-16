export function normalizeSessionSearchQuery(query) {
  return String(query || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

export function matchesSessionSearch(session, query) {
  const terms = Array.isArray(query)
    ? query.map(term => String(term || '').toLowerCase()).filter(Boolean)
    : normalizeSessionSearchQuery(query);
  if (terms.length === 0) return true;

  const fields = [
    session?.name,
    session?.path,
    session?.branch,
    session?.status,
    session?.kind,
    session?.lastActivityFormatted,
    session?.agent?.name,
    session?.agent?.lifecycle,
    session?.agent?.model,
    session?.launch?.command,
    session?.launch?.cwd,
  ];

  const haystack = fields
    .filter(value => value != null)
    .map(value => String(value).toLowerCase())
    .join(' ');

  return terms.every(term => haystack.includes(term));
}

export function filterSessionsBySearch(sessions, query) {
  if (!Array.isArray(sessions)) return [];
  const terms = normalizeSessionSearchQuery(query);
  if (terms.length === 0) return sessions;
  return sessions.filter(session => matchesSessionSearch(session, terms));
}
