import assert from 'node:assert/strict';
import test from 'node:test';
import { createCache, isFresh } from '../src/cache.mjs';

test('isFresh respects the ttl', () => {
  assert.equal(isFresh(0, 1000), false);
  assert.equal(isFresh(Date.now(), 1000), true);
});

test('a cache starts empty', () => {
  const cache = createCache(1000);
  assert.equal(cache.users, null);
  assert.equal(cache.dms.size, 0);
  assert.equal(cache.ttlMs, 1000);
});
