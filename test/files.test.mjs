import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createFileActions, resolveUploadPath } from '../src/actions/files.mjs';

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
