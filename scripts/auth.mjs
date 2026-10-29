#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openBrowser, storeCredentials } from '../src/credentials.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = path.join(ROOT, '.env');
if (fs.existsSync(ENV_FILE)) {
  process.loadEnvFile(ENV_FILE);
}
const REDIRECT_PORT = Number(process.env.SLACK_OAUTH_PORT ?? 33417);
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;
const DEFAULT_SCOPES = [
  'chat:write',
  'channels:read',
  'channels:history',
  'groups:read',
  'groups:history',
  'im:read',
  'im:write',
  'im:history',
  'mpim:read',
  'mpim:write',
  'mpim:history',
  'search:read',
  'search:read.users',
  'users:read',
  'users:read.email',
  'files:read',
  'files:write',
  'usergroups:read',
  'canvases:read',
  'canvases:write',
];
const USER_SCOPES = process.env.SLACK_USER_SCOPES
  ? process.env.SLACK_USER_SCOPES.split(',')
      .map((scope) => scope.trim())
      .filter(Boolean)
  : DEFAULT_SCOPES;
if (process.argv.includes('--scopes')) {
  console.log(USER_SCOPES.join('\n'));
  process.exit(0);
}

const dryRun = process.argv.includes('--dry-run');
const noOpen = process.argv.includes('--no-open');
const clientId = process.env.SLACK_CLIENT_ID?.trim();
if (!clientId) {
  console.error(
    [
      'Missing Slack app credentials.',
      '',
      `Create an internal app at https://api.slack.com/apps and put credentials in ${ENV_FILE}:`,
      '',
      '  SLACK_CLIENT_ID=...',
      '',
      'PKCE must be enabled for the app (OAuth & Permissions). No client secret is needed.',
      '',
      `Add this redirect URL to the app: ${REDIRECT_URI}`,
      'Add these User Token Scopes:',
      `  ${USER_SCOPES.join(' ')}`,
    ].join('\n'),
  );
  process.exit(1);
}
const state = crypto.randomBytes(16).toString('hex');
const codeVerifier = crypto.randomBytes(32).toString('base64url');
const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
const authorizeUrl =
  'https://slack.com/oauth/v2/authorize?' +
  new URLSearchParams({
    client_id: clientId,
    user_scope: USER_SCOPES.join(','),
    redirect_uri: REDIRECT_URI,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  }).toString();
if (dryRun) {
  console.log(authorizeUrl);
  process.exit(0);
}
if (process.argv.includes('--preview')) {
  const file = path.join(ROOT, 'preview.html');
  fs.writeFileSync(
    file,
    renderPage({
      ok: true,
      title: 'Connected to Slack',
      subtitle: 'Slack Codemode MCP is authorized for Acme. You can close this tab.',
      rows: [
        ['Workspace', 'Acme'],
        ['Account', 'jane.doe'],
        ['Scopes', '14 granted'],
      ],
      hint: 'Token stored locally',
    }),
  );
  console.log(file);
  process.exit(0);
}
console.log('Flow: PKCE (public client, no secret)');
console.log('Authorize this app in your browser.');
console.log(`Redirect URL: ${REDIRECT_URI}`);
console.log('User scopes:', USER_SCOPES.join(', '));
console.log('');
console.log('If Slack shows "Invalid permissions requested", the app is missing one of');
console.log('these scopes under OAuth & Permissions -> User Token Scopes. Request a subset');
console.log('with SLACK_USER_SCOPES=chat:write to find the culprit.');
console.log('');
if (!noOpen) openBrowser(authorizeUrl);
if (noOpen) console.log(`${authorizeUrl}\n`);

function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (ch) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[ch],
  );
}

function renderPage({ ok, title, subtitle, rows = [], hint = '' }) {
  const icon = ok
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>`;
  const details = rows.length
    ? `<dl>${rows
        .map(
          ([label, value]) =>
            `<div class="row"><dt>${escapeHtml(label)}</dt><dd title="${escapeHtml(value)}">${escapeHtml(value)}</dd></div>`,
        )
        .join('')}</dl>`
    : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root {
    color-scheme: dark;
    --background: #111820;
    --foreground: #edf3ec;
    --card: #18212b;
    --muted-foreground: #9aa9a3;
    --primary: #71c98e;
    --destructive: #ee765d;
    --border: rgb(181 199 191 / 16%);
    --radius: 8px;
    --font: ui-monospace, "SFMono-Regular", "SF Mono", Menlo, monospace;
  }
  * { box-sizing: border-box; }
  html, body { min-height: 100%; }
  body {
    margin: 0;
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 24px;
    background: var(--background);
    color: var(--foreground);
    font: 13px/1.5 var(--font);
    font-size: 13px;
    -webkit-font-smoothing: antialiased;
  }
  .card {
    width: 100%;
    max-width: 420px;
    padding: 22px 22px 18px;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    animation: fade-up 0.18s ease-out both;
  }
  header { display: flex; gap: 12px; align-items: flex-start; }
  .badge {
    flex: none;
    width: 32px;
    height: 32px;
    display: grid;
    place-items: center;
    border-radius: 6px;
    color: var(--primary);
    background: rgb(113 201 142 / 12%);
    border: 1px solid rgb(113 201 142 / 28%);
  }
  .badge svg { width: 17px; height: 17px; }
  .error .badge {
    color: var(--destructive);
    background: rgb(238 118 93 / 12%);
    border-color: rgb(238 118 93 / 28%);
  }
  h1 {
    margin: 0 0 2px;
    font-size: 14px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  p.sub {
    margin: 0;
    color: var(--muted-foreground);
    font-size: 12.5px;
    line-height: 1.55;
  }
  dl { margin: 18px 0 0; border-top: 1px solid var(--border); }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 9px 0;
    border-bottom: 1px solid var(--border);
    font-size: 12.5px;
  }
  dt {
    color: var(--muted-foreground);
    font-size: 10.5px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  dd {
    margin: 0;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hint {
    margin: 14px 0 0;
    display: flex;
    align-items: center;
    gap: 7px;
    color: var(--muted-foreground);
    font-size: 11.5px;
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--primary);
  }
  .error .dot { background: var(--destructive); }
  @keyframes fade-up {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: none; }
  }
  @media (prefers-reduced-motion: reduce) {
    * { animation: none !important; }
  }
</style>
</head>
<body>
  <main class="card${ok ? '' : ' error'}">
    <header>
      <div class="badge">${icon}</div>
      <div>
        <h1>${escapeHtml(title)}</h1>
        <p class="sub">${escapeHtml(subtitle)}</p>
      </div>
    </header>
    ${details}
    ${hint ? `<p class="hint"><span class="dot"></span>${escapeHtml(hint)}</p>` : ''}
  </main>
</body>
</html>`;
}

