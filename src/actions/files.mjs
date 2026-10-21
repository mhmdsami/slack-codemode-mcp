import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { ActionError } from '../errors.mjs';
import { requestSignal } from '../slack/client.mjs';

function isInside(root, target) {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function assertNotSystemPath(target) {
  for (const blocked of [
    '/proc',
    '/sys',
    '/dev',
    '/etc',
    '/private/etc',
    '/System',
    '/bin',
    '/sbin',
    '/usr',
    '/Library',
  ]) {
    if (target === blocked || target.startsWith(`${blocked}/`)) {
      throw new ActionError('invalid_input', 'Refusing to upload system files.');
    }
  }
}

async function canonical(target) {
  return realpath(target).catch(() => resolve(target));
}

export async function resolveUploadPath(inputPath, limits) {
  if ((limits.uploadRoots ?? []).length === 0) {
    throw new ActionError(
      'invalid_input',
      'Path uploads are disabled. Set SLACK_CODEMODE_UPLOAD_ROOTS to allow a directory.',
    );
  }

  const absolute = resolve(inputPath);
  assertNotSystemPath(absolute);
  let real;
  try {
    real = await realpath(absolute);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
      throw new ActionError('invalid_input', 'File not found.');
    }
    throw error;
  }
  assertNotSystemPath(real);

  const roots = await Promise.all((limits.uploadRoots ?? []).map(canonical));
  if (!roots.some((root) => isInside(root, real))) {
    throw new ActionError(
      'invalid_input',
      'File is outside the allowed upload roots. Set SLACK_CODEMODE_UPLOAD_ROOTS to allow it.',
    );
  }

  const denied = [limits.configDir, limits.configDir && join(limits.configDir, 'token')]
    .concat(limits.sensitiveDirs ?? [])
    .filter(Boolean);
  for (const entry of denied) {
    const lexical = resolve(entry);
    const canonicalEntry = await canonical(entry);
    if (
      isInside(lexical, absolute) ||
      isInside(canonicalEntry, real) ||
      isInside(canonicalEntry, absolute)
    ) {
      throw new ActionError('invalid_input', 'Refusing to upload a credential or secret path.');
    }
  }
  return real;
}

export function createFileActions({ slack, messages, limits }) {
  async function send(input) {
    const channel = await messages.channelForTarget(
      await messages.resolveTarget(input.to ?? input.channel),
    );

    let bytes;
    let filename;
    if (input.path) {
      const real = await resolveUploadPath(input.path, limits);
      let handle;
      try {
        handle = await open(real, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      } catch {
        throw new ActionError('invalid_input', 'Could not read the file.');
      }
      try {
        const info = await handle.stat();
        if (!info.isFile()) throw new ActionError('invalid_input', '`path` is not a file.');
        if (info.size > limits.maxUploadBytes) {
          throw new ActionError('invalid_input', 'File exceeds the upload size limit.');
        }
        bytes = await handle.readFile();
        if (bytes.byteLength > limits.maxUploadBytes) {
          throw new ActionError('invalid_input', 'File exceeds the upload size limit.');
        }
      } finally {
        await handle.close();
      }
      filename = input.filename || basename(real);
    } else if (typeof input.content === 'string') {
      bytes = Buffer.from(input.content, 'utf8');
      filename = input.filename || 'message.txt';
    } else {
      throw new ActionError('invalid_input', 'Provide `path` or `content`.');
    }

    const upload = await slack.call('files.getUploadURLExternal', {
      filename,
      length: bytes.byteLength,
      ...(input.alt_txt ? { alt_txt: input.alt_txt } : {}),
    });

    const uploaded = await fetch(upload.upload_url, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: bytes,
      redirect: 'error',
      signal: requestSignal(60_000),
    });
    if (!uploaded.ok) {
      throw new ActionError('internal_error', `File upload failed with HTTP ${uploaded.status}.`);
    }

    const completed = await slack.call('files.completeUploadExternal', {
      files: [{ id: upload.file_id, title: filename }],
      channel_id: channel.id,
      ...(input.comment ? { initial_comment: String(input.comment) } : {}),
    });

    return {
      ok: true,
      file_id: upload.file_id,
      filename,
      channel: channel.id,
      channel_name: channel.name,
      file: completed.files?.[0] ?? null,
    };
  }

  return { send };
}
