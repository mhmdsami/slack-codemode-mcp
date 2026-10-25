import assert from 'node:assert/strict';
import test from 'node:test';
import { createUserActions, normalizeName, scoreUser } from '../src/actions/users.mjs';

test('normalizes punctuation and accents in names', () => {
  assert.equal(normalizeName('Jane  Doe'), 'jane doe');
  assert.equal(normalizeName('jane.doe@example.com'), 'jane doe example com');
});

test('scores exact matches highest', () => {
  const user = {
    name: 'jane.doe',
    real_name: 'Jane Doe',
    email: 'jane.doe@example.com',
  };
  assert.equal(scoreUser(user, 'jane doe'), 100);
  assert.equal(scoreUser(user, 'jane'), 70);
  assert.equal(scoreUser(user, 'doe'), 60);
});

test('returns zero for unrelated names', () => {
  const user = { name: 'someone', real_name: 'Someone Else' };
  assert.equal(scoreUser(user, 'jane'), 0);
  assert.equal(scoreUser(user, ''), 0);
});

test('does not return an unrelated RTS user', async () => {
  const slack = {
    call: async (method) => {
      if (method === 'assistant.search.context') {
        return { results: { users: [{ user_id: 'U9', full_name: 'Someone Else' }] } };
      }
      if (method === 'users.list') return { members: [] };
      throw new Error(`unexpected ${method}`);
    },
  };
  const cache = {
    users: null,
    usersAt: 0,
    channels: null,
    channelsAt: 0,
    dms: new Map(),
    names: new Map(),
    ttlMs: 1000,
    maxEntries: 100,
  };

  const users = createUserActions({ slack, cache });
  await assert.rejects(() => users.find('jane doe'), /No user matched/);
});

test('maps a missing email lookup to a not_found action error', async () => {
  const slack = {
    call: async () => {
      const error = new Error('nope');
      error.code = 'users_not_found';
      throw error;
    },
  };
  const users = createUserActions({
    slack,
    cache: {
      users: null,
      usersAt: 0,
      dms: new Map(),
      names: new Map(),
      ttlMs: 1000,
      maxEntries: 100,
    },
  });

  await assert.rejects(
    () => users.find('nobody@example.com'),
    (error) => error.code === 'not_found' && /nobody@example\.com/.test(error.message),
  );
});
