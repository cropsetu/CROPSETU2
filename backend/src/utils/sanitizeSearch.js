/**
 * Sanitize a user-supplied search / filter term before it is dropped into a
 * Prisma `contains` (ILIKE) filter.
 *
 * Why: Prisma does NOT escape SQL LIKE wildcards inside `contains`/`startsWith`/
 * `endsWith` values. A crafted term such as "%_%_%_%_%_" becomes a pathological
 * `ILIKE '%…%'` pattern that can't use an index and forces a full-table scan —
 * a cheap way to degrade the whole API (the "catastrophic filter behavior" /
 * ReDoS-style DoS this guards against). Unbounded length makes it worse.
 *
 * What it does:
 *   - coerces to string and trims
 *   - strips the LIKE metacharacters % and _ and the escape char \ (a marketplace
 *     search box never needs to match these literally)
 *   - collapses internal whitespace runs
 *   - caps the length so the pattern stays cheap
 *
 * Returns null when nothing usable remains, so callers can skip the filter
 * entirely (e.g. `if (search) where.OR = …`).
 *
 * @param {*} raw
 * @param {number} [maxLen=100]
 * @returns {string|null}
 */
export function sanitizeSearch(raw, maxLen = 100) {
  if (raw == null) return null;
  const cleaned = String(raw)
    .replace(/[%_\\]/g, ' ')   // neutralize LIKE wildcards + escape char
    .replace(/\s+/g, ' ')      // collapse whitespace runs
    .trim()
    .slice(0, maxLen);
  return cleaned || null;
}
