import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import test from 'node:test';
import { createImageStore } from '../src/image-store.mjs';

test('saves private image files with the right extension', () => {
  const store = createImageStore();
  try {
    const path = store.save(Buffer.from('png'), 'image/png');
    assert.match(path, /\.png$/);
    assert.equal(existsSync(path), true);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.equal(statSync(store.root).mode & 0o777, 0o700);
  } finally {
    store.close();
  }
  assert.equal(existsSync(store.root), false);
});

test('evicts the oldest files past the caps', () => {
  const store = createImageStore({ maxFiles: 2, maxBytes: 100 });
  try {
    const first = store.save(Buffer.from('aaaa'), 'image/png');
    const second = store.save(Buffer.from('bbbb'), 'image/png');
    const third = store.save(Buffer.from('cccc'), 'image/png');

    assert.equal(existsSync(first), false);
    assert.equal(existsSync(second), true);
    assert.equal(existsSync(third), true);
  } finally {
    store.close();
  }
});

test('refuses a file over the byte cap', () => {
  const store = createImageStore({ maxBytes: 4 });
  try {
    assert.equal(store.save(Buffer.from('12345'), 'image/png'), null);
  } finally {
    store.close();
  }
});
