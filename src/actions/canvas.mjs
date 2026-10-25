import { ActionError } from '../errors.mjs';
import {
  CANVAS_ID,
  CHANNEL_ID,
  idList,
  optionalId,
  optionalText,
  pageLimit,
  requiredId,
  requiredText,
  USER_ID,
} from './input.mjs';

const MAX_MARKDOWN = 60_000;
const MAX_SHARE_THREADS = 10;
const CANVAS_OPERATIONS = new Set([
  'insert_after',
  'insert_before',
  'insert_at_start',
  'insert_at_end',
  'replace',
  'delete',
]);
const SECTION_OPERATIONS = new Set(['insert_after', 'insert_before']);
const SECTION_TYPES = ['any_header', 'h1', 'h2', 'h3'];

function validateContent(value, where) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ActionError('invalid_input', `\`${where}.document_content\` is required.`);
  }
  if (value.type !== 'markdown') {
    throw new ActionError(
      'invalid_input',
      `\`${where}.document_content.type\` must be "markdown".`,
    );
  }
  if (typeof value.markdown !== 'string' || !value.markdown.trim()) {
    throw new ActionError('invalid_input', `\`${where}.document_content.markdown\` is required.`);
  }
  if (value.markdown.length > MAX_MARKDOWN) {
    throw new ActionError(
      'invalid_input',
      `\`${where}.document_content.markdown\` is longer than ${MAX_MARKDOWN} characters.`,
    );
  }
  return value;
}

export function validateChanges(changes) {
  if (!Array.isArray(changes) || changes.length === 0) {
    throw new ActionError('invalid_input', '`changes` must be a non-empty array.');
  }
  if (changes.length > 100) {
    throw new ActionError('invalid_input', '`changes` must contain at most 100 operations.');
  }
  changes.forEach((change, index) => {
    const where = `changes[${index}]`;
    if (!change || typeof change !== 'object' || Array.isArray(change)) {
      throw new ActionError('invalid_input', `\`${where}\` must be an object.`);
    }
    if (!CANVAS_OPERATIONS.has(change.operation)) {
      throw new ActionError(
        'invalid_input',
        `\`${where}.operation\` must be one of ${[...CANVAS_OPERATIONS].join(', ')}.`,
      );
    }
    if (change.operation === 'delete') {
      if (!change.section_id) {
        throw new ActionError('invalid_input', `\`${where}.section_id\` is required for delete.`);
      }
      return;
    }
    validateContent(change.document_content, where);
    if (SECTION_OPERATIONS.has(change.operation) && !change.section_id) {
      throw new ActionError(
        'invalid_input',
        `\`${where}.section_id\` is required for ${change.operation}.`,
      );
    }
  });
  return changes;
}

export function sectionCriteria(input) {
  let sectionTypes;
  if (input.section_types !== undefined && input.section_types !== null) {
    if (
      !Array.isArray(input.section_types) ||
      input.section_types.length < 1 ||
      input.section_types.length > 3
    ) {
      throw new ActionError('invalid_input', '`section_types` must contain 1 to 3 values.');
    }
    for (const type of input.section_types) {
      if (!SECTION_TYPES.includes(type)) {
        throw new ActionError(
          'invalid_input',
          `\`section_types\` must use ${SECTION_TYPES.join(', ')}.`,
        );
      }
    }
    sectionTypes = input.section_types;
  }
  const text = optionalText(input.text, 'text', { max: 4000 });
  if (!sectionTypes && !text) {
    throw new ActionError('invalid_input', 'Provide `text` or `section_types`.');
  }
  return {
    ...(sectionTypes ? { section_types: sectionTypes } : {}),
    ...(text ? { contains_text: text } : {}),
  };
}

export function shareThreads(file) {
  const threads = [];
  const seen = new Set();
  for (const group of ['public', 'private']) {
    const channels = file?.shares?.[group];
    if (!channels || typeof channels !== 'object') continue;
    for (const [channel, entries] of Object.entries(channels)) {
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        if (typeof entry?.ts !== 'string') continue;
        const key = `${channel}:${entry.ts}`;
        if (seen.has(key)) continue;
        seen.add(key);
        threads.push({
          channel,
          ts: typeof entry.thread_ts === 'string' ? entry.thread_ts : entry.ts,
          after: entry.ts,
          reply_count: Number.isFinite(Number(entry.reply_count))
            ? Number(entry.reply_count)
            : null,
        });
      }
    }
  }
  return threads;
}

