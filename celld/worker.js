import { WorkerEntrypoint } from 'cloudflare:workers';

const GUEST_SOURCE = __SLACK_GUEST_SOURCE__;
const MAX_EXECUTION_BODY_BYTES = 128 * 1024;
const MAX_BRIDGE_BODY_BYTES = 64 * 1024;
const EXECUTION_ID = /^[A-Za-z0-9_-]{16,128}$/;
const BRIDGE_TOKEN = /^[A-Za-z0-9_-]{32,128}$/;

function jsonResponse(status, value) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

async function readBody(request, maxBytes) {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (total + value.byteLength > maxBytes) {
        await reader.cancel();
        throw new Error('request body is too large');
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length) {
    return false;
  }
  let different = 0;
  for (let index = 0; index < left.length; index += 1) {
    different |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return different === 0;
}

async function runtimeSecretMatches(value, expectedHash) {
  if (typeof value !== 'string' || typeof expectedHash !== 'string') return false;
  if (!/^[a-f0-9]{64}$/i.test(expectedHash)) return false;
  return constantTimeEqual(await sha256Hex(value), expectedHash.toLowerCase());
}

function isExactObject(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
}

function isLoopbackBridgeUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const port = Number(url.port);
  return (
    url.protocol === 'http:' &&
    url.hostname === '127.0.0.1' &&
    Number.isInteger(port) &&
    port > 0 &&
    port <= 65535 &&
    url.pathname === '/call' &&
    url.search === '' &&
    url.hash === '' &&
    url.username === '' &&
    url.password === ''
  );
}

function executionError(error, deadlineAborted) {
  const message = error && typeof error.message === 'string' ? error.message : '';
  if (deadlineAborted || /CPU|heap|memory|terminat|exceed|aborted/iu.test(message)) {
    return {
      status: 504,
      body: {
        ok: false,
        error: { code: 'execution_limit', message: 'Guest execution exceeded its budget' },
        logs: [],
      },
    };
  }
  return {
    status: 500,
    body: {
      ok: false,
      error: { code: 'internal_error', message: 'Guest execution failed' },
      logs: [],
    },
  };
}

export class Bridge extends WorkerEntrypoint {
  async fetch(request) {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/call') {
      return jsonResponse(404, {
        ok: false,
        error: { code: 'not_found', message: 'Bridge route not found' },
      });
    }
    const contentType = request.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().startsWith('application/json')) {
      return jsonResponse(415, {
        ok: false,
        error: { code: 'invalid_request', message: 'Bridge request must be JSON' },
      });
    }
    let text;
    try {
      text = await readBody(request, MAX_BRIDGE_BODY_BYTES);
    } catch {
      return jsonResponse(413, {
        ok: false,
        error: { code: 'request_too_large', message: 'Bridge request is too large' },
      });
    }
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      return jsonResponse(400, {
        ok: false,
        error: { code: 'invalid_input', message: 'Bridge request is not valid JSON' },
      });
    }
    const isMethod =
      isExactObject(payload, ['method', 'args']) &&
      typeof payload.method === 'string' &&
      payload.method.length > 0 &&
      payload.method.length <= 128;
    const isAction =
      isExactObject(payload, ['action', 'input']) &&
      typeof payload.action === 'string' &&
      payload.action.length > 0 &&
      payload.action.length <= 64;
    if (!isMethod && !isAction) {
      return jsonResponse(400, {
        ok: false,
        error: { code: 'invalid_input', message: 'Bridge request shape is invalid' },
      });
    }
    const body = JSON.stringify({
      executionId: this.ctx.props.executionId,
      ...payload,
    });
    let response;
    try {
      response = await fetch(this.ctx.props.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-slack-bridge-token': this.ctx.props.token,
          'x-slack-execution-id': this.ctx.props.executionId,
        },
        body,
        signal: request.signal,
        redirect: 'manual',
      });
    } catch {
      return jsonResponse(502, {
        ok: false,
        error: { code: 'upstream_error', message: 'Host bridge is unavailable' },
      });
    }
    return new Response(response.body, {
      status: response.status,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  }
}
export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/execute') {
      return jsonResponse(404, {
        ok: false,
        error: { code: 'not_found', message: 'Execution route not found' },
        logs: [],
      });
    }
    if (request.headers.get('origin') !== null) {
      return jsonResponse(403, {
        ok: false,
        error: { code: 'forbidden', message: 'Browser-origin requests are not allowed' },
        logs: [],
      });
    }
    if (
      !(await runtimeSecretMatches(
        request.headers.get('x-slack-runtime-secret'),
        env.SLACK_RUNTIME_SECRET_HASH,
      ))
    ) {
      return jsonResponse(401, {
        ok: false,
        error: { code: 'unauthorized', message: 'Runtime request is not authorized' },
        logs: [],
      });
    }
    let text;
    try {
      text = await readBody(request, MAX_EXECUTION_BODY_BYTES);
    } catch {
      return jsonResponse(413, {
        ok: false,
        error: { code: 'request_too_large', message: 'Execution request is too large' },
        logs: [],
      });
    }
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return jsonResponse(400, {
        ok: false,
        error: { code: 'invalid_input', message: 'Execution request is not valid JSON' },
        logs: [],
      });
    }
    if (
      !isExactObject(body, [
        'code',
        'executionId',
        'bridgeUrl',
        'bridgeToken',
        'executionMs',
        'hostCalls',
      ]) ||
      typeof body.code !== 'string' ||
      new TextEncoder().encode(body.code).byteLength > MAX_EXECUTION_BODY_BYTES ||
      typeof body.executionId !== 'string' ||
      !EXECUTION_ID.test(body.executionId) ||
      !isLoopbackBridgeUrl(body.bridgeUrl) ||
      typeof body.bridgeToken !== 'string' ||
      !BRIDGE_TOKEN.test(body.bridgeToken) ||
      !Number.isInteger(body.executionMs) ||
      body.executionMs < 1 ||
      body.executionMs > 120_000 ||
      !Number.isInteger(body.hostCalls) ||
      body.hostCalls < 1 ||
      body.hostCalls > 256
    ) {
      return jsonResponse(400, {
        ok: false,
        error: { code: 'invalid_input', message: 'Execution request shape is invalid' },
        logs: [],
      });
    }
    const host = ctx.exports.Bridge({
      props: {
        url: body.bridgeUrl,
        token: body.bridgeToken,
        executionId: body.executionId,
      },
    });
    let loaded;
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    request.signal.addEventListener('abort', onAbort, { once: true });
    if (request.signal.aborted) controller.abort();
    const timer = setTimeout(() => controller.abort(), body.executionMs);
    try {
      loaded = env.LOADER.load({
        compatibilityDate: '2026-01-01',
        mainModule: 'guest.js',
        modules: { 'guest.js': GUEST_SOURCE },
        env: { SLACK: host },
        globalOutbound: null,
        limits: { cpuMs: body.executionMs, subRequests: body.hostCalls },
      });
      return await loaded.getEntrypoint().fetch('http://guest/execute', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: body.code }),
        signal: controller.signal,
      });
    } catch (error) {
      const failure = executionError(error, controller.signal.aborted);
      return jsonResponse(failure.status, failure.body);
    } finally {
      clearTimeout(timer);
      request.signal.removeEventListener('abort', onAbort);
      if (loaded) loaded.dispose();
    }
  },
};
