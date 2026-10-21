import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const SERVICE = 'slack-codemode-mcp';
const LABEL = 'Slack Codemode MCP Token';
const CONFIG_DIR = join(homedir(), '.config', 'slack-codemode');
const TOKEN_FILE = join(CONFIG_DIR, 'token');
const LOCK_FILE = join(CONFIG_DIR, 'refresh.lock');
const REFRESH_MARGIN_MS = 60_000;
const LOCK_STALE_MS = 120_000;
const REFRESH_TIMEOUT_MS = 20_000;
const LOCK_WAIT_MS = 25_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function combineSignals(timeoutMs, external) {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!external) return timeout;
  if (AbortSignal.any) return AbortSignal.any([timeout, external]);
  const controller = new AbortController();
  for (const signal of [timeout, external]) {
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return controller.signal;
}

function shell(command, options = {}) {
  return spawnSync(command, { shell: true, encoding: 'utf8', ...options });
}

function parseStored(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed.accessToken === 'string' ? parsed : null;
  } catch {
    return { accessToken: value, refreshToken: null, expiresAt: null, clientId: null };
  }
}

function keychainValue() {
  if (process.platform !== 'darwin') return null;
  const result = spawnSync('security', ['find-generic-password', '-s', SERVICE, '-w'], {
    encoding: 'utf8',
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

export function readStoredCredentials() {
  const fromKeychain = keychainValue();
  if (fromKeychain) return parseStored(fromKeychain);
  if (existsSync(TOKEN_FILE)) return parseStored(readFileSync(TOKEN_FILE, 'utf8').trim());
  return null;
}

export function resolveCredentials() {
  const fromEnv = process.env.SLACK_USER_TOKEN?.trim();
  if (fromEnv) return { accessToken: fromEnv, refreshToken: null, expiresAt: null, clientId: null };

  const command = process.env.SLACK_TOKEN_CMD?.trim();
  if (command) {
    const result = shell(command);
    if (result.status !== 0) {
      throw new Error(`credential command failed: ${command}\n${(result.stderr || '').trim()}`);
    }
    const value = result.stdout.trim();
    if (value) {
      return { accessToken: value, refreshToken: null, expiresAt: null, clientId: null };
    }
  }

  return readStoredCredentials();
}

export function resolveToken({ required = false } = {}) {
  const credentials = resolveCredentials();
  if (credentials?.accessToken) return credentials.accessToken;

  if (!required) return null;

  throw new Error(
    [
      'No Slack token available. Provide one of:',
      '  SLACK_USER_TOKEN=<token>',
      '  SLACK_TOKEN_CMD="op read op://Private/slack-codemode/token"',
      `  a file at ${TOKEN_FILE} (mode 0600)`,
      process.platform === 'darwin'
        ? '  the macOS Keychain: security add-generic-password -s slack-codemode-mcp -a "$USER" -w'
        : '',
    ]
      .filter(Boolean)
      .join('\n'),
  );
}

export function storeCredentials(credentials) {
  const serialized = JSON.stringify(credentials);
  const command = process.env.SLACK_TOKEN_STORE_CMD?.trim();
  if (command) {
    const result = shell(command, { input: serialized });
    if (result.status !== 0) {
      throw new Error(`store command failed: ${(result.stderr || '').trim()}`);
    }
    return 'SLACK_TOKEN_STORE_CMD';
  }

  if (process.platform === 'darwin') {
    const result = spawnSync(
      'security',
      [
        'add-generic-password',
        '-U',
        '-s',
        SERVICE,
        '-a',
        process.env.USER ?? 'user',
        '-l',
        LABEL,
        '-w',
      ],
      { encoding: 'utf8', input: `${serialized}\n${serialized}\n` },
    );
    if (result.status !== 0) {
      throw new Error(`could not write the Keychain item: ${(result.stderr || '').trim()}`);
    }
    return 'macOS Keychain';
  }

  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  const temporary = join(CONFIG_DIR, `.token-${process.pid}-${Date.now()}`);
  writeFileSync(temporary, serialized, { mode: 0o600 });
  renameSync(temporary, TOKEN_FILE);
  chmodSync(TOKEN_FILE, 0o600);
  return TOKEN_FILE;
}

async function acquireLock() {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < Math.ceil(LOCK_WAIT_MS / 100); attempt += 1) {
    const owner = randomBytes(16).toString('hex');
    try {
      const fd = openSync(LOCK_FILE, 'wx', 0o600);
      writeSync(fd, owner);
      closeSync(fd);
      return owner;
    } catch (error) {
      if (error.code !== 'EEXIST') return null;
      try {
        if (Date.now() - statSync(LOCK_FILE).mtimeMs > LOCK_STALE_MS) unlinkSync(LOCK_FILE);
      } catch {}
      await sleep(100);
    }
  }
  return null;
}

function releaseLock(owner) {
  try {
    if (readFileSync(LOCK_FILE, 'utf8') === owner) unlinkSync(LOCK_FILE);
  } catch {}
}

export async function refreshCredentials(credentials, options = {}) {
  if (!credentials?.refreshToken) {
    throw new Error('No refresh token is stored. Run `npm run auth`.');
  }
  if (!credentials.clientId) {
    throw new Error('No client id is stored with the token. Run `npm run auth`.');
  }

  const fetchFn = options.fetch ?? fetch;
  const store = options.store ?? storeCredentials;
  const reload = options.reload ?? readStoredCredentials;
  const lock = options.lock ?? acquireLock;
  const unlock = options.unlock ?? releaseLock;

  const usable = (stored) => {
    if (!stored?.accessToken) return false;
    if (stored.expiresAt != null && stored.expiresAt <= Date.now() + REFRESH_MARGIN_MS)
      return false;
    return stored.accessToken !== credentials.accessToken || stored.expiresAt != null;
  };

  const owner = await lock();
  if (!owner) {
    const stored = reload();
    if (usable(stored)) return stored;
    throw new Error('Token refresh is already in progress. Retry in a moment.');
  }

  try {
    const stored = reload();
    if (usable(stored)) return stored;

    const source = stored?.refreshToken
      ? { ...credentials, ...stored, clientId: stored.clientId ?? credentials.clientId }
      : credentials;
    const response = await fetchFn('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: source.refreshToken,
        client_id: source.clientId,
      }),
      redirect: 'error',
      signal: combineSignals(REFRESH_TIMEOUT_MS, options.signal),
    });
    if (!response.ok) throw new Error(`Token refresh failed with HTTP ${response.status}`);

    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error('Token refresh returned a non-JSON body.');
    }
    if (!data.ok) throw new Error(`Token refresh failed: ${data.error}`);

    const next = {
      accessToken: data.access_token ?? data.authed_user?.access_token,
      refreshToken: data.refresh_token ?? source.refreshToken,
      expiresAt: data.expires_in ? Date.now() + Number(data.expires_in) * 1000 : null,
      clientId: source.clientId,
    };
    if (!next.accessToken) throw new Error('Token refresh returned no access token.');

    store(next);
    return next;
  } finally {
    unlock(owner);
  }
}

export function credentialsNeedRefresh(credentials) {
  return Boolean(
    credentials?.refreshToken &&
      credentials.expiresAt != null &&
      Date.now() > credentials.expiresAt - REFRESH_MARGIN_MS,
  );
}

export function openBrowser(url) {
  const command =
    process.platform === 'darwin'
      ? `open ${JSON.stringify(url)}`
      : process.platform === 'win32'
        ? `start "" ${JSON.stringify(url)}`
        : `xdg-open ${JSON.stringify(url)}`;
  return shell(command).status === 0;
}
