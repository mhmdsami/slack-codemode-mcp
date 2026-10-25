import assert from 'node:assert/strict';
import test from 'node:test';
import { createChannelActions } from '../src/actions/channels.mjs';

const cache = () => ({
  channels: null,
  channelsAt: 0,
  channelsComplete: false,
  ttlMs: 1000,
});

test('a channel name that starts with C is resolved by name', async () => {
  const slack = {
    call: async () => ({
      channels: [{ id: 'C99999999', name: 'Codingteam', is_private: false, is_member: true }],
    }),
  };
  const channels = createChannelActions({ slack, cache: cache() });
  const found = await channels.find('Codingteam');
  assert.equal(found.channel.id, 'C99999999');
});

test('a real channel id skips the directory', async () => {
  const slack = { call: async () => assert.fail('Slack should not be called') };
  const channels = createChannelActions({ slack, cache: cache() });
  const found = await channels.find('C12345678');
  assert.equal(found.channel.id, 'C12345678');
});

test('not_found explains a capped directory scan', async () => {
  const slack = {
    call: async () => ({
      channels: [],
      response_metadata: { next_cursor: 'more' },
    }),
  };
  const channels = createChannelActions({ slack, cache: cache() });
  await assert.rejects(
    () => channels.find('oncall'),
    (error) => error.code === 'not_found' && /capped/.test(error.message),
  );
});

test('a complete scan does not claim a cap', async () => {
  const slack = { call: async () => ({ channels: [] }) };
  const channels = createChannelActions({ slack, cache: cache() });
  await assert.rejects(
    () => channels.find('oncall'),
    (error) => error.code === 'not_found' && !/capped/.test(error.message),
  );
});
