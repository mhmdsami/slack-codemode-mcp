import assert from 'node:assert/strict';
import test from 'node:test';
import { createMessageActions } from '../src/actions/messages.mjs';

test('post forwards a caller-supplied client_msg_id', async () => {
  const calls = [];
  const actions = createMessageActions({
    slack: {
      call: async (method, args) => {
        calls.push({ method, args });
        return { channel: 'C123ABC', ts: '1.000000' };
      },
    },
    cache: { dms: new Map() },
    users: {},
    channels: {},
  });

  await actions.post({ to: 'C123ABC', text: 'hello', client_msg_id: 'retry-1' });
  assert.equal(calls[0].method, 'chat.postMessage');
  assert.equal(calls[0].args.client_msg_id, 'retry-1');
});

test('dm forwards a caller-supplied client_msg_id', async () => {
  const calls = [];
  const actions = createMessageActions({
    slack: {
      call: async (method, args) => {
        calls.push({ method, args });
        if (method === 'conversations.open') return { channel: { id: 'D123ABC' } };
        return { channel: 'D123ABC', ts: '1.000000' };
      },
    },
    cache: { dms: new Map() },
    users: { resolve: async () => ({ id: 'U123ABC' }) },
    channels: {},
  });

  await actions.dm({ user: 'U123ABC', text: 'hello', client_msg_id: 'retry-2' });
  const post = calls.find((entry) => entry.method === 'chat.postMessage');
  assert.equal(post.args.client_msg_id, 'retry-2');
});
