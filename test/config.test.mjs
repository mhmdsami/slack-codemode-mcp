import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { ROOT, readAllowlist, readIndex } from '../src/config.mjs';

test('allowlist is populated and has no duplicates', () => {
  const methods = [...readAllowlist()];
  assert.ok(methods.length > 0);
  assert.equal(new Set(methods).size, methods.length);
  assert.ok(methods.includes('chat.postMessage'));
});

test('api index has methods and declarations', () => {
  const index = readIndex();
  assert.ok(index.methods.length > 0);
  assert.ok(Object.keys(index.declarations).length > 0);
});

test('actions only call allowlisted Slack methods', () => {
  const allowed = readAllowlist();
  const directory = join(ROOT, 'src', 'actions');
  const used = new Set();
  let calls = 0;
  let literals = 0;

  for (const file of readdirSync(directory)) {
    if (!file.endsWith('.mjs')) continue;
    const source = readFileSync(join(directory, file), 'utf8');
    calls += source.match(/slack\.call\(/g)?.length ?? 0;
    for (const match of source.matchAll(/slack\.call\('([^']+)'/g)) {
      used.add(match[1]);
      literals += 1;
    }
  }

  assert.equal(literals, calls);
  for (const method of used) assert.ok(allowed.has(method), `${method} is not allowlisted`);
});
