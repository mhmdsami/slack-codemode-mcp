import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { assertUploadUrl, createFileActions, resolveUploadPath } from '../src/actions/files.mjs';

const messages = {
  resolveTarget: async () => ({ dm: false, id: 'C1', name: 'C1' }),
  channelForTarget: async () => ({ id: 'C1', name: 'C1' }),
};

test('rejects all path uploads by default', async () => {
  await assert.rejects(
    () => resolveUploadPath('/etc/hosts', { uploadRoots: [] }),
    /Path uploads are disabled/,
  );
});

test('allows a regular file inside a configured root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'slack-upload-'));
  const file = join(root, 'report.txt');
  await writeFile(file, 'hello');

  const resolved = await resolveUploadPath(file, {
    uploadRoots: [root],
    sensitiveDirs: [],
  });
  assert.equal(resolved, await realpath(file));
});

test('rejects paths outside the upload roots', async () => {
  const root = await mkdtemp(join(tmpdir(), 'slack-upload-'));
  const outside = await mkdtemp(join(tmpdir(), 'slack-outside-'));
  const file = join(outside, 'notes.txt');
  await writeFile(file, 'secret');
  const files = createFileActions({
    slack: { call: async () => ({}) },
    messages,
    limits: { maxUploadBytes: 1024, uploadRoots: [root], sensitiveDirs: [] },
  });

  await assert.rejects(
    () => files.send({ to: '#x', path: file }),
    /outside the allowed upload roots/,
  );
});

test('rejects a symlink that escapes the upload root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'slack-upload-'));
  const outside = await mkdtemp(join(tmpdir(), 'slack-outside-'));
  const target = join(outside, 'notes.txt');
  await writeFile(target, 'secret');
  const link = join(root, 'notes.txt');
  await symlink(target, link);

  await assert.rejects(
    () => resolveUploadPath(link, { uploadRoots: [root], sensitiveDirs: [] }),
    /outside the allowed upload roots/,
  );
});

test('rejects the credential directory through a symlink', async () => {
  const base = await mkdtemp(join(tmpdir(), 'slack-upload-'));
  const realConfig = join(base, 'real-config');
  await mkdir(realConfig);
  const token = join(realConfig, 'token');
  await writeFile(token, '{"accessToken":"x"}');
  const configLink = join(base, 'config-link');
  await symlink(realConfig, configLink);

  await assert.rejects(
    () =>
      resolveUploadPath(token, {
        uploadRoots: ['/'],
        configDir: configLink,
        sensitiveDirs: [],
      }),
    /credential or secret path/,
  );
});

test('rejects system paths even under a wide root', async () => {
  const files = createFileActions({
    slack: { call: async () => ({}) },
    messages,
    limits: { maxUploadBytes: 1024, uploadRoots: ['/'], sensitiveDirs: [] },
  });

  await assert.rejects(() => files.send({ to: '#x', path: '/proc/self/environ' }), /system files/);
});

test('rejects a FIFO without blocking', { skip: process.platform === 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'slack-upload-'));
  const fifo = join(root, 'pipe');
  execFileSync('mkfifo', [fifo]);
  const files = createFileActions({
    slack: { call: async () => ({}) },
    messages,
    limits: { maxUploadBytes: 1024, uploadRoots: [root], sensitiveDirs: [] },
  });

  await assert.rejects(() => files.send({ to: '#x', path: fifo }), /not a file/);
});

test('accepts only https slack.com upload URLs', () => {
  assert.equal(
    assertUploadUrl('https://files.slack.com/upload/v1/abc').hostname,
    'files.slack.com',
  );
  assert.throws(() => assertUploadUrl('http://files.slack.com/upload'), /outside slack.com/);
  assert.throws(() => assertUploadUrl('https://files.slack.com.evil.test/upload'), /outside/);
  assert.throws(() => assertUploadUrl('not a url'), /invalid upload URL/);
});

test('refuses an upload URL outside slack.com before sending bytes', async () => {
  const files = createFileActions({
    slack: {
      call: async () => ({
        upload_url: 'https://evil.example/upload',
        file_id: 'F1',
      }),
    },
    messages,
    limits: { maxUploadBytes: 1024, uploadRoots: [], sensitiveDirs: [] },
  });

  await assert.rejects(() => files.send({ to: '#x', content: 'hello' }), /outside slack.com/);
});

test('posts a file into a thread', async () => {
  const calls = [];
  const slack = {
    call: async (method, args) => {
      calls.push({ method, args });
      if (method === 'files.getUploadURLExternal') {
        return { upload_url: 'https://files.slack.com/upload/v1/x', file_id: 'F1' };
      }
      if (method === 'files.completeUploadExternal') return { files: [{ id: 'F1' }] };
      throw new Error(`unexpected ${method}`);
    },
  };
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('', { status: 200 });

  try {
    const files = createFileActions({
      slack,
      messages,
      limits: { maxUploadBytes: 1024, uploadRoots: [], sensitiveDirs: [] },
    });
    await files.send({ to: '#x', content: 'hello', thread_ts: '1699999999.000000' });
  } finally {
    globalThis.fetch = original;
  }

  const complete = calls.find((call) => call.method === 'files.completeUploadExternal');
  assert.equal(complete.args.thread_ts, '1699999999.000000');
});

test('rejects a malformed thread timestamp on upload', async () => {
  const files = createFileActions({
    slack: { call: async () => assert.fail('Slack should not be called') },
    messages,
    limits: { maxUploadBytes: 1024, uploadRoots: [], sensitiveDirs: [] },
  });

  await assert.rejects(
    () => files.send({ to: '#x', content: 'hello', thread_ts: 'yesterday' }),
    /not a Slack timestamp/,
  );
});
