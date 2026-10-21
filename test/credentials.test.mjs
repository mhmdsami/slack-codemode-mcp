import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveToken } from '../src/credentials.mjs';

test('prefers SLACK_USER_TOKEN', () => {
  const previous = process.env.SLACK_USER_TOKEN;
  process.env.SLACK_USER_TOKEN = 'xoxp-test';
  try {
    assert.equal(resolveToken(), 'xoxp-test');
  } finally {
    if (previous === undefined) delete process.env.SLACK_USER_TOKEN;
    else process.env.SLACK_USER_TOKEN = previous;
  }
});
