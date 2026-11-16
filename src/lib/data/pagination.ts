/** Check a bounded exact-count page; never render a provider-truncated result as complete. */
export function isCompletePage<T extends { id: string }>(data: T[] | null | undefined, count: number | null | undefined, page: number, pageSize: number): data is T[] {
  if (!Array.isArray(data) || !Number.isSafeInteger(count) || count == null || count < 0 || !Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1) return false;
  const offset = (page - 1) * pageSize;
  if (!Number.isSafeInteger(offset)) return false;
  const expected = Math.min(pageSize, Math.max(0, count - offset));
  if (data.length !== expected) return false;
  const ids = new Set<string>();
  for (const row of data) {
    if (!row || typeof row.id !== "string" || !row.id || ids.has(row.id)) return false;
    ids.add(row.id);
  }
  return true;
}
