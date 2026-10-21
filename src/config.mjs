import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

export const PATHS = {
  index: join(ROOT, 'api-index.json'),
  allowlist: join(ROOT, 'allowlist.json'),
  worker: join(ROOT, 'celld', 'worker.js'),
  guest: join(ROOT, 'celld', 'guest.js'),
};

const uploadRoots = process.env.SLACK_CODEMODE_UPLOAD_ROOTS
  ? process.env.SLACK_CODEMODE_UPLOAD_ROOTS.split(':')
      .map((value) => value.trim())
      .filter(Boolean)
  : [];

export const LIMITS = {
  startupMs: 20_000,
  shutdownMs: 2_000,
  handlerBudgetSeconds: 130,
  heapMb: 64,
  bridgeBodyBytes: 64 * 1024,
  executionBodyBytes: 128 * 1024,
  defaultExecutionMs: 30_000,
  maxExecutionMs: 120_000,
  hostCalls: 64,
  maxUploadBytes: 20 * 1024 * 1024,
  cacheTtlMs: 10 * 60 * 1000,
  diagnosticsBytes: 8 * 1024,
  maxResultBytes: 512 * 1024,
  maxResponseBytes: 2 * 1024 * 1024,
  uploadRoots,
  configDir: join(homedir(), '.config', 'slack-codemode'),
  sensitiveDirs: [
    join(homedir(), '.ssh'),
    join(homedir(), '.aws'),
    join(homedir(), '.gnupg'),
    join(homedir(), '.kube'),
    join(homedir(), '.docker'),
    join(homedir(), 'Library', 'Keychains'),
  ],
};

export function readIndex() {
  return JSON.parse(readFileSync(PATHS.index, 'utf8'));
}

export function readAllowlist() {
  const parsed = JSON.parse(readFileSync(PATHS.allowlist, 'utf8'));
  return new Set(parsed.methods);
}
