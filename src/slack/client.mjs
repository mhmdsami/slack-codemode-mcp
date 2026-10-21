import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { credentialsNeedRefresh, refreshCredentials } from '../credentials.mjs';

const FORM_METHODS = new Set(['users.info', 'users.lookupByEmail', 'files.getUploadURLExternal']);

const READ_METHODS = new Set([
  'auth.test',
  'chat.getPermalink',
  'search.messages',
  'conversations.list',
  'conversations.info',
  'conversations.history',
  'conversations.replies',
  'users.info',
  'users.list',
  'usergroups.list',
  'canvases.sections.lookup',
  'canvases.getContent',
  'users.lookupByEmail',
  'assistant.search.context',
  'files.info',
]);

export const executionSignal = new AsyncLocalStorage();

export function isIdempotent(method) {
  return READ_METHODS.has(method);
}

export function requestSignal(timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const external = executionSignal.getStore();
  if (!external) return timeout;
  if (AbortSignal.any) return AbortSignal.any([timeout, external]);
  const controller = new AbortController();
  const abort = () => controller.abort();
  for (const signal of [timeout, external]) {
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  }
  return controller.signal;
}

export class SlackError extends Error {
  constructor(message, detail = {}) {
    super(message);
    this.name = 'SlackError';
    this.code = detail.code;
    this.needed = detail.needed;
    this.provided = detail.provided;
    this.retryAfter = detail.retryAfter;
    this.clientMsgId = detail.clientMsgId;
  }
}

export function encodingFor(method) {
  return method.startsWith('search.') || FORM_METHODS.has(method) ? 'form' : 'json';
}

