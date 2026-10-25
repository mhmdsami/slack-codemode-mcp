import assert from 'node:assert/strict';
import test from 'node:test';
import { createCache, getCached, isFresh, setCached } from '../src/cache.mjs';

test('isFresh respects the ttl', () => {
  assert.equal(isFresh(0, 1000), false);
  assert.equal(isFresh(Date.now(), 1000), true);
});

test('a cache starts empty', () => {
  const cache = createCache(1000);
  assert.equal(cache.users, null);
  assert.equal(cache.dms.size, 0);
  assert.equal(cache.ttlMs, 1000);
  assert.equal(cache.maxEntries, 500);
});

test('entries expire after the ttl', () => {
  const map = new Map();
  setCached(map, 'C1', 'D1', 10);
  assert.equal(getCached(map, 'C1', 1000), 'D1');

  map.set('C2', { value: 'D2', at: Date.now() - 5000 });
  assert.equal(getCached(map, 'C2', 1000), undefined);
  assert.equal(map.has('C2'), false);
});

test('entries are evicted past the size cap', () => {
  const map = new Map();
  setCached(map, 'a', 1, 2);
  setCached(map, 'b', 2, 2);
  setCached(map, 'c', 3, 2);
  assert.equal(map.size, 2);
  assert.equal(map.has('a'), false);
  assert.equal(map.get('c').value, 3);
});

test('reading the same key refreshes its position', () => {
  const map = new Map();
  setCached(map, 'a', 1, 2);
  setCached(map, 'b', 2, 2);
  setCached(map, 'a', 1, 2);
  setCached(map, 'c', 3, 2);
  assert.equal(map.has('a'), true);
  assert.equal(map.has('b'), false);
});
