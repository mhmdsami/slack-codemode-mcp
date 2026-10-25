import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LIMITS, PATHS } from '../config.mjs';
import { createBridge } from './bridge.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function readCapped(response, maxBytes) {
  if (!response.body) return { text: '', truncated: false };
  const chunks = [];
  let total = 0;
  let truncated = false;
  for await (const chunk of response.body) {
    const buffer = Buffer.from(chunk);
    if (total + buffer.length > maxBytes) {
      chunks.push(buffer.subarray(0, maxBytes - total));
      truncated = true;
      break;
    }
    chunks.push(buffer);
    total += buffer.length;
  }
  return { text: Buffer.concat(chunks).toString('utf8'), truncated };
}

async function reservePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForHealth(baseUrl, child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error('celld exited before becoming healthy');
    }
    try {
      const response = await fetch(`${baseUrl}/.well-known/celld/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok) return;
    } catch {}
    await sleep(250);
  }
  throw new Error('celld did not become healthy before the startup deadline');
}

function sanitize(text, secret) {
  const escapeCode = String.fromCharCode(27);
  const value = String(text).replace(new RegExp(`${escapeCode}\\[[0-9;]*m`, 'gu'), '');
  const redacted = secret ? value.split(secret).join('[redacted]') : value;
  return redacted.length > LIMITS.diagnosticsBytes
    ? redacted.slice(-LIMITS.diagnosticsBytes)
    : redacted;
}

function signalGroup(child, signal) {
  try {
    if (child.pid) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    try {
      child.kill(signal);
    } catch {}
  }
}

async function buildWorkerSource() {
  const [template, guest] = await Promise.all([
    readFile(PATHS.worker, 'utf8'),
    readFile(PATHS.guest, 'utf8'),
  ]);
  if (!template.includes('__SLACK_GUEST_SOURCE__')) {
    throw new Error('celld worker template is missing __SLACK_GUEST_SOURCE__');
  }
  return template.replace('__SLACK_GUEST_SOURCE__', JSON.stringify(guest));
}

function appConfig(secretHash) {
  return `${JSON.stringify(
    {
      name: 'slack-codemode-mcp-local',
      main: 'index.js',
      compatibility_date: '2026-01-01',
      no_bundle: true,
      worker_loaders: [{ binding: 'LOADER' }],
      vars: { SLACK_RUNTIME_SECRET_HASH: secretHash },
    },
    null,
    2,
  )}\n`;
}

function celldCommand() {
  return process.env.SLACK_CODEMODE_CELLD_BIN ?? 'celld';
}

function celldEnv(appDirectory) {
  return {
    PATH: process.env.PATH ?? '/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin',
    TMPDIR: join(appDirectory, 'tmp'),
    LANG: process.env.LANG ?? 'en_US.UTF-8',
    NO_COLOR: '1',
    CELLD_HANDLER_BUDGET_S: String(LIMITS.handlerBudgetSeconds),
    CELLD_V8_HEAP_LIMIT_MB: String(LIMITS.heapMb),
  };
}

export class CelldRuntime {
  #appDirectory;
  #secret;
  #port;
  #bridge;
  #child;
  #diagnostics = [];
  #closed = false;
  #exited = false;
  #bridgePort = 0;

  constructor({ appDirectory, secret, port, bridge, child }) {
    this.#appDirectory = appDirectory;
    this.#secret = secret;
    this.#port = port;
    this.#bridge = bridge;
    this.#child = child;

    this.#child.stdout.on('data', (data) => this.#record(data));
    this.#child.stderr.on('data', (data) => this.#record(data));
    this.#child.on('exit', () => {
      this.#exited = true;
    });
  }

  #record(data) {
    this.#diagnostics.push(data.toString());
    if (this.#diagnostics.length > 200) this.#diagnostics.shift();
  }

  static async start({ allowed, slack, actions, signal }) {
    if (signal?.aborted) throw new Error('celld startup was cancelled.');
    const checkAbort = () => {
      if (signal?.aborted) throw new Error('celld startup was cancelled.');
    };
    const appDirectory = await mkdtemp(join(tmpdir(), 'slack-codemode-mcp-celld-'));
    let bridge;
    let child;
    const onAbort = () => {
      if (child?.pid) signalGroup(child, 'SIGKILL');
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      await mkdir(join(appDirectory, 'tmp'), { recursive: true, mode: 0o700 });

      const secret = randomBytes(32).toString('base64url');
      const secretHash = createHash('sha256').update(secret).digest('hex');
      const [source, port] = await Promise.all([buildWorkerSource(), reservePort()]);
      checkAbort();

      await Promise.all([
        writeFile(join(appDirectory, 'index.js'), source, { mode: 0o600 }),
        writeFile(join(appDirectory, 'wrangler.jsonc'), appConfig(secretHash), { mode: 0o600 }),
      ]);
      checkAbort();

      bridge = createBridge({ allowed, slack, actions });
      const bridgePort = await bridge.start();
      checkAbort();

      child = spawn(
        celldCommand(),
        ['dev', appDirectory, '--no-watch', '--port', String(port), '--host', '127.0.0.1'],
        {
          cwd: appDirectory,
          env: celldEnv(appDirectory),
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: true,
        },
      );

      if (signal?.aborted) onAbort();
      const runtime = new CelldRuntime({ appDirectory, secret, port, bridge, child });
      runtime.#bridgePort = bridgePort;

      const spawnError = new Promise((_, reject) => {
        child.once('error', reject);
      });

      await Promise.race([
        spawnError,
        waitForHealth(`http://127.0.0.1:${port}`, child, LIMITS.startupMs),
      ]);

      return runtime;
    } catch (error) {
      if (child) {
        signalGroup(child, 'SIGTERM');
        await sleep(250);
        signalGroup(child, 'SIGKILL');
      }
      await bridge?.close().catch(() => {});
      await rm(appDirectory, { recursive: true, force: true }).catch(() => {});
      if (error?.code === 'ENOENT') {
        throw new Error(
          `celld was not found. Install celld v0.6.2 and put it on PATH, or set SLACK_CODEMODE_CELLD_BIN.\n(${errorMessage(error)})`,
        );
      }
      throw new Error(`celld did not start: ${errorMessage(error)}`);
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }

  get alive() {
    return (
      !this.#closed &&
      !this.#exited &&
      this.#child.exitCode === null &&
      this.#child.signalCode === null
    );
  }

  diagnostics() {
    return sanitize(this.#diagnostics.join(''), this.#secret);
  }

  async execute(code, timeoutMs) {
    if (!this.alive) throw new Error('The celld runtime is not running.');

    const executionId = randomBytes(16).toString('base64url');
    const bridgeToken = randomBytes(32).toString('base64url');
    this.#bridge.addExecution(executionId, bridgeToken);

    try {
      const response = await fetch(`http://127.0.0.1:${this.#port}/execute`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-slack-runtime-secret': this.#secret,
        },
        body: JSON.stringify({
          code,
          executionId,
          bridgeUrl: `http://127.0.0.1:${this.#bridgePort}/call`,
          bridgeToken,
          executionMs: timeoutMs,
          hostCalls: LIMITS.hostCalls,
        }),
        signal: AbortSignal.timeout(timeoutMs + 10_000),
      });

      if (response.status === 504) {
        await response.body?.cancel().catch(() => {});
        throw new Error('Guest execution exceeded its budget.');
      }

      const { text, truncated } = await readCapped(response, LIMITS.maxResponseBytes);
      if (truncated) throw new Error('celld returned a response larger than the limit.');
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new Error(
          `celld returned HTTP ${response.status}: ${text.trim().slice(0, 300) || 'empty body'}`,
        );
      }

      if (!payload || typeof payload !== 'object') {
        throw new Error('celld returned an invalid response.');
      }
      return payload;
    } finally {
      this.#bridge.removeExecution(executionId);
    }
  }

  async close() {
    if (this.#closed) return;
    this.#closed = true;
    signalGroup(this.#child, 'SIGTERM');
    await sleep(LIMITS.shutdownMs);
    if (this.#child.exitCode === null && this.#child.signalCode === null) {
      signalGroup(this.#child, 'SIGKILL');
    }
    await this.#bridge.close().catch(() => {});
    await rm(this.#appDirectory, { recursive: true, force: true }).catch(() => {});
  }

  closeSync() {
    this.#closed = true;
    if (this.#child.exitCode === null && this.#child.signalCode === null) {
      try {
        signalGroup(this.#child, 'SIGKILL');
      } catch {}
    }
    try {
      rmSync(this.#appDirectory, { recursive: true, force: true });
    } catch {}
  }
}
