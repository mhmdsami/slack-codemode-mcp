import assert from 'node:assert/strict';
import test from 'node:test';
import { credentialsNeedRefresh, refreshCredentials } from '../src/credentials.mjs';

test('refreshes and stores the new token bundle', async () => {
  const stored = [];
  const next = await refreshCredentials(
    { accessToken: 'old', refreshToken: 'r1', clientId: 'cid', expiresAt: 0 },
    {
      lock: async () => 'owner',
      unlock: () => {},
      reload: () => null,
      store: (value) => stored.push(value),
      fetch: async () => ({
        ok: true,
        json: async () => ({
          ok: true,
          access_token: 'new',
          refresh_token: 'r2',
          expires_in: 3600,
        }),
      }),
    },
  );

  assert.equal(next.accessToken, 'new');
  assert.equal(next.refreshToken, 'r2');
  assert.equal(next.clientId, 'cid');
  assert.equal(stored.length, 1);
  assert.equal(stored[0].accessToken, 'new');
});

test('requires a refresh token', async () => {
  await assert.rejects(() => refreshCredentials({ accessToken: 'old' }), /No refresh token/);
});

test('uses fresh stored credentials when the lock is held', async () => {
  const future = Date.now() + 3_600_000;
  const result = await refreshCredentials(
    { accessToken: 'old', refreshToken: 'r', clientId: 'c', expiresAt: 0 },
    {
      lock: async () => null,
      unlock: () => {},
      reload: () => ({ accessToken: 'fresh', refreshToken: 'r', clientId: 'c', expiresAt: future }),
      store: () => {
        throw new Error('should not store');
      },
      fetch: async () => {
        throw new Error('should not fetch');
      },
    },
  );
  assert.equal(result.accessToken, 'fresh');
});

test('accepts a rotated token even when expiry is unknown', async () => {
  const result = await refreshCredentials(
    { accessToken: 'old', refreshToken: 'r', clientId: 'c', expiresAt: null },
    {
      lock: async () => null,
      unlock: () => {},
      reload: () => ({
        accessToken: 'rotated',
        refreshToken: 'r2',
        clientId: 'c',
        expiresAt: null,
      }),
      fetch: async () => {
        throw new Error('should not fetch');
      },
    },
  );
  assert.equal(result.accessToken, 'rotated');
});

test('refreshes with the stored refresh token, not the caller copy', async () => {
  let body;
  const result = await refreshCredentials(
    { accessToken: 'old', refreshToken: 'stale', clientId: 'cid', expiresAt: 0 },
    {
      lock: async () => 'owner',
      unlock: () => {},
      reload: () => ({
        accessToken: 'old',
        refreshToken: 'stored',
        clientId: 'cid',
        expiresAt: 0,
      }),
      store: () => {},
      fetch: async (_url, options) => {
        body = options.body;
        return {
          ok: true,
          json: async () => ({ ok: true, access_token: 'new', expires_in: 3600 }),
        };
      },
    },
  );

  assert.equal(new URLSearchParams(body).get('refresh_token'), 'stored');
  assert.equal(result.refreshToken, 'stored');
});

test('refreshes when a different stored token is expired', async () => {
  let fetched = false;
  const result = await refreshCredentials(
    { accessToken: 'old', refreshToken: 'r', clientId: 'c', expiresAt: 0 },
    {
      lock: async () => 'owner',
      unlock: () => {},
      reload: () => ({
        accessToken: 'different-but-expired',
        refreshToken: 'r2',
        clientId: 'c',
        expiresAt: Date.now() - 1000,
      }),
      store: () => {},
      fetch: async () => {
        fetched = true;
        return {
          ok: true,
          json: async () => ({ ok: true, access_token: 'fresh', expires_in: 3600 }),
        };
      },
    },
  );

  assert.equal(fetched, true);
  assert.equal(result.accessToken, 'fresh');
});

test('refreshes a different token with expiresAt zero', async () => {
  let fetched = false;
  const result = await refreshCredentials(
    { accessToken: 'old', refreshToken: 'r', clientId: 'c', expiresAt: null },
    {
      lock: async () => 'owner',
      unlock: () => {},
      reload: () => ({
        accessToken: 'zero-expiry',
        refreshToken: 'r2',
        clientId: 'c',
        expiresAt: 0,
      }),
      store: () => {},
      fetch: async () => {
        fetched = true;
        return {
          ok: true,
          json: async () => ({ ok: true, access_token: 'fresh', expires_in: 3600 }),
        };
      },
    },
  );

  assert.equal(fetched, true);
  assert.equal(result.accessToken, 'fresh');
});

test('rejects when the lock is held and the token is stale', async () => {
  await assert.rejects(
    () =>
      refreshCredentials(
        { accessToken: 'old', refreshToken: 'r', clientId: 'c', expiresAt: 0 },
        { lock: async () => null, unlock: () => {}, reload: () => null },
      ),
    /already in progress/,
  );
});

test('detects tokens close to expiry', () => {
  assert.equal(credentialsNeedRefresh({ refreshToken: 'r', expiresAt: Date.now() + 1000 }), true);
  assert.equal(credentialsNeedRefresh({ refreshToken: null, expiresAt: 0 }), false);
});
