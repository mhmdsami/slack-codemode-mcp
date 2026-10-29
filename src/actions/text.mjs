const ENTITIES = {
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  '#x27': "'",
  amp: '&',
};

export function unescapeSlack(value) {
  return String(value ?? '').replace(
    /&(lt|gt|quot|#39|#x27|amp);/g,
    (_, entity) => ENTITIES[entity] ?? _,
  );
}

export function renderMessageText(value, names = new Map()) {
  return unescapeSlack(value)
    .replace(/<@([A-Z0-9]+)(?:\|([^>]+))?>/g, (_, id, label) => `@${label ?? names.get(id) ?? id}`)
    .replace(/<!(channel|here|everyone)(?:\|([^>]+))?>/g, (_, kind, label) => `@${label ?? kind}`)
    .replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, (_, url, label) => `${label} (${url})`)
    .replace(/<(https?:\/\/[^>]+)>/g, (_, url) => url)
    .replace(/<(mailto:[^|>]+)\|([^>]+)>/g, (_, mail, label) => `${label} (${mail})`);
}

function shortTime(ts) {
  const seconds = Number(String(ts ?? '').split('.')[0]);
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  return new Date(seconds * 1000).toISOString().slice(5, 16).replace('T', ' ');
}

function extras(message) {
  const parts = [];
  const files = message.files ?? [];
  if (files.length) {
    parts.push(`files: ${files.map((file) => file.name ?? file.title ?? file.id).join(', ')}`);
  }
  if (message.attachments?.length) parts.push(`${message.attachments.length} attachments`);
  const reactions = message.reactions ?? [];
  if (reactions.length) {
    parts.push(
      `reactions: ${reactions.map((reaction) => `${reaction.name} x${reaction.count}`).join(', ')}`,
    );
  }
  if (message.edited) parts.push('edited');
  if (message.reply_count) parts.push(`${message.reply_count} replies`);
  return parts.join('; ');
}

export function condensedTranscript(messages, names = new Map()) {
  return messages
    .map((message) => {
      const who = message.user
        ? (names.get(message.user) ?? `@${message.user}`)
        : (message.username ?? message.bot_id ?? 'unknown');
      const body = renderMessageText(message.text, names).replace(/\s+/g, ' ').trim();
      const notes = extras(message);
      const time = shortTime(message.ts);
      return `${time ? `${time} ` : ''}${who}: ${body || '(no text)'}${notes ? ` [${notes}]` : ''}`;
    })
    .join('\n');
}
