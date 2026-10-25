import assert from 'node:assert/strict';
import test from 'node:test';
import { createCanvasActions, shareThreads } from '../src/actions/canvas.mjs';

const USERS = { namesFor: async () => new Map([['U1', 'Jane']]) };

function canvas(slack, users = USERS) {
  return createCanvasActions({ slack, users });
}

test('reads comments from the canvas share thread and drops the share message', async () => {
  const calls = [];
  const slack = {
    call: async (method, args) => {
      calls.push({ method, args });
      if (method === 'files.info') {
        return {
          file: { shares: { private: { C1: [{ ts: '100.000001', reply_count: 2 }] } } },
        };
      }
      if (method === 'conversations.replies') {
        return {
          messages: [
            { ts: '100.000001', text: 'canvas card' },
            { ts: '101.000002', user: 'U1', text: 'first comment' },
            { ts: '102.000003', user: 'U2', text: 'second comment' },
          ],
        };
      }
      throw new Error(`unexpected ${method}`);
    },
  };

  const result = await canvas(slack).comments({ canvas_id: 'F0C9BTBNAA2' });

  assert.equal(calls[0].method, 'files.info');
  assert.equal(calls[1].method, 'conversations.replies');
  assert.equal(calls[1].args.ts, '100.000001');
  assert.equal(result.count, 2);
  assert.deepEqual(
    result.comments.map((comment) => comment.text),
    ['first comment', 'second comment'],
  );
  assert.deepEqual(
    result.comments.map((comment) => comment.user),
    ['Jane', 'U2'],
  );
  assert.deepEqual(result.channels, ['C1']);
});

test('reads every share thread, including public shares', async () => {
  const calls = [];
  const slack = {
    call: async (method, args) => {
      calls.push({ method, args });
      if (method === 'files.info') {
        return {
          file: {
            shares: {
              public: { C1: [{ ts: '100.000001', reply_count: 1 }] },
              private: { C2: [{ ts: '200.000001', reply_count: 1 }] },
            },
          },
        };
      }
      if (method === 'conversations.replies') {
        return {
          messages: [
            { ts: args.ts, text: 'canvas card' },
            { ts: args.channel === 'C1' ? '101.000002' : '201.000002', user: 'U1', text: 'hi' },
          ],
        };
      }
      throw new Error(`unexpected ${method}`);
    },
  };

  const result = await canvas(slack).comments({ canvas_id: 'F0C9BTBNAA2' });
  assert.equal(calls.filter((call) => call.method === 'conversations.replies').length, 2);
  assert.equal(result.count, 2);
  assert.deepEqual(result.channels.sort(), ['C1', 'C2']);
});

test('skips shares without replies', async () => {
  const calls = [];
  const slack = {
    call: async (method, args) => {
      calls.push({ method, args });
      if (method === 'files.info') {
        return {
          file: {
            shares: {
              private: {
                C1: [{ ts: '100.000001', reply_count: 0 }],
                C2: [{ ts: '200.000001', reply_count: 1 }],
              },
            },
          },
        };
      }
      return {
        messages: [
          { ts: args.ts, text: 'canvas card' },
          { ts: '201.000002', user: 'U1', text: 'only comment' },
        ],
      };
    },
  };

  const result = await canvas(slack).comments({ canvas_id: 'F0C9BTBNAA2' });
  assert.equal(calls.length, 2);
  assert.equal(result.count, 1);
});

test('ignores thread messages posted before the canvas share', async () => {
  const slack = {
    call: async (method) => {
      if (method === 'files.info') {
        return {
          file: {
            shares: {
              private: { C1: [{ ts: '100.000001', thread_ts: '90.000001', reply_count: 3 }] },
            },
          },
        };
      }
      return {
        messages: [
          { ts: '90.000001', user: 'U1', text: 'thread parent' },
          { ts: '99.000001', user: 'U1', text: 'earlier thread message' },
          { ts: '100.000001', user: 'U1', text: 'canvas share' },
          { ts: '101.000002', user: 'U2', text: 'canvas comment' },
        ],
      };
    },
  };

  const result = await canvas(slack).comments({ canvas_id: 'F0C9BTBNAA2' });
  assert.equal(result.count, 1);
  assert.equal(result.comments[0].text, 'canvas comment');
});

test('reports a canvas that is not shared', async () => {
  const slack = { call: async () => ({ file: {} }) };
  const result = await canvas(slack).comments({ canvas_id: 'F0C9BTBNAA2' });
  assert.equal(result.count, 0);
  assert.match(result.note, /not shared/);
});

test('reports a share thread with no comments', async () => {
  const slack = {
    call: async () => ({ file: { shares: { private: { C1: [{ ts: '1.000001' }] } } } }),
  };
  const result = await canvas(slack).comments({ canvas_id: 'F0C9BTBNAA2' });
  assert.equal(result.count, 0);
  assert.match(result.note, /no comments/);
});

test('keeps comments from readable channels when another channel fails', async () => {
  const slack = {
    call: async (method, args) => {
      if (method === 'files.info') {
        return {
          file: {
            shares: {
              private: {
                C1: [{ ts: '100.000001', reply_count: 1 }],
                C2: [{ ts: '200.000001', reply_count: 1 }],
              },
            },
          },
        };
      }
      if (args.channel === 'C2') {
        const error = new Error('not in channel');
        error.code = 'not_in_channel';
        throw error;
      }
      return {
        messages: [
          { ts: '100.000001', text: 'canvas card' },
          { ts: '101.000002', user: 'U1', text: 'comment' },
        ],
      };
    },
  };

  const result = await canvas(slack).comments({ canvas_id: 'F0C9BTBNAA2' });
  assert.equal(result.count, 1);
  assert.deepEqual(result.skipped, [{ channel: 'C2', code: 'not_in_channel' }]);
});

test('fails when no share thread can be read', async () => {
  const slack = {
    call: async (method) => {
      if (method === 'files.info') {
        return { file: { shares: { private: { C1: [{ ts: '1.000001', reply_count: 1 }] } } } };
      }
      const error = new Error('missing scope');
      error.code = 'missing_scope';
      throw error;
    },
  };

  await assert.rejects(
    () => canvas(slack).comments({ canvas_id: 'F0C9BTBNAA2' }),
    (error) => error.code === 'missing_scope',
  );
});

test('maps a missing canvas to not_found', async () => {
  const slack = {
    call: async () => {
      const error = new Error('canvas_not_found');
      error.code = 'canvas_not_found';
      throw error;
    },
  };
  await assert.rejects(
    () => canvas(slack).comments({ canvas_id: 'F0C9BTBNAA2' }),
    (error) => error.code === 'not_found',
  );
});

test('shareThreads uses the parent thread and the share timestamp', () => {
  const threads = shareThreads({
    shares: {
      public: {
        C1: [{ ts: '100.000001', thread_ts: '90.000001', reply_count: 3 }],
      },
    },
  });
  assert.deepEqual(threads, [
    { channel: 'C1', ts: '90.000001', after: '100.000001', reply_count: 3 },
  ]);
});

test('rejects a malformed canvas id', async () => {
  const slack = { call: async () => assert.fail('Slack should not be called') };
  await assert.rejects(() => canvas(slack).comments({ canvas_id: 'C12345678' }), /not a Slack id/);
});
