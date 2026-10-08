// A public byline is deliberately separate from private ownership/permission fields.
// Keep this allowlist shared by the catalog, cards and static publishing pipeline.
export function normalizePublicAuthor(value) {
  if (!value || typeof value.displayName !== 'string') return null;
  const name = value.displayName.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\s+/g, ' ').trim();
  if (!name || /[^\s@]+@[^\s@]+\.[^\s@]+/.test(name)) return null;
  const displayName = Array.from(name).slice(0, 80).join('');
  let avatarUrl = '';
  const candidate = typeof value.avatarUrl === 'string' ? value.avatarUrl.trim() : '';
  if (candidate && !/[\\\u0000-\u001f\u007f]/.test(candidate)) {
    if (candidate.startsWith('/') && !candidate.startsWith('//')) avatarUrl = candidate;
    else {
      try {
        const url = new URL(candidate);
        if (url.protocol === 'https:' && !url.username && !url.password) avatarUrl = url.href;
      } catch { /* Invalid or unsafe URLs use the initials fallback. */ }
    }
  }
  return { displayName, avatarUrl };
}

export function publicAuthorInitials(name) {
  const parts = String(name).trim().split(/\s+/);
  const initial = part => Array.from(part).find(char => /[\p{L}\p{N}]/u.test(char)) || '';
  return (initial(parts[0]) + (parts.length > 1 ? initial(parts.at(-1)) : '')).toLocaleUpperCase();
}
