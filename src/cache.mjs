export function createCache(ttlMs, maxEntries = 500) {
  return {
    users: null,
    usersAt: 0,
    usersComplete: false,
    channels: null,
    channelsAt: 0,
    channelsComplete: false,
    dms: new Map(),
    names: new Map(),
    ttlMs,
    maxEntries,
  };
}

export function isFresh(timestamp, ttlMs) {
  return timestamp > 0 && Date.now() - timestamp < ttlMs;
}

export function getCached(map, key, ttlMs) {
  const entry = map.get(key);
  if (!entry) return undefined;
  if (!isFresh(entry.at, ttlMs)) {
    map.delete(key);
    return undefined;
  }
  return entry.value;
}

export function setCached(map, key, value, maxEntries = 500) {
  map.delete(key);
  map.set(key, { value, at: Date.now() });
  while (map.size > maxEntries) map.delete(map.keys().next().value);
}
