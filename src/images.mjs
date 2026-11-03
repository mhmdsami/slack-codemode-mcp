const IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const FILE_ID = /^F[A-Z0-9]+$/;
const FILE_HOSTS = ['slack.com', 'slack-files.com'];

export function imageRefs(messages, maxImages = 4) {
  const seen = new Set();
  const refs = [];
  for (const message of messages ?? []) {
    for (const file of message.files ?? []) {
      const mimetype = typeof file?.mimetype === 'string' ? file.mimetype : '';
      if (!mimetype.startsWith('image/')) continue;
      if (typeof file.id !== 'string' || seen.has(file.id)) continue;
      seen.add(file.id);
      refs.push({
        id: file.id,
        name: file.name ?? file.title ?? null,
        mimetype,
      });
      if (refs.length >= maxImages) return refs;
    }
  }
  return refs;
}

export function isSlackFileUrl(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  return FILE_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
}

export function pickImageUrl(file) {
  for (const key of ['thumb_720', 'thumb_480', 'thumb_360', 'url_private']) {
    if (isSlackFileUrl(file?.[key])) return file[key];
  }
  return null;
}

export async function imageBlocks(
  refs,
  { slack, store = null, maxImages = 4, maxBytes = 2 * 1024 * 1024 } = {},
) {
  const blocks = [];
  const paths = [];
  const seen = new Set();
  let skipped = 0;

  for (const ref of Array.isArray(refs) ? refs : []) {
    if (blocks.length >= maxImages) break;
    const id = typeof ref?.id === 'string' ? ref.id : '';
    if (!FILE_ID.test(id) || seen.has(id)) continue;
    seen.add(id);

    try {
      const info = await slack.call('files.info', { file: id });
      const file = info.file ?? {};
      const mimetype = file.mimetype ?? ref.mimetype;
      if (!IMAGE_MIME.has(mimetype) || Number(file.size) > maxBytes) {
        skipped += 1;
        continue;
      }
      const url = pickImageUrl(file);
      if (!url) {
        skipped += 1;
        continue;
      }
      const bytes = await slack.download(url, maxBytes);
      if (!bytes || bytes.byteLength === 0) {
        skipped += 1;
        continue;
      }
      blocks.push({ type: 'image', data: bytes.toString('base64'), mimeType: mimetype });
      if (store) {
        try {
          const path = store.save(bytes, mimetype);
          if (path) paths.push(path);
        } catch {}
      }
    } catch {
      skipped += 1;
    }
  }

  return { blocks, paths, skipped };
}
