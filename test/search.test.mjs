import assert from 'node:assert/strict';
import test from 'node:test';
import { createSearch } from '../src/search.mjs';

const index = {
  methods: [
    {
      method: 'chat.postMessage',
      required: true,
      args: 'ChatArgs',
      response: 'ChatResponse',
      description: 'Sends a message to a channel.',
      see: 'https://docs.slack.dev/reference/methods/chat.postMessage',
    },
    {
      method: 'admin.users.list',
      required: false,
      args: 'AdminArgs',
      response: 'AdminResponse',
      description: 'List users on a workspace.',
      see: '',
    },
    {
      method: 'canvases.delete',
      required: true,
      args: 'CanvasArgs',
      response: 'CanvasResponse',
      description: 'Deletes a canvas.',
      see: '',
    },
  ],
  declarations: {
    ChatArgs: 'interface ChatArgs { channel: string; text: string; }',
    AdminArgs: 'interface AdminArgs {}',
    CanvasArgs: 'interface CanvasArgs { canvas_id: string; }',
  },
};

const allowed = new Set(['chat.postMessage', 'canvases.getContent']);
const search = createSearch({ index, allowed });

test('searches only allowed methods by default', () => {
  const results = search.methods('users', 5);
  assert.deepEqual(results, []);
});

test('finds blocked methods when asked', () => {
  const results = search.methods('admin', 5, true);
  assert.equal(results[0].method, 'admin.users.list');
});

test('renders the signature and types', () => {
  const text = search.render(search.methods('postMessage', 1), true);
  assert.match(text, /chat\.postMessage\(options: ChatArgs\)/);
  assert.match(text, /Sends a message/);
  assert.match(text, /interface ChatArgs/);
});

test('looks up declarations by name', () => {
  const found = search.type('chatargs');
  assert.equal(found.name, 'ChatArgs');
  assert.equal(search.type('missing'), null);
});

test('lists allowed methods missing from the SDK index', () => {
  const results = search.methods('getContent', 5);
  assert.equal(results[0].method, 'canvases.getContent');
  assert.equal(results[0].unindexed, true);
  assert.match(search.render(results, false), /\[not in SDK index\]/);
});

test('omits type declarations unless requested', () => {
  const text = search.render(search.methods('postMessage', 1), false);
  assert.doesNotMatch(text, /interface ChatArgs/);
  assert.match(text, /chat\.postMessage/);
});
