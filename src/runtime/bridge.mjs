import { timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { LIMITS } from '../config.mjs';
import { executionSignal } from '../slack/client.mjs';

async function readBody(request, maxBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBytes) {
      request.destroy();
      throw new Error('body too large');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function errorPayload(error) {
  if (error?.name === 'AbortError' || error?.code === 'cancelled') {
    return { code: 'cancelled', message: 'Execution was cancelled.' };
  }
  return {
    code: error.code ?? 'internal_error',
    message: error.message ?? String(error),
    needed: error.needed,
    provided: error.provided,
    retry_after: error.retryAfter,
    ...(error.clientMsgId ? { client_msg_id: error.clientMsgId } : {}),
    ...(error.matches ? { matches: error.matches } : {}),
  };
}

export function createBridge({ allowed, slack, actions }) {
  const executions = new Map();

  const server = createServer(async (request, response) => {
    const send = (status, value) => {
      const body = JSON.stringify(value);
      response.writeHead(status, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        'content-length': Buffer.byteLength(body),
      });
      response.end(body);
    };

    if (request.method !== 'POST' || request.url !== '/call') {
      send(404, { ok: false, error: { code: 'not_found', message: 'Bridge route not found' } });
      return;
    }

    const controller = new AbortController();
    request.on('aborted', () => controller.abort());
    response.on('close', () => {
      if (!response.writableEnded) controller.abort();
    });

    const executionId = request.headers['x-slack-execution-id'];
    const bridgeToken = request.headers['x-slack-bridge-token'];
    const expected = typeof executionId === 'string' ? executions.get(executionId) : null;
    const authorized =
      typeof expected === 'string' &&
      typeof bridgeToken === 'string' &&
      expected.length === bridgeToken.length &&
      timingSafeEqual(Buffer.from(expected), Buffer.from(bridgeToken));
    if (!authorized) {
      send(401, { ok: false, error: { code: 'unauthorized', message: 'Unknown execution' } });
      return;
    }

    let body;
    try {
      body = JSON.parse(await readBody(request, LIMITS.bridgeBodyBytes));
    } catch {
      send(400, { ok: false, error: { code: 'invalid_input', message: 'Invalid bridge body' } });
      return;
    }

    if (!body || typeof body !== 'object' || body.executionId !== executionId) {
      send(400, { ok: false, error: { code: 'invalid_input', message: 'Invalid bridge request' } });
      return;
    }

    const isMethod =
      typeof body.method === 'string' &&
      body.method.length > 0 &&
      body.method.length <= 128 &&
      typeof body.args === 'object' &&
      body.args !== null &&
      !Array.isArray(body.args);

    const isAction =
      typeof body.action === 'string' &&
      body.action.length > 0 &&
      body.action.length <= 64 &&
      (body.input === undefined ||
        (typeof body.input === 'object' && body.input !== null && !Array.isArray(body.input)));

    if (!isMethod && !isAction) {
      send(400, { ok: false, error: { code: 'invalid_input', message: 'Unknown bridge request' } });
      return;
    }

    if (isMethod && !allowed.has(body.method)) {
      send(200, {
        ok: false,
        error: { code: 'not_allowed', message: `"${body.method}" is not allowed by this server.` },
      });
      return;
    }

    try {
      const run = () =>
        isAction ? actions.run(body.action, body.input ?? {}) : slack.call(body.method, body.args);
      const value = await executionSignal.run(controller.signal, run);
      send(200, { ok: true, value });
    } catch (error) {
      send(200, { ok: false, error: errorPayload(error) });
    }
  });

  return {
    async start() {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      return server.address().port;
    },
    addExecution(executionId, token) {
      executions.set(executionId, token);
    },
    removeExecution(executionId) {
      executions.delete(executionId);
    },
    async close() {
      executions.clear();
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
