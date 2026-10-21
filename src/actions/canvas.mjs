import { ActionError } from '../errors.mjs';

export function createCanvasActions({ slack, users }) {
  async function create(input) {
    const response = await slack.call('canvases.create', {
      title: String(input.title ?? ''),
      document_content: { type: 'markdown', markdown: String(input.markdown ?? '') },
    });
    return { ok: true, canvas_id: response.canvas_id };
  }

  async function append(input) {
    const response = await slack.call('canvases.edit', {
      canvas_id: String(input.canvas_id ?? ''),
      changes: [
        {
          operation: 'insert_at_end',
          document_content: { type: 'markdown', markdown: String(input.markdown ?? '') },
        },
      ],
    });
    return { ok: true, canvas_id: input.canvas_id, result: response };
  }

  async function edit(input) {
    if (!Array.isArray(input.changes) || input.changes.length === 0) {
      throw new ActionError('invalid_input', '`changes` must be a non-empty array.');
    }
    const response = await slack.call('canvases.edit', {
      canvas_id: String(input.canvas_id ?? ''),
      changes: input.changes,
    });
    return { ok: true, canvas_id: input.canvas_id, result: response };
  }

  async function read(input) {
    const response = await slack.call('canvases.getContent', {
      canvas_id: String(input.canvas_id ?? ''),
      ...(input.content_type ? { content_type: String(input.content_type) } : {}),
    });
    return {
      ok: true,
      canvas_id: input.canvas_id,
      content_type: input.content_type ?? 'markdown',
      content: response.content ?? '',
    };
  }

  async function comments(input) {
    const canvasId = String(input.canvas_id ?? '');
    const info = await slack.call('files.info', { file: canvasId });
    const channels = [...(info.file?.channels ?? []), ...(info.file?.groups ?? [])];
    if (channels.length === 0) {
      return {
        ok: true,
        canvas_id: canvasId,
        channel: null,
        count: 0,
        comments: [],
        note: 'This canvas is not attached to a channel, so it has no readable comments.',
      };
    }

    const channel = channels[0];
    const limit = Math.min(Number(input.limit) || 100, 200);
    const history = await slack.call('conversations.history', { channel, limit });
    const seen = new Map();

    for (const message of history.messages ?? []) {
      seen.set(message.ts, message);
      if (message.reply_count > 0) {
        const replies = await slack.call('conversations.replies', {
          channel,
          ts: message.ts,
          limit: 50,
        });
        for (const reply of replies.messages ?? []) seen.set(reply.ts, reply);
      }
    }

    const messages = [...seen.values()].sort((a, b) => Number(a.ts) - Number(b.ts));
    const names = await users.namesFor(messages);
    return {
      ok: true,
      canvas_id: canvasId,
      channel,
      count: messages.length,
      comments: messages.map((message) => ({
        user: message.user ? (names.get(message.user) ?? message.user) : null,
        user_id: message.user ?? null,
        ts: message.ts,
        text: message.text ?? '',
      })),
    };
  }

  async function sections(input) {
    const response = await slack.call('canvases.sections.lookup', {
      canvas_id: String(input.canvas_id ?? ''),
      criteria: {
        section_types: ['any_header'],
        ...(input.text ? { contains_text: String(input.text) } : {}),
      },
    });
    return { ok: true, sections: response.sections ?? [] };
  }

  return { create, read, comments, append, edit, sections };
}
