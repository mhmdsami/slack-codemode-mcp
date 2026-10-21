import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRequest, encodingFor } from '../src/slack/client.mjs';

test('form-encodes methods that reject JSON', () => {
  assert.equal(encodingFor('search.messages'), 'form');
  assert.equal(encodingFor('users.info'), 'form');
  assert.equal(encodingFor('users.lookupByEmail'), 'form');
});

test('uses JSON for the rest', () => {
  assert.equal(encodingFor('chat.postMessage'), 'json');
  assert.equal(encodingFor('canvases.edit'), 'json');
});

test('builds a JSON request', () => {
  const request = buildRequest('chat.postMessage', { channel: 'C1', text: 'hi' });
  assert.equal(request.contentType, 'application/json; charset=utf-8');
  assert.deepEqual(JSON.parse(request.body), { channel: 'C1', text: 'hi' });
});

test('builds a form request', () => {
  const request = buildRequest('users.info', { user: 'U1' });
  assert.equal(request.contentType, 'application/x-www-form-urlencoded');
  assert.equal(request.body, 'user=U1');
});
