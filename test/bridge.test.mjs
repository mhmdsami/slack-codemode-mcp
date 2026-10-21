import assert from 'node:assert/strict';
import test from 'node:test';
import { createBridge } from '../src/runtime/bridge.mjs';

test('rejects unknown bridge tokens and methods', async () => {
  const bridge = createBridge({
    allowed: new Set(['auth.test']),
    slack: { call: async () => ({ ok: true, user: 'someone' }) },
    actions: { run: async () => ({ ok: true }) },
  });
  const port = await bridge.start();
  const url = `http://127.0.0.1:${port}/call`;
  bridge.addExecution('exec-1', 'bridge-secret');

  try {
    const denied = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-slack-execution-id': 'exec-1',
        'x-slack-bridge-token': 'wrong',
      },
      body: JSON.stringify({ executionId: 'exec-1', method: 'auth.test', args: {} }),
    });
    assert.equal(denied.status, 401);

    const blocked = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-slack-execution-id': 'exec-1',
        'x-slack-bridge-token': 'bridge-secret',
      },
      body: JSON.stringify({ executionId: 'exec-1', method: 'chat.postMessage', args: {} }),
    });
    const blockedBody = await blocked.json();
    assert.equal(blockedBody.ok, false);
    assert.equal(blockedBody.error.code, 'not_allowed');

    const allowed = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-slack-execution-id': 'exec-1',
        'x-slack-bridge-token': 'bridge-secret',
      },
      body: JSON.stringify({ executionId: 'exec-1', method: 'auth.test', args: {} }),
    });
    const allowedBody = await allowed.json();
    assert.equal(allowedBody.ok, true);
    assert.equal(allowedBody.value.user, 'someone');
  } finally {
    bridge.removeExecution('exec-1');
    await bridge.close();
  }
});
