import assert from 'node:assert/strict';
import test from 'node:test';
import { createMessageActions } from '../src/actions/messages.mjs';

const cache = () => ({ dms: new Map(), names: new Map(), ttlMs: 1000, maxEntries: 100 });

test('post forwards a caller-supplied client_msg_id', async () => {
  const calls = [];
  const actions = createMessageActions({
    slack: {
      call: async (method, args) => {
        calls.push({ method, args });
        return { channel: 'C123ABC', ts: '1.000000' };
      },
    },
    cache: cache(),
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
    cache: cache(),
    users: { resolve: async () => ({ id: 'U123ABC' }) },
    channels: {},
  });

  await actions.dm({ user: 'U123ABC', text: 'hello', client_msg_id: 'retry-2' });
  const post = calls.find((entry) => entry.method === 'chat.postMessage');
  assert.equal(post.args.client_msg_id, 'retry-2');
});

test('thread reports candidate channels instead of claiming one is missing', async () => {
  const actions = createMessageActions({
    slack: { call: async () => assert.fail('Slack should not be called') },
    cache: cache(),
    users: {},
    channels: {
      find: async () => ({
        channel: null,
        matches: [{ id: 'C11111111' }, { id: 'C22222222' }],
        total: 2,
        complete: true,
      }),
    },
  });

  await assert.rejects(
    () => actions.thread({ channel: '#oncall', ts: '1699999999.000000' }),
    (error) => error.code === 'ambiguous' && error.matches.length === 2,
  );
});

test('thread clamps the page limit and surfaces pagination', async () => {
  const calls = [];
  const actions = createMessageActions({
    slack: {
      call: async (method, args) => {
        calls.push(args);
        return {
          messages: [{ ts: '1.000000', user: 'U1', text: 'hi' }],
          has_more: true,
          response_metadata: { next_cursor: 'cursor-1' },
        };
      },
    },
    cache: cache(),
    users: { namesFor: async () => new Map([['U1', 'Jane']]) },
    channels: {},
  });

  const result = await actions.thread({
    channel: 'C12345678',
    ts: '1699999999.000000',
    limit: -5,
  });
  assert.equal(calls[0].limit, 1);
  assert.equal(result.has_more, true);
  assert.equal(result.next_cursor, 'cursor-1');
});

test('post requires non-empty text and a valid thread timestamp', async () => {
  const actions = createMessageActions({
    slack: { call: async () => assert.fail('Slack should not be called') },
    cache: cache(),
    users: {},
    channels: {},
  });

  await assert.rejects(
    () => actions.post({ to: 'C12345678', text: '   ' }),
    /Provide `text`, `blocks`, or `attachments`/,
  );
  await assert.rejects(
    () => actions.post({ to: 'C12345678', text: 'hi', thread_ts: 'yesterday' }),
    /not a Slack timestamp/,
  );
});

test('a name that merely starts with C is resolved as a channel name', async () => {
  const actions = createMessageActions({
    slack: { call: async () => assert.fail('Slack should not be called') },
    cache: cache(),
    users: {},
    channels: {
      find: async (raw) => ({ channel: { id: 'C99999999', name: raw }, complete: true }),
    },
  });

  const target = await actions.resolveTarget('Codingteam');
  assert.equal(target.id, 'C99999999');
  assert.equal(target.name, 'Codingteam');
});

test('a user id that looks like a name still resolves as a dm target', async () => {
  const actions = createMessageActions({
    slack: { call: async () => assert.fail('Slack should not be called') },
    cache: cache(),
    users: {},
    channels: {},
  });

  const target = await actions.resolveTarget('@U12345678');
  assert.deepEqual(target, { dm: true, users: ['U12345678'] });
});

test('post accepts blocks without text', async () => {
  const calls = [];
  const actions = createMessageActions({
    slack: {
      call: async (method, args) => {
        calls.push({ method, args });
        return { channel: 'C12345678', ts: '1.000000' };
      },
    },
    cache: cache(),
    users: {},
    channels: {},
  });

  await actions.post({ to: 'C12345678', blocks: [{ type: 'section' }] });
  assert.equal(calls[0].args.text, undefined);
  assert.deepEqual(calls[0].args.blocks, [{ type: 'section' }]);
});

test('post forwards formatting and thread options', async () => {
  const calls = [];
  const actions = createMessageActions({
    slack: {
      call: async (method, args) => {
        calls.push({ method, args });
        return { channel: 'C12345678', ts: '1.000000' };
      },
    },
    cache: cache(),
    users: {},
    channels: {},
  });

  await actions.post({
    to: 'C12345678',
    text: 'hi',
    thread_ts: '1699999999.000000',
    mrkdwn: false,
    unfurl_links: true,
    reply_broadcast: true,
  });
  assert.equal(calls[0].args.mrkdwn, false);
  assert.equal(calls[0].args.unfurl_links, true);
  assert.equal(calls[0].args.reply_broadcast, true);
  assert.equal(calls[0].args.thread_ts, '1699999999.000000');
});

test('edit updates a message through chat.update', async () => {
  const calls = [];
  const actions = createMessageActions({
    slack: {
      call: async (method, args) => {
        calls.push({ method, args });
        return { ok: true, channel: args.channel, ts: args.ts, text: args.text };
      },
    },
    cache: cache(),
    users: {},
    channels: {},
  });

  const result = await actions.edit({
    channel: 'C12345678',
    ts: '1699999999.000000',
    text: 'fixed',
  });
  assert.equal(calls[0].method, 'chat.update');
  assert.equal(calls[0].args.ts, '1699999999.000000');
  assert.equal(result.text, 'fixed');
});

test('edit requires text or blocks', async () => {
  const actions = createMessageActions({
    slack: { call: async () => assert.fail('Slack should not be called') },
    cache: cache(),
    users: {},
    channels: {},
  });

  await assert.rejects(
    () => actions.edit({ channel: 'C12345678', ts: '1699999999.000000' }),
    /Provide `text` or `blocks`/,
  );
});

test('search compacts matches and validates sort', async () => {
  const calls = [];
  const actions = createMessageActions({
    slack: {
      call: async (method, args) => {
        calls.push({ method, args });
        return {
          messages: {
            total: 1,
            paging: { page: 1, pages: 1 },
            matches: [
              {
                channel: { id: 'C1', name: 'general' },
                username: 'jane',
                user: 'U1',
                ts: '1.000001',
                text: 'hello',
                permalink: 'https://example/1',
              },
            ],
          },
        };
      },
    },
    cache: cache(),
    users: {},
    channels: {},
  });

  const result = await actions.search({ query: 'hello', count: 5 });
  assert.equal(calls[0].method, 'search.messages');
  assert.equal(calls[0].args.count, 5);
  assert.equal(result.count, 1);
  assert.equal(result.matches[0].channel, 'general');
  assert.equal(result.matches[0].user, 'jane');

  await assert.rejects(() => actions.search({ query: 'x', sort: 'recent' }), /sort/);
});
