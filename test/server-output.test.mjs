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
