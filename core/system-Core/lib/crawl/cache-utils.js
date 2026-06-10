export const DEFAULT_CACHE_MAX_ENTRIES = 100;

export function normalizeCacheKey(value) {
  return String(value || '').trim().toLowerCase();
}

export function readTTLCache(cache, key) {
  const entry = cache.get(key);
  if (!entry || Date.now() > entry.expiresAt) {
    if (entry) cache.delete(key);
    return null;
  }
  return { value: entry.value, cached: true };
}

export function writeTTLCache(cache, key, value, ttlMs, maxEntries = DEFAULT_CACHE_MAX_ENTRIES) {
  if (ttlMs <= 0) return;
  if (cache.size >= maxEntries) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, { value, expiresAt: Date.now() + ttlMs, insertedAt: Date.now() });
}