export function createCanvasActions({ slack, users }) {
  async function create(input) {
    const title = requiredText(input.title, 'title', { max: 200 });
    const markdown = requiredText(input.markdown, 'markdown', { max: MAX_MARKDOWN });
    const channelId = optionalId(input.channel_id, 'channel_id', CHANNEL_ID);
    const response = await slack.call('canvases.create', {
      title,
      document_content: { type: 'markdown', markdown },
      ...(channelId ? { channel_id: channelId } : {}),
    });
    return { ok: true, canvas_id: response.canvas_id, channel_id: channelId ?? null };
  }

  async function append(input) {
    const canvasId = requiredId(input.canvas_id, 'canvas_id', CANVAS_ID);
    const markdown = requiredText(input.markdown, 'markdown', { max: MAX_MARKDOWN });
    const response = await slack.call('canvases.edit', {
      canvas_id: canvasId,
      changes: [{ operation: 'insert_at_end', document_content: { type: 'markdown', markdown } }],
    });
    return { ok: true, canvas_id: canvasId, result: response };
  }

  async function edit(input) {
    const canvasId = requiredId(input.canvas_id, 'canvas_id', CANVAS_ID);
    const changes = validateChanges(input.changes);
    const response = await slack.call('canvases.edit', {
      canvas_id: canvasId,
      changes,
    });
    return { ok: true, canvas_id: canvasId, result: response };
  }

  async function read(input) {
    const canvasId = requiredId(input.canvas_id, 'canvas_id', CANVAS_ID);
    const contentType = optionalText(input.content_type, 'content_type', { max: 16 });
    if (contentType && !['markdown', 'html'].includes(contentType)) {
      throw new ActionError('invalid_input', '`content_type` must be "markdown" or "html".');
    }
    const response = await slack.call('canvases.getContent', {
      canvas_id: canvasId,
      ...(contentType ? { content_type: contentType } : {}),
    });
    return {
      ok: true,
      canvas_id: canvasId,
      content_type: contentType ?? 'markdown',
      content: response.content ?? '',
    };
  }

  async function share(input) {
    const canvasId = requiredId(input.canvas_id, 'canvas_id', CANVAS_ID);
    const accessLevel = input.access_level ?? 'read';
    if (!['read', 'write'].includes(accessLevel)) {
      throw new ActionError('invalid_input', '`access_level` must be "read" or "write".');
    }
    const channelIds = idList(input.channel_ids, 'channel_ids', CHANNEL_ID);
    const userIds = idList(input.user_ids, 'user_ids', USER_ID);
    if (channelIds.length === 0 && userIds.length === 0) {
      throw new ActionError('invalid_input', 'Provide `channel_ids` or `user_ids`.');
    }
    const response = await slack.call('canvases.access.set', {
      canvas_id: canvasId,
      access_level: accessLevel,
      ...(channelIds.length ? { channel_ids: channelIds } : {}),
      ...(userIds.length ? { user_ids: userIds } : {}),
    });
    return {
      ok: true,
      canvas_id: canvasId,
      access_level: accessLevel,
      channel_ids: channelIds,
      user_ids: userIds,
      result: response,
    };
  }

  async function comments(input) {
    const canvasId = requiredId(input.canvas_id, 'canvas_id', CANVAS_ID);
    const limit = pageLimit(input.limit, { fallback: 100, max: 200 });

    let info;
    try {
      info = await slack.call('files.info', { file: canvasId });
    } catch (error) {
      if (error.code === 'canvas_not_found' || error.code === 'file_not_found') {
        throw new ActionError('not_found', `No canvas found for "${canvasId}".`);
      }
      throw error;
    }

    const shares = shareThreads(info.file);
    const knownChannels = [
      ...new Set([
        ...shares.map((thread) => thread.channel),
        ...(info.file?.channels ?? []),
        ...(info.file?.groups ?? []),
      ]),
    ];
    const threads = shares.filter((thread) => thread.reply_count !== 0);
    if (threads.length === 0) {
      return {
        ok: true,
        canvas_id: canvasId,
        channels: knownChannels,
        count: 0,
        has_more: false,
        comments: [],
        note: shares.length
          ? 'This canvas is shared but its share thread has no comments.'
          : knownChannels.length
            ? 'Slack did not report a share thread for this canvas, so its comments cannot be read.'
            : 'This canvas is not shared in a channel, so it has no comment thread.',
      };
    }

    const collected = [];
    const skipped = [];
    let hasMore = false;
    for (const thread of threads.slice(0, MAX_SHARE_THREADS)) {
      try {
        const response = await slack.call('conversations.replies', {
          channel: thread.channel,
          ts: thread.ts,
          limit,
        });
        for (const message of response.messages ?? []) {
          if (Number(message.ts) <= Number(thread.after)) continue;
          collected.push({ ...message, channel: thread.channel });
        }
        if (response.has_more) hasMore = true;
      } catch (error) {
        skipped.push({ channel: thread.channel, code: error.code ?? 'internal_error' });
      }
    }

    if (collected.length === 0 && skipped.length > 0) {
      throw new ActionError(
        skipped[0].code,
        `Could not read the canvas comment thread in ${skipped.length} channel(s).`,
      );
    }

    if (collected.length === 0) {
      return {
        ok: true,
        canvas_id: canvasId,
        channels: knownChannels,
        count: 0,
        has_more: false,
        comments: [],
        note: 'The canvas share thread has no comments.',
      };
    }

    collected.sort((a, b) => Number(a.ts) - Number(b.ts));
    const names = await users.namesFor(collected);
    return {
      ok: true,
      canvas_id: canvasId,
      channels: knownChannels,
      count: collected.length,
      has_more: hasMore,
      comments: collected.map((message) => ({
        channel: message.channel,
        user: message.user ? (names.get(message.user) ?? message.user) : null,
        user_id: message.user ?? null,
        ts: message.ts,
        text: message.text ?? '',
      })),
      ...(skipped.length ? { skipped } : {}),
      ...(threads.length > MAX_SHARE_THREADS
        ? { note: `Read ${MAX_SHARE_THREADS} of ${threads.length} share threads.` }
        : {}),
    };
  }

  async function sections(input) {
    const canvasId = requiredId(input.canvas_id, 'canvas_id', CANVAS_ID);
    const response = await slack.call('canvases.sections.lookup', {
      canvas_id: canvasId,
      criteria: sectionCriteria(input),
    });
    return { ok: true, sections: response.sections ?? [] };
  }

  return { create, read, comments, append, edit, share, sections };
}
