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

  const result = await createCanvasActions({ slack }).read({ canvas_id: 'F123456' });
  assert.equal(calls[0].method, 'canvases.getContent');
  assert.deepEqual(calls[0].args, { canvas_id: 'F123456' });
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

  await createCanvasActions({ slack }).read({ canvas_id: 'F123456', content_type: 'html' });
  assert.equal(calls[0].args.content_type, 'html');
});

test('rejects a missing canvas id before calling Slack', async () => {
  const slack = { call: async () => assert.fail('Slack should not be called') };
  await assert.rejects(
    () => createCanvasActions({ slack }).read({}),
    (error) => error.code === 'invalid_input' && /canvas_id/.test(error.message),
  );
  await assert.rejects(
    () => createCanvasActions({ slack }).read({ canvas_id: 'not a canvas' }),
    /not a Slack id/,
  );
});

test('rejects an unsupported content type', async () => {
  const slack = { call: async () => assert.fail('Slack should not be called') };
  await assert.rejects(
    () => createCanvasActions({ slack }).read({ canvas_id: 'F123456', content_type: 'pdf' }),
    /content_type/,
  );
});

test('caps the number of edit operations', async () => {
  const slack = { call: async () => assert.fail('Slack should not be called') };
  await assert.rejects(
    () =>
      createCanvasActions({ slack }).edit({
        canvas_id: 'F123456',
        changes: Array.from({ length: 101 }, () => ({ operation: 'insert_at_end' })),
      }),
    /at most 100/,
  );
});

test('requires a title and body when creating a canvas', async () => {
  const slack = { call: async () => assert.fail('Slack should not be called') };
  await assert.rejects(
    () => createCanvasActions({ slack }).create({ title: '', markdown: 'body' }),
    /title.*required/,
  );
  await assert.rejects(
    () => createCanvasActions({ slack }).create({ title: 'Plan', markdown: '  ' }),
    /markdown.*required/,
  );
});

test('passes a channel id when creating a canvas in a channel', async () => {
  const calls = [];
  const slack = {
    call: async (method, args) => {
      calls.push({ method, args });
      return { canvas_id: 'F123456' };
    },
  };

  const result = await createCanvasActions({ slack }).create({
    title: 'Plan',
    markdown: 'body',
    channel_id: 'C12345678',
  });
  assert.equal(calls[0].args.channel_id, 'C12345678');
  assert.equal(result.channel_id, 'C12345678');
});

test('validates canvas edit operations before calling Slack', async () => {
  const slack = { call: async () => assert.fail('Slack should not be called') };
  const canvas = createCanvasActions({ slack });

  await assert.rejects(
    () => canvas.edit({ canvas_id: 'F123456', changes: [{ operation: 'append' }] }),
    /operation.*must be one of/,
  );
  await assert.rejects(
    () =>
      canvas.edit({
        canvas_id: 'F123456',
        changes: [
          { operation: 'insert_after', document_content: { type: 'markdown', markdown: 'x' } },
        ],
      }),
    /section_id.*required for insert_after/,
  );
  await assert.rejects(
    () =>
      canvas.edit({
        canvas_id: 'F123456',
        changes: [{ operation: 'insert_at_end', document_content: { type: 'text', text: 'x' } }],
      }),
    /document_content.type/,
  );
  await assert.rejects(
    () => canvas.edit({ canvas_id: 'F123456', changes: [{ operation: 'insert_at_end' }] }),
    /document_content.*required/,
  );
});

test('passes valid edit operations through', async () => {
  const calls = [];
  const slack = {
    call: async (method, args) => {
      calls.push({ method, args });
      return { ok: true };
    },
  };

  const changes = [
    { operation: 'insert_at_end', document_content: { type: 'markdown', markdown: 'done' } },
    { operation: 'delete', section_id: 'temp' },
    {
      operation: 'replace',
      section_id: 'sec-1',
      document_content: { type: 'markdown', markdown: 'new' },
    },
  ];
  await createCanvasActions({ slack }).edit({ canvas_id: 'F123456', changes });
  assert.deepEqual(calls[0].args.changes, changes);
});

test('looks up sections with a type filter', async () => {
  const calls = [];
  const slack = {
    call: async (method, args) => {
      calls.push({ method, args });
      return { sections: [{ id: 's1' }] };
    },
  };

  const result = await createCanvasActions({ slack }).sections({
    canvas_id: 'F123456',
    section_types: ['h1', 'h2'],
    text: 'Status',
  });
  assert.deepEqual(calls[0].args.criteria, {
    section_types: ['h1', 'h2'],
    contains_text: 'Status',
  });
  assert.equal(result.sections.length, 1);
});

test('requires a section filter', async () => {
  const slack = { call: async () => assert.fail('Slack should not be called') };
  const canvas = createCanvasActions({ slack });
  await assert.rejects(
    () => canvas.sections({ canvas_id: 'F123456' }),
    /Provide `text` or `section_types`/,
  );
  await assert.rejects(
    () => canvas.sections({ canvas_id: 'F123456', section_types: ['h4'] }),
    /section_types.*must use/,
  );
  await assert.rejects(
    () =>
      canvas.sections({ canvas_id: 'F123456', section_types: ['h1', 'h2', 'h3', 'any_header'] }),
    /1 to 3/,
  );
});

test('shares a canvas with channels or users', async () => {
  const calls = [];
  const slack = {
    call: async (method, args) => {
      calls.push({ method, args });
      return { ok: true };
    },
  };

  const result = await createCanvasActions({ slack }).share({
    canvas_id: 'F123456',
    channel_ids: ['C12345678'],
    access_level: 'write',
  });
  assert.equal(calls[0].method, 'canvases.access.set');
  assert.deepEqual(calls[0].args.channel_ids, ['C12345678']);
  assert.equal(calls[0].args.access_level, 'write');
  assert.equal(result.access_level, 'write');
});

test('share requires a target and a valid access level', async () => {
  const slack = { call: async () => assert.fail('Slack should not be called') };
  const canvas = createCanvasActions({ slack });
  await assert.rejects(() => canvas.share({ canvas_id: 'F123456' }), /channel_ids.*user_ids/);
  await assert.rejects(
    () => canvas.share({ canvas_id: 'F123456', channel_ids: ['C12345678'], access_level: 'admin' }),
    /access_level/,
  );
});
