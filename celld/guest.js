const parseJson = JSON.parse;
const stringifyJson = JSON.stringify;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getOwnPropertyNames = Object.getOwnPropertyNames;
const getOwnPropertySymbols = Object.getOwnPropertySymbols;
const getPrototypeOf = Object.getPrototypeOf;
const isArray = Array.isArray;
const isFiniteNumber = Number.isFinite;
const objectPrototype = Object.prototype;
const arrayPrototype = Array.prototype;
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const objectToString = Object.prototype.toString;
const textEncoder = new TextEncoder();
const dateGetTime = Date.prototype.getTime;
const dateToISOString = Date.prototype.toISOString;
const MAX_LOG_ENTRY = 4 * 1024;
const MAX_LOG_TOTAL = 32 * 1024;
const MAX_RESULT = 512 * 1024;

function truncate(text, limit) {
  return text.length > limit ? `${text.slice(0, limit)}...[truncated]` : text;
}

function rejectResult() {
  throw new TypeError('Guest result is not a JSON value');
}

function serialize(value, stack) {
  if (value === null) return 'null';
  if (value === undefined) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number')
    return isFiniteNumber(value) ? stringifyJson(value) : rejectResult();
  if (typeof value === 'string') return stringifyJson(value);
  if (typeof value === 'function' || typeof value === 'symbol') return 'null';
  if (typeof value !== 'object') return rejectResult();
  if (value instanceof Date) {
    const time = dateGetTime.call(value);
    return isFiniteNumber(time) ? stringifyJson(dateToISOString.call(value)) : 'null';
  }
  if (value instanceof Map || value instanceof Set) {
    if (stack.indexOf(value) !== -1) return rejectResult();
    stack.push(value);
    const entries = value instanceof Map ? [...value.entries()] : [...value];
    const result = serialize(entries, stack);
    stack.pop();
    return result;
  }
  if (value instanceof Error) return stringifyJson(`${value.name}: ${value.message}`);
  if (stack.indexOf(value) !== -1) return rejectResult();
  const prototype = getPrototypeOf(value);
  if (getOwnPropertySymbols(value).length !== 0) return rejectResult();
  if (isArray(value) && prototype !== arrayPrototype) return rejectResult();
  stack.push(value);
  const parts = [];
  if (isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = getOwnPropertyDescriptor(value, index);
      if (!descriptor || !('value' in descriptor)) return rejectResult();
      parts.push(serialize(descriptor.value, stack));
    }
    stack.pop();
    return `[${parts.join(',')}]`;
  }
  if (prototype !== objectPrototype && prototype !== null) return rejectResult();
  const names = getOwnPropertyNames(value);
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index];
    const descriptor = getOwnPropertyDescriptor(value, name);
    if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
      return rejectResult();
    }
    parts.push(`${stringifyJson(name)}:${serialize(descriptor.value, stack)}`);
  }
  stack.pop();
  return `{${parts.join(',')}}`;
}

function format(value) {
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return value;
  if (typeof value === 'bigint') return `${value}n`;
  if (typeof value === 'function') return '[Function]';
  if (typeof value === 'symbol') return value.toString();
  try {
    if (value instanceof Date) {
      const time = dateGetTime.call(value);
      return isFiniteNumber(time) ? dateToISOString.call(value) : 'Invalid Date';
    }
    return serialize(value, []);
  } catch {
    return `<unserializable ${objectToString.call(value)}>`;
  }
}

function errorDetail(error) {
  const detail = {};
  if (typeof error === 'string') {
    detail.message = error.slice(0, 300);
  } else if (error && typeof error.message === 'string') {
    detail.message = error.message.slice(0, 300);
  } else {
    detail.message = 'Guest execution failed';
  }
  if (error && typeof error === 'object') {
    if (typeof error.code === 'string') detail.code = error.code.slice(0, 80);
    if (typeof error.needed === 'string') detail.needed = error.needed;
    if (typeof error.provided === 'string') detail.provided = error.provided;
    if (error.name === 'SyntaxError') detail.name = 'SyntaxError';
    if (typeof error.client_msg_id === 'string') {
      detail.client_msg_id = error.client_msg_id.slice(0, 80);
    }
    if (typeof error.retry_after === 'number') detail.retry_after = error.retry_after;
    if (isArray(error.matches)) detail.matches = error.matches.slice(0, 10);
  }
  return detail;
}

