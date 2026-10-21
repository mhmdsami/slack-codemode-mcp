import assert from 'node:assert/strict';
import test from 'node:test';
import { createRuntimeManager } from '../src/server.mjs';

function fakeRuntime() {
  return {
    alive: true,
    closed: false,
    async close() {
      this.closed = true;
    },
    closeSync() {
      this.closed = true;
      this.alive = false;
    },
  };
}

test('stop closes a running runtime', async () => {
  const runtime = fakeRuntime();
  const manager = createRuntimeManager({ start: async () => runtime });

  await manager.ensure();
  await manager.stop();

  assert.equal(runtime.closed, true);
  await assert.rejects(() => manager.ensure(), /shutting down/);
});

test('stop cancels a pending startup', async () => {
  let started = null;
  const start = async ({ signal }) => {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 1000);
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(new Error('startup cancelled'));
        },
        { once: true },
      );
    });
    started = fakeRuntime();
    return started;
  };
  const manager = createRuntimeManager({ start });

  const pending = manager.ensure();
  await manager.stop();

  await assert.rejects(() => pending, /startup cancelled/);
  assert.equal(started, null);
});

test('stopSync closes the current runtime during shutdown', async () => {
  const runtime = fakeRuntime();
  const manager = createRuntimeManager({ start: async () => runtime });

  await manager.ensure();
  manager.stopSync();

  assert.equal(runtime.closed, true);
  await assert.rejects(() => manager.ensure(), /shutting down/);
});
