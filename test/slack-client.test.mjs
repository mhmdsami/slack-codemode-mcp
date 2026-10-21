import assert from 'node:assert/strict';
import test from 'node:test';
import { createSlackClient, executionSignal, SlackError } from '../src/slack/client.mjs';

test('surfaces rate limits after the retry budget', async () => {
  let calls = 0;
  const client = createSlackClient(() => 'xoxp-test', {
    sleep: async () => {},
    maxAttempts: 2,
    fetch: async () => {
      calls += 1;
      return new Response(JSON.stringify({ ok: false, error: 'ratelimited' }), {
        status: 429,
        headers: { 'retry-after': '0' },
      });
    },
  });

  await assert.rejects(
    () => client.call('auth.test'),
    (error) => error instanceof SlackError && error.code === 'ratelimited',
  );
  assert.equal(calls, 2);
});

test('falls back to form encoding on invalid_arguments', async () => {
  const seen = [];
  const client = createSlackClient(() => 'xoxp-test', {
    sleep: async () => {},
    fetch: async (_url, options) => {
      seen.push(options.headers['content-type']);
      if (seen.length === 1) {
        return new Response(JSON.stringify({ ok: false, error: 'invalid_arguments' }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ ok: true, args: {} }), { status: 200 });
    },
  });

  const result = await client.call('chat.postMessage', { channel: 'C1' });
  assert.deepEqual(result, { ok: true, args: {} });
  assert.equal(seen[0], 'application/json; charset=utf-8');
  assert.equal(seen[1], 'application/x-www-form-urlencoded');
});

test('refreshes on token_expired and retries', async () => {
  let calls = 0;
  const client = createSlackClient(
    () => ({ accessToken: 'old', refreshToken: 'r1', clientId: 'cid', expiresAt: null }),
    {
      sleep: async () => {},
      refresh: async () => ({
        accessToken: 'new',
        refreshToken: 'r1',
        clientId: 'cid',
        expiresAt: null,
      }),
      fetch: async () => {
        calls += 1;
        const payload =
          calls === 1 ? { ok: false, error: 'token_expired' } : { ok: true, args: {} };
        return new Response(JSON.stringify(payload), { status: 200 });
      },
    },
  );

  const result = await client.call('auth.test');
  assert.equal(calls, 2);
  assert.deepEqual(result, { ok: true, args: {} });
});

test('refreshes on invalid_auth and retries', async () => {
  let calls = 0;
  const client = createSlackClient(
    () => ({ accessToken: 'old', refreshToken: 'r1', clientId: 'cid', expiresAt: null }),
    {
      sleep: async () => {},
      refresh: async () => ({
        accessToken: 'new',
        refreshToken: 'r1',
        clientId: 'cid',
        expiresAt: null,
      }),
      fetch: async () => {
        calls += 1;
        const payload = calls === 1 ? { ok: false, error: 'invalid_auth' } : { ok: true, args: {} };
        return new Response(JSON.stringify(payload), { status: 200 });
      },
    },
  );

  const result = await client.call('auth.test');
  assert.equal(calls, 2);
  assert.deepEqual(result, { ok: true, args: {} });
});

test('requires a token', async () => {
  const client = createSlackClient(() => null);
  await assert.rejects(() => client.call('auth.test'), /not configured/);
});

test('does not retry ambiguous writes on network errors', async () => {
  let calls = 0;
  const client = createSlackClient(() => 'xoxp-test', {
    sleep: async () => {},
    fetch: async () => {
      calls += 1;
      const error = new Error('timed out');
      error.name = 'TimeoutError';
      throw error;
    },
  });

  await assert.rejects(
    () => client.call('chat.postMessage', { channel: 'C1', text: 'hello' }),
    (error) => error instanceof SlackError && error.code === 'ambiguous_result',
  );
  assert.equal(calls, 1);
});

test('retries idempotent reads on network errors', async () => {
  let calls = 0;
  const client = createSlackClient(() => 'xoxp-test', {
    sleep: async () => {},
    maxAttempts: 3,
    fetch: async () => {
      calls += 1;
      if (calls < 3) throw new Error('network');
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });

  const result = await client.call('auth.test');
  assert.equal(calls, 3);
  assert.deepEqual(result, { ok: true });
});

test('does not retry a write after a server error', async () => {
  let calls = 0;
  const client = createSlackClient(() => 'xoxp-test', {
    sleep: async () => {},
    fetch: async () => {
      calls += 1;
      return new Response('unavailable', { status: 503 });
    },
  });

  await assert.rejects(
    () => client.call('canvases.edit', { canvas_id: 'F1', changes: [] }),
    (error) => error instanceof SlackError && error.code === 'ambiguous_result',
  );
  assert.equal(calls, 1);
});

test('stops retrying when the execution is cancelled', async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const client = createSlackClient(() => 'xoxp-test', {
    sleep: async () => {},
    fetch: async () => {
      calls += 1;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });

  await assert.rejects(
    () => executionSignal.run(controller.signal, () => client.call('auth.test')),
    (error) => error instanceof SlackError && error.code === 'cancelled',
  );
  assert.equal(calls, 0);
});

test('returns a client_msg_id for an ambiguous message write', async () => {
  let body;
  let clientMsgId;
  const client = createSlackClient(() => 'xoxp-test', {
    sleep: async () => {},
    fetch: async (_url, options) => {
      body = options.body;
      throw new Error('network');
    },
  });

  await assert.rejects(
    () => client.call('chat.postMessage', { channel: 'C1', text: 'hello' }),
    (error) => {
      clientMsgId = error.clientMsgId;
      assert.equal(error.code, 'ambiguous_result');
      assert.ok(clientMsgId);
      assert.match(error.message, new RegExp(clientMsgId));
      return true;
    },
  );
  assert.equal(JSON.parse(body).client_msg_id, clientMsgId);
});
