import assert from 'node:assert/strict';
import test from 'node:test';
import { createCanvasActions } from '../src/actions/canvas.mjs';

test('reads channel canvas comments from the channel history and threads', async () => {
  const calls = [];
  const slack = {
    call: async (method, args) => {
      calls.push({ method, args });
      if (method === 'files.info') return { file: { channels: ['C1'] } };
      if (method === 'conversations.history') {
        return { messages: [{ ts: '1.0', user: 'U1', text: 'first', reply_count: 1 }] };
      }
      if (method === 'conversations.replies') {
        return {
          messages: [
            { ts: '1.0', user: 'U1', text: 'first' },
            { ts: '2.0', user: 'U2', text: 'reply' },
          ],
        };
      }
      throw new Error(`unexpected ${method}`);
    },
  };
  const users = {
    namesFor: async () =>
      new Map([
        ['U1', 'Jane'],
        ['U2', 'John'],
      ]),
  };

  const result = await createCanvasActions({ slack, users }).comments({ canvas_id: 'F1' });
  assert.equal(result.channel, 'C1');
  assert.equal(result.count, 2);
  assert.deepEqual(
    result.comments.map((comment) => comment.user),
    ['Jane', 'John'],
  );
  assert.deepEqual(
    calls.map((call) => call.method),
    ['files.info', 'conversations.history', 'conversations.replies'],
  );
});

test('returns an empty result for a standalone canvas', async () => {
  const slack = { call: async () => ({ file: { channels: [] } }) };
  const users = { namesFor: async () => new Map() };
  const result = await createCanvasActions({ slack, users }).comments({ canvas_id: 'F1' });
  assert.equal(result.channel, null);
  assert.equal(result.count, 0);
  assert.match(result.note, /not attached/);
});
