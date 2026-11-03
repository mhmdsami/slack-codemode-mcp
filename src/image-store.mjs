import { randomBytes } from 'node:crypto';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EXTENSIONS = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

export function createImageStore({ maxFiles = 40, maxBytes = 50 * 1024 * 1024 } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'slack-codemode-images-'));
  chmodSync(root, 0o700);

  const files = [];
  let total = 0;

  function save(bytes, mimetype) {
    if (bytes.length > maxBytes) return null;
    const path = join(
      root,
      `${Date.now()}-${randomBytes(6).toString('hex')}.${EXTENSIONS[mimetype] ?? 'bin'}`,
    );
    writeFileSync(path, bytes, { mode: 0o600 });
    files.push({ path, bytes: bytes.length });
    total += bytes.length;

    while (files.length > maxFiles || total > maxBytes) {
      const oldest = files.shift();
      total -= oldest.bytes;
      try {
        rmSync(oldest.path, { force: true });
      } catch {}
    }
    return path;
  }

  function close() {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {}
  }

  return { root, save, close };
}
