import assert from 'node:assert/strict';
import test from 'node:test';
import { LIMITS } from '../src/config.mjs';
import { formatExecution } from '../src/server.mjs';

test('caps a large execution result', () => {
  const result = formatExecution({ ok: true, value: 'x'.repeat(LIMITS.maxResultBytes + 1000) });
  assert.equal(result.isError, undefined);
  assert.match(result.text, /\[truncated\]$/);
  assert.ok(result.text.length < LIMITS.maxResultBytes + 100);
});

test('caps large logs around an error', () => {
  const result = formatExecution({
    ok: false,
    logs: ['y'.repeat(LIMITS.maxResultBytes + 1000)],
    error: { message: 'failed', code: 'boom' },
  });
  assert.equal(result.isError, true);
  assert.match(result.text, /\[truncated\]$/);
});

test('prints a client_msg_id from an ambiguous write', () => {
  const result = formatExecution({
    ok: false,
    error: { message: 'network', code: 'ambiguous_result', client_msg_id: 'retry-3' },
  });
  assert.equal(result.isError, true);
  assert.match(result.text, /client_msg_id=retry-3/);
});

test('caps by bytes, not characters', () => {
  const result = formatExecution({ ok: true, value: 'é'.repeat(LIMITS.maxResultBytes) });
  assert.match(result.text, /\[truncated\]$/);
  assert.ok(Buffer.byteLength(result.text) <= LIMITS.maxResultBytes + 64);
});

test('prints retry hints and ambiguous candidates', () => {
  const result = formatExecution({
    ok: false,
    error: {
      message: 'matched 2 users',
      code: 'ambiguous',
      retry_after: 5,
      matches: [{ id: 'U1' }, { id: 'U2' }],
    },
  });
  assert.match(result.text, /retry_after=5/);
  assert.match(result.text, /matches=\[\{"id":"U1"\},\{"id":"U2"\}\]/);
});
