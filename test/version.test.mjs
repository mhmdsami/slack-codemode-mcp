import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { VERSION } from '../src/config.mjs';

test('prints the package version', () => {
  const entry = fileURLToPath(new URL('../mcp/server.mjs', import.meta.url));
  const output = execFileSync(process.execPath, [entry, '--version'], { encoding: 'utf8' });
  assert.equal(output.trim(), VERSION);
});
