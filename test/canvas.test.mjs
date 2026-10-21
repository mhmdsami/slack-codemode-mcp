import assert from 'node:assert/strict';
import test from 'node:test';
import { createCanvasActions } from '../src/actions/canvas.mjs';

test('reads canvas content as markdown by default', async () => {
  const calls = [];
  const slack = {
    call: async (method, args) => {
      calls.push({ method, args });
      return { content: '# Plan' };
    },
  };

  const result = await createCanvasActions({ slack }).read({ canvas_id: 'F123' });
  assert.equal(calls[0].method, 'canvases.getContent');
  assert.deepEqual(calls[0].args, { canvas_id: 'F123' });
  assert.equal(result.content, '# Plan');
  assert.equal(result.content_type, 'markdown');
});

test('passes content_type through', async () => {
  const calls = [];
  const slack = {
    call: async (method, args) => {
      calls.push({ method, args });
      return { content: '<h1>Plan</h1>' };
    },
  };

  await createCanvasActions({ slack }).read({ canvas_id: 'F123', content_type: 'html' });
  assert.equal(calls[0].args.content_type, 'html');
});
