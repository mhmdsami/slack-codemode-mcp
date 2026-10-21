import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePermalink } from '../src/actions/messages.mjs';

test('parses a message permalink', () => {
  const link = parsePermalink('https://workspace.slack.com/archives/C123ABC/p1699999999000000');
  assert.equal(link.channel, 'C123ABC');
  assert.equal(link.ts, '1699999999.000000');
  assert.equal(link.threadTs, null);
});

test('keeps thread_ts from the query string', () => {
  const link = parsePermalink(
    'https://workspace.slack.com/archives/D123ABC/p1699999999000000?thread_ts=1699999998.000001&cid=D123ABC',
  );
  assert.equal(link.channel, 'D123ABC');
  assert.equal(link.threadTs, '1699999998.000001');
});

test('rejects non-slack links', () => {
  assert.throws(() => parsePermalink('https://example.com/archives/C1/p1'), /permalink/);
  assert.throws(() => parsePermalink('not a url'), /URL/);
});
