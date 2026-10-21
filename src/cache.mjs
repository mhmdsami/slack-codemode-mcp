export function createCache(ttlMs) {
  return {
    users: null,
    usersAt: 0,
    channels: null,
    channelsAt: 0,
    dms: new Map(),
    names: new Map(),
    ttlMs,
  };
}

export function isFresh(timestamp, ttlMs) {
  return timestamp > 0 && Date.now() - timestamp < ttlMs;
}
