/**
 * Sets `key` as the newest entry of `map`, then evicts the oldest entries while the map holds
 * more than `max`. Entries that `keep` protects (and `key` itself) are never evicted; if too
 * many are protected the map stays over the cap rather than lose them. For per-tab memories
 * that would otherwise grow for as long as the tab stays open.
 */
export function setBounded<K, V>(
  map: Map<K, V>,
  key: K,
  value: V,
  max: number,
  keep: (key: K, value: V) => boolean = () => false,
): void {
  map.delete(key);
  map.set(key, value);
  if (map.size <= max) return;
  // Insertion order is oldest first; deleting while iterating a Map is safe.
  for (const [k, v] of map) {
    if (map.size <= max) break;
    if (k !== key && !keep(k, v)) map.delete(k);
  }
}
