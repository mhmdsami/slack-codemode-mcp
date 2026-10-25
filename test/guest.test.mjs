import assert from 'node:assert/strict';
import test from 'node:test';
import guest from '../celld/guest.js';

async function run(code, hostFetch = async () => new Response('{}')) {
  const request = new Request('http://guest/execute', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  const response = await guest.fetch(request, { SLACK: { fetch: hostFetch } });
  return response.json();
}

test('returns a JSON value and console output', async () => {
  const result = await run("console.log('hi'); return { ok: true, n: 2 };");
  assert.equal(result.ok, true);
  assert.equal(result.value, '{"ok":true,"n":2}');
  assert.deepEqual(result.logs, ['hi']);
});

test('serializes undefined object fields as null instead of losing the value', async () => {
  const result = await run('return { a: undefined, b: [undefined] };');
  assert.equal(result.value, '{"a":null,"b":[null]}');
});

test('formats dates, maps, sets, and errors', async () => {
  const result = await run(`
    return {
      date: new Date('2026-01-02T03:04:05.000Z'),
      map: new Map([['a', 1]]),
      set: new Set(['x']),
      error: new TypeError('bad'),
      fn: function named() {},
    };
  `);
  assert.match(result.value, /2026-01-02T03:04:05\.000Z/);
  assert.match(result.value, /\[\["a",1\]\]/);
  assert.match(result.value, /\["x"\]/);
  assert.match(result.value, /TypeError: bad/);
  assert.match(result.value, /"fn":null/);
});

test('formats a top-level function', async () => {
  const result = await run('return function named() {};');
  assert.equal(result.value, '[Function]');
});

test('explains an object it cannot serialize', async () => {
  const result = await run(
    'class Box { constructor() { this.v = 1; } } return { box: new Box() };',
  );
  assert.match(result.value, /unserializable/);
});

test('returns undefined as a readable value', async () => {
  const result = await run('return undefined;');
  assert.equal(result.value, 'undefined');
});

test('reports syntax errors as invalid code', async () => {
  const result = await run('return {');
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'invalid_code');
  assert.equal(result.error.name, 'SyntaxError');
});

test('propagates bridge error codes to the guest', async () => {
  const host = async () =>
    new Response(
      JSON.stringify({
        ok: false,
        error: { code: 'missing_scope', message: 'nope', needed: 'chat:write' },
      }),
    );
  const result = await run(
    `try {
      await slack.chat.postMessage({ channel: 'C1', text: 'hi' });
    } catch (error) {
      return { code: error.code, needed: error.needed };
    }`,
    host,
  );
  assert.equal(result.value, '{"code":"missing_scope","needed":"chat:write"}');
});

test('propagates matches and retry hints to the guest', async () => {
  const host = async () =>
    new Response(
      JSON.stringify({
        ok: false,
        error: {
          code: 'ambiguous',
          message: 'two users',
          matches: [{ id: 'U1' }],
          retry_after: 3,
        },
      }),
    );
  const result = await run(
    `try {
      await app.findUser('jane');
    } catch (error) {
      return { matches: error.matches, retry_after: error.retry_after };
    }`,
    host,
  );
  assert.equal(result.value, '{"matches":[{"id":"U1"}],"retry_after":3}');
});

test('rejects a self-referential map without recursing', async () => {
  const result = await run('const m = new Map(); m.set("self", m); return m;');
  assert.match(result.value, /unserializable/);
});

test('routes app helpers through the bridge', async () => {
  const calls = [];
  const host = async (_url, init) => {
    calls.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ ok: true, value: { user_id: 'U1' } }));
  };
  const result = await run('return await app.whoami();', host);
  assert.deepEqual(calls[0], { action: 'whoami', input: {} });
  assert.equal(result.value, '{"user_id":"U1"}');
});

test('exposes a canvas comments helper', async () => {
  const result = await run('return typeof app.canvas.comments;');
  assert.equal(result.value, 'function');
});

test('exposes message edit, search, and canvas share helpers', async () => {
  const result = await run(`
    return {
      edit: typeof app.edit,
      search: typeof app.search,
      share: typeof app.canvas.share,
    };
  `);
  assert.match(result.value, /"edit":"function"/);
  assert.match(result.value, /"search":"function"/);
  assert.match(result.value, /"share":"function"/);
});

test('routes message edit through the bridge', async () => {
  const calls = [];
  const host = async (_url, init) => {
    calls.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ ok: true, value: { ok: true } }));
  };

  await run("return await app.edit('C12345678', '1699999999.000000', 'fixed');", host);
  assert.deepEqual(calls[0], {
    action: 'edit',
    input: { channel: 'C12345678', ts: '1699999999.000000', text: 'fixed' },
  });
});

test('routes canvas share through the bridge', async () => {
  const calls = [];
  const host = async (_url, init) => {
    calls.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ ok: true, value: { ok: true } }));
  };

  await run(
    "return await app.canvas.share('F123456', { channel_ids: ['C12345678'], access_level: 'write' });",
    host,
  );
  assert.deepEqual(calls[0], {
    action: 'canvasShare',
    input: { canvas_id: 'F123456', channel_ids: ['C12345678'], access_level: 'write' },
  });
});

test('caps a large result', async () => {
  const result = await run("return 'x'.repeat(600000);");
  assert.match(result.value, /\[truncated\]$/);
  assert.ok(result.value.length < 600000);
});

test('caps a single log line', async () => {
  const result = await run("console.log('x'.repeat(10000));");
  assert.ok(result.logs[0].length <= 4 * 1024 + 14);
});

test('rejects a non-string code payload', async () => {
  const request = new Request('http://guest/execute', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: 42 }),
  });
  const result = await (
    await guest.fetch(request, { SLACK: { fetch: async () => new Response('') } })
  ).json();
  assert.equal(result.error.code, 'invalid_input');
});