export function buildRequest(method, args) {
  const encoding = encodingFor(method);
  if (encoding === 'form') {
    return {
      encoding,
      contentType: 'application/x-www-form-urlencoded',
      body: new URLSearchParams(args ?? {}).toString(),
    };
  }
  return {
    encoding,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(args ?? {}),
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function abortableWait(wait, ms, signal) {
  if (!signal) return wait(ms);
  if (signal.aborted) return Promise.reject(new Error('cancelled'));
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(new Error('cancelled'));
    };
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    signal.addEventListener('abort', onAbort, { once: true });
    wait(ms).then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

function ambiguous(message, args) {
  const clientMsgId = args?.client_msg_id;
  const hint = clientMsgId
    ? `Retry with client_msg_id=${clientMsgId}.`
    : 'The write may have applied; do not retry blindly.';
  return new SlackError(`${message} ${hint}`, { code: 'ambiguous_result', clientMsgId });
}

function normalizeAuth(value) {
  if (typeof value === 'string') {
    return { accessToken: value, refreshToken: null, expiresAt: null, clientId: null };
  }
  return value;
}

export function createSlackClient(getAuth, options = {}) {
  const fetchFn = options.fetch ?? fetch;
  const wait = options.sleep ?? sleep;
  const maxAttempts = options.maxAttempts ?? 4;
  const requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
  const refresh = options.refresh ?? refreshCredentials;

  async function call(method, args = {}) {
    const external = executionSignal.getStore();
    const idempotent = isIdempotent(method);
    const pause = async (ms) => {
      try {
        await abortableWait(wait, ms, external);
      } catch {
        throw new SlackError('Execution was cancelled.', { code: 'cancelled' });
      }
    };
    let auth = normalizeAuth(getAuth());
    if (!auth?.accessToken) {
      throw new SlackError('SLACK_USER_TOKEN is not configured. Run `npm run auth`.', {
        code: 'not_configured',
      });
    }
    if (credentialsNeedRefresh(auth)) {
      try {
        auth = await refresh(auth, external ? { signal: external } : undefined);
      } catch (error) {
        if (external?.aborted) {
          throw new SlackError('Execution was cancelled.', { code: 'cancelled' });
        }
        throw new SlackError(`Slack token refresh failed: ${error.message}`, {
          code: 'not_configured',
        });
      }
    }
    let refreshed = false;

    const requestArgs =
      method === 'chat.postMessage' && args?.client_msg_id === undefined
        ? { ...(args ?? {}), client_msg_id: randomUUID() }
        : args;

    let request = buildRequest(method, requestArgs);
    let attempt = 0;

    while (attempt < maxAttempts) {
      if (external?.aborted) {
        throw new SlackError('Execution was cancelled.', { code: 'cancelled' });
      }
      let response;
      try {
        response = await fetchFn(`https://slack.com/api/${method}`, {
          method: 'POST',
          headers: {
            'content-type': request.contentType,
            authorization: `Bearer ${auth.accessToken}`,
          },
          body: request.body,
          redirect: 'error',
          signal: requestSignal(requestTimeoutMs),
        });
      } catch (error) {
        if (external?.aborted) {
          throw new SlackError('Execution was cancelled.', { code: 'cancelled' });
        }
        if (!idempotent) {
          throw ambiguous(`Slack request failed: ${error?.message ?? error}`, requestArgs);
        }
        if (attempt < maxAttempts - 1) {
          await pause(250 * 2 ** attempt + Math.random() * 150);
          attempt += 1;
          continue;
        }
        throw new SlackError(`Slack request failed: ${error?.message ?? error}`);
      }

      if (response.status === 429) {
        const retryAfter = Number(response.headers.get('retry-after')) || 1;
        if (attempt < maxAttempts - 1) {
          await pause(Math.min(retryAfter * 1000, 20_000));
          attempt += 1;
          continue;
        }
        throw new SlackError(`Slack rate limit hit; retry after ${retryAfter}s.`, {
          code: 'ratelimited',
          retryAfter,
        });
      }

      if (response.status >= 500) {
        if (!idempotent) {
          throw ambiguous(`Slack returned HTTP ${response.status}.`, requestArgs);
        }
        if (attempt < maxAttempts - 1) {
          await pause(250 * 2 ** attempt + Math.random() * 150);
          attempt += 1;
          continue;
        }
        throw new SlackError(`Slack returned HTTP ${response.status} after retries.`);
      }

      let data;
      try {
        data = await response.json();
      } catch {
        if (idempotent && attempt < maxAttempts - 1) {
          await pause(250 * 2 ** attempt);
          attempt += 1;
          continue;
        }
        if (idempotent) {
          throw new SlackError(`Slack returned HTTP ${response.status} with a non-JSON body.`);
        }
        throw ambiguous(
          `Slack returned HTTP ${response.status} with a non-JSON body.`,
          requestArgs,
        );
      }

      if (!data.ok) {
        if (data.error === 'token_expired' || data.error === 'invalid_auth') {
          if (!refreshed && auth.refreshToken) {
            try {
              auth = await refresh(auth, external ? { signal: external } : undefined);
              refreshed = true;
              attempt = 0;
              continue;
            } catch (error) {
              if (external?.aborted) {
                throw new SlackError('Execution was cancelled.', { code: 'cancelled' });
              }
              throw new SlackError(`Slack token expired and refresh failed: ${error.message}`, {
                code: 'token_expired',
              });
            }
          }
          throw new SlackError(
            'Slack token is invalid or expired. Run `npm run auth` to re-authorize.',
            { code: data.error },
          );
        }
        if (
          request.encoding === 'json' &&
          ['invalid_arguments', 'missing_charset'].includes(data.error)
        ) {
          request = { ...buildRequest(method, requestArgs), encoding: 'form' };
          request.contentType = 'application/x-www-form-urlencoded';
          request.body = new URLSearchParams(requestArgs ?? {}).toString();
          attempt += 1;
          continue;
        }
        throw new SlackError(`Slack API error: ${data.error ?? `HTTP ${response.status}`}`, {
          code: data.error,
          needed: data.needed,
          provided: data.provided,
        });
      }

      return data;
    }

    throw new SlackError('Slack request failed after retries.');
  }

  return { call };
}