function sendPage(res, status, html) {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
    'cache-control': 'no-store',
  });
  res.end(html);
}

function stateMatches(value) {
  if (typeof value !== 'string' || value.length !== state.length) return false;
  return crypto.timingSafeEqual(Buffer.from(value), Buffer.from(state));
}

let timeout;
let result;
try {
  result = await new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, `http://localhost:${REDIRECT_PORT}`);
      if (req.method !== 'GET' || url.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      const fail = (message) => {
        clearTimeout(timeout);
        sendPage(
          res,
          400,
          renderPage({
            ok: false,
            title: 'Authorization failed',
            subtitle: message,
            hint: 'Return to the terminal and try again',
          }),
        );
        server.close();
        reject(new Error(message));
      };
      if (url.searchParams.get('error')) return fail(url.searchParams.get('error'));
      if (!stateMatches(url.searchParams.get('state'))) {
        return fail('state mismatch — start over');
      }
      const code = url.searchParams.get('code');
      if (!code) return fail('no code in callback');
      try {
        const exchange = await fetch('https://slack.com/api/oauth.v2.access', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: clientId,
            code,
            redirect_uri: REDIRECT_URI,
            code_verifier: codeVerifier,
          }),
        });
        const data = await exchange.json();
        if (!data.ok) return fail(`token exchange failed: ${data.error}`);
        const token = data.access_token ?? data.authed_user?.access_token;
        if (!token) return fail('token exchange did not return an access token');
        const scopes = data.scope ?? data.authed_user?.scope ?? '';
        const verify = await fetch('https://slack.com/api/auth.test', {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
        });
        const who = await verify.json();
        if (!who.ok) return fail(`token obtained but auth.test failed: ${who.error}`);
        const count = scopes.split(',').filter(Boolean).length;
        sendPage(
          res,
          200,
          renderPage({
            ok: true,
            title: 'Connected to Slack',
            subtitle: `Slack Codemode MCP is authorized for ${who.team}. You can close this tab.`,
            rows: [
              ['Workspace', who.team],
              ['Account', who.user],
              ['Scopes', count ? `${count} granted` : 'granted'],
            ],
            hint: 'Token stored locally',
          }),
        );
        server.close();
        clearTimeout(timeout);
        resolve({
          token,
          scopes,
          who,
          clientId,
          refreshToken: data.refresh_token ?? data.authed_user?.refresh_token ?? null,
          expiresAt: data.expires_in ? Date.now() + Number(data.expires_in) * 1000 : null,
        });
      } catch (error) {
        fail(error?.message ?? String(error));
      }
    });
    server.on('error', reject);
    server.listen(REDIRECT_PORT, '127.0.0.1');
    timeout = setTimeout(
      () => {
        server.close();
        reject(new Error('timed out waiting for the callback (5 minutes)'));
      },
      5 * 60 * 1000,
    );
    timeout.unref();
  });
} catch (error) {
  console.error(`Authorization failed: ${error.message}`);
  process.exit(1);
}
let location;
try {
  location = storeCredentials({
    accessToken: result.token,
    refreshToken: result.refreshToken,
    expiresAt: result.expiresAt,
    clientId: result.clientId,
  });
} catch (error) {
  console.error(`Token obtained but could not be stored: ${error.message}`);
  process.exit(1);
}
console.log('');
console.log(
  `Authorized as ${result.who.user} (${result.who.user_id}) in ${result.who.team} (${result.who.team_id}).`,
);
console.log(`Granted user scopes: ${result.scopes || '(not reported)'}`);
console.log(`Token stored in ${location}.`);
console.log(
  result.refreshToken
    ? 'Refresh token stored; access tokens renew automatically.'
    : 'No refresh token returned; re-run auth when the token expires.',
);
console.log('Restart the MCP server (or start a new session) to pick it up.');