function makeSlack(host, signal) {
  const request = async (payload) => {
    let body;
    try {
      body = stringifyJson(payload);
    } catch {
      throw new TypeError('Slack arguments must be JSON-serializable');
    }
    const response = await host.fetch('http://bridge/call', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      signal,
    });
    const text = await response.text();
    let envelope;
    try {
      envelope = parseJson(text);
    } catch {
      throw new Error('Slack bridge returned an invalid response');
    }
    if (envelope?.ok !== true) {
      const detail = envelope?.error ?? {};
      const error = new Error(
        typeof detail.message === 'string' ? detail.message : 'Slack call failed',
      );
      if (typeof detail.code === 'string') error.code = detail.code;
      if (typeof detail.needed === 'string') error.needed = detail.needed;
      if (typeof detail.provided === 'string') error.provided = detail.provided;
      if (typeof detail.client_msg_id === 'string') error.client_msg_id = detail.client_msg_id;
      if (typeof detail.retry_after === 'number') error.retry_after = detail.retry_after;
      if (isArray(detail.matches)) error.matches = detail.matches;
      throw error;
    }
    return envelope.value;
  };

  const call = (method, args) =>
    request({ method: String(method), args: args === undefined ? {} : args });

  const act = (action, input) => request({ action, input: input === undefined ? {} : input });

  const path = (parts) =>
    new Proxy(() => {}, {
      get(_target, prop) {
        if (prop === 'then') return undefined;
        if (prop === Symbol.toStringTag || prop === 'toString' || prop === 'valueOf') {
          return () => 'slack.' + parts.join('.');
        }
        return path([...parts, String(prop)]);
      },
      apply(_target, _this, args) {
        if (parts.length === 0) {
          throw new Error(
            'Call a namespaced method, e.g. slack.chat.postMessage({...}), or api.call(method, args).',
          );
        }
        return call(parts.join('.'), args[0] ?? {});
      },
    });

  return {
    slack: path([]),
    api: { call },
    app: {
      whoami: () => act('whoami'),
      findUser: (query) => act('findUser', { query }),
      findChannel: (query) => act('findChannel', { query }),
      dm: (user, text, options = {}) => act('dm', { user, text, ...options }),
      post: (to, text, options = {}) => act('post', { to, text, ...options }),
      edit: (channel, ts, text, options = {}) => act('edit', { channel, ts, text, ...options }),
      search: (query, options = {}) => act('search', { query, ...options }),
      thread: (channel, ts, limit) => act('thread', { channel, ts, limit }),
      readLink: (url) => act('readLink', { url }),
      sendFile: (options) => act('sendFile', options),
      canvas: {
        create: (title, markdown, channel_id) =>
          act('canvasCreate', { title, markdown, channel_id }),
        read: (canvas_id, content_type) => act('canvasRead', { canvas_id, content_type }),
        comments: (canvas_id, limit) => act('canvasComments', { canvas_id, limit }),
        share: (canvas_id, options = {}) => act('canvasShare', { canvas_id, ...options }),
        append: (canvas_id, markdown) => act('canvasAppend', { canvas_id, markdown }),
        edit: (canvas_id, changes) => act('canvasEdit', { canvas_id, changes }),
        sections: (canvas_id, text, section_types) =>
          act('canvasSections', { canvas_id, text, section_types }),
      },
    },
  };
}

function responseEnvelope(envelope) {
  return new Response(stringifyJson(envelope), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export default {
  async fetch(request, env) {
    let code;
    try {
      const body = await request.json();
      code = body.code;
    } catch {
      return responseEnvelope({
        ok: false,
        error: { code: 'invalid_input', message: 'Execution request is invalid' },
        logs: [],
      });
    }
    if (typeof code !== 'string') {
      return responseEnvelope({
        ok: false,
        error: { code: 'invalid_input', message: 'Execution code must be a string' },
        logs: [],
      });
    }
    const logs = [];
    let logBytes = 0;
    const log = (...args) => {
      if (logBytes >= MAX_LOG_TOTAL) return;
      const line = truncate(args.map(format).join(' '), MAX_LOG_ENTRY);
      logBytes += textEncoder.encode(line).length;
      logs.push(line);
    };
    const consoleShim = { log, info: log, warn: log, error: log, debug: log };
    let fn;
    try {
      fn = new AsyncFunction('slack', 'api', 'app', 'console', code);
    } catch (error) {
      return responseEnvelope({
        ok: false,
        error: { code: 'invalid_code', name: 'SyntaxError', message: errorDetail(error).message },
        logs,
      });
    }
    const { slack, api, app } = makeSlack(env.SLACK, request.signal);
    let value;
    try {
      value = await fn(slack, api, app, consoleShim);
    } catch (error) {
      return responseEnvelope({ ok: false, error: errorDetail(error), logs });
    }
    return responseEnvelope({ ok: true, value: truncate(format(value), MAX_RESULT), logs });
  },
};
