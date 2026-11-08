#!/usr/bin/env node
import { resolveCredentials, resolveToken } from '../src/credentials.mjs';
import { buildRequest } from '../src/slack/client.mjs';

const credentials = resolveCredentials();
let token;
try {
  token = resolveToken({ required: true });
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
const isUserToken =
  token.startsWith('xoxp-') || token.startsWith('xoxe.') || token.startsWith('xoxe-');
const kind = isUserToken
  ? 'user'
  : token.startsWith('xoxb-')
    ? 'bot'
    : token.startsWith('xapp-')
      ? 'app-level'
      : 'unknown';
console.log(`Token: ${kind} (${token.slice(0, 6)}…)`);
if (credentials?.refreshToken) {
  const expires = credentials.expiresAt ? new Date(credentials.expiresAt).toISOString() : 'unknown';
  console.log(`Refresh: enabled (access token expires ${expires})`);
} else {
  console.log('Refresh: none (re-run auth when the token expires)');
}
if (kind !== 'user') {
  console.log(
    '\nThis server needs a user token (xoxp-… or PKCE xoxe.…). Bot and app-level tokens will not work.',
  );
  process.exit(1);
}

async function call(method, body = {}) {
  const request = buildRequest(method, body);
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': request.contentType,
    },
    body: request.body,
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  });
  return response.json();
}
const checks = [
  ['auth.test', {}, 'identity'],
  ['conversations.list', { limit: 1 }, 'channel listing'],
  ['conversations.history', { channel: 'C0000000000', limit: 1 }, 'channel history'],
  ['users.list', { limit: 1 }, 'user listing'],
  ['usergroups.list', {}, 'usergroups'],
  ['search.messages', { query: 'the', count: 1 }, 'search'],
  [
    'canvases.sections.lookup',
    { canvas_id: 'F0000000000', criteria: { section_types: ['any_header'] } },
    'canvas read',
  ],
  ['conversations.open', { users: 'U0000000000' }, 'dm open'],
  ['users.lookupByEmail', { email: 'nobody@example.com' }, 'email lookup'],
  [
    'assistant.search.context',
    { query: 'test', content_types: ['users'], limit: 1 },
    'user search',
  ],
  ['files.getUploadURLExternal', { filename: 'probe.txt', length: 1 }, 'file upload'],
];
let failures = 0;
let unverified = 0;
for (const [method, body, label] of checks) {
  let data;
  try {
    data = await call(method, body);
  } catch (error) {
    console.log(`✗ ${label.padEnd(16)} ${method} — ${error.message}`);
    failures++;
    continue;
  }
  if (data.ok) {
    console.log(`✓ ${label.padEnd(16)} ${method}`);
    continue;
  }
  if (data.error === 'ratelimited') {
    unverified += 1;
    console.log(`~ ${label.padEnd(16)} ${method} (ratelimited, scope not exercised)`);
    continue;
  }
  if (method === 'conversations.history' && data.error === 'channel_not_found') {
    console.log(`✓ ${label.padEnd(16)} ${method} (scope ok, probe channel absent)`);
    continue;
  }
  if (method === 'canvases.sections.lookup' && data.error === 'canvas_not_found') {
    console.log(`✓ ${label.padEnd(16)} ${method} (scope ok, probe canvas absent)`);
    continue;
  }
  if (method === 'conversations.open' && ['user_not_found', 'invalid_users'].includes(data.error)) {
    console.log(`✓ ${label.padEnd(16)} ${method} (scope ok, probe user absent)`);
    continue;
  }
  if (method === 'files.getUploadURLExternal' && data.error === 'missing_argument') {
    console.log(`✓ ${label.padEnd(16)} ${method} (scope ok, probe length 0)`);
    continue;
  }

  if (
    method === 'users.lookupByEmail' &&
    ['users_not_found', 'user_not_found'].includes(data.error)
  ) {
    console.log(`✓ ${label.padEnd(16)} ${method} (scope ok, probe email absent)`);
    continue;
  }
  failures++;
  const detail = [
    data.error,
    data.needed && `needed=${data.needed}`,
    data.provided && `provided=${data.provided}`,
  ]
    .filter(Boolean)
    .join(' | ');
  console.log(`✗ ${label.padEnd(16)} ${method} — ${detail}`);
}
console.log('');
if (failures > 0) {
  console.log(
    `${failures} check(s) failed. Add the missing scopes to the app, then re-run: npm run auth`,
  );
  process.exit(1);
}
if (unverified > 0) {
  console.log(
    `All reachable checks passed. ${unverified} method(s) were rate limited and not exercised.`,
  );
} else {
  console.log('All checks passed. The MCP server can use this token.');
}
