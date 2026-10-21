import { ActionError } from '../errors.mjs';

export function parsePermalink(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    throw new ActionError('invalid_input', 'Not a valid URL.');
  }
  const match = url.pathname.match(/\/archives\/([A-Z0-9]+)\/p(\d{10,})/i);
  if (!match) throw new ActionError('invalid_input', 'Not a Slack message permalink.');
  const digits = match[2];
  return {
    channel: match[1].toUpperCase(),
    ts: `${digits.slice(0, -6)}.${digits.slice(-6)}`,
    threadTs: url.searchParams.get('thread_ts') || null,
  };
}

export function createMessageActions({ slack, cache, users, channels }) {
  async function openDm(userIds) {
    const key = userIds.join(',');
    const cached = cache.dms.get(key);
    if (cached) return cached;
    const response = await slack.call('conversations.open', { users: key });
    const channel = response.channel?.id;
    if (!channel)
      throw new ActionError('internal_error', 'conversations.open returned no channel.');
    cache.dms.set(key, channel);
    return channel;
  }

  async function resolveTarget(to) {
    const raw = String(to ?? '').trim();
    if (!raw) throw new ActionError('invalid_input', 'A channel or user is required.');

    if (raw.startsWith('@') || /^U[A-Z0-9]{6,}$/i.test(raw)) {
      const ids = raw
        .replace(/^@/, '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      return { dm: true, users: ids };
    }

    if (/^[CDG][A-Z0-9]{6,}$/i.test(raw)) return { dm: false, id: raw, name: raw };

    const channel = (await channels.find(raw)).channel;
    if (!channel) throw new ActionError('ambiguous', `"${raw}" matched multiple channels.`);
    return { dm: false, id: channel.id, name: channel.name };
  }

  async function channelForTarget(target) {
    if (!target.dm) return { id: target.id, name: target.name };
    const ids = [];
    for (const user of target.users) ids.push((await users.resolve(user)).id);
    return { id: await openDm(ids), name: ids.join(',') };
  }

  async function dm(input) {
    const candidates = Array.isArray(input.user) ? input.user : String(input.user ?? '').split(',');
    const ids = [];
    for (const user of candidates.map((value) => String(value).trim()).filter(Boolean)) {
      ids.push((await users.resolve(user)).id);
    }
    if (ids.length === 0) throw new ActionError('invalid_input', '`user` is required.');

    const channel = await openDm(ids);
    const response = await slack.call('chat.postMessage', {
      channel,
      text: String(input.text ?? ''),
      ...(input.thread_ts ? { thread_ts: input.thread_ts } : {}),
      ...(input.client_msg_id ? { client_msg_id: String(input.client_msg_id) } : {}),
    });
    return { ok: true, users: ids, channel: response.channel, ts: response.ts };
  }

  async function post(input) {
    const to = String(input.to ?? input.channel ?? '').trim();
    const text = String(input.text ?? '');
    if (!to)
      throw new ActionError('invalid_input', '`to` is required (channel, #name, @user, or id).');
    if (!text) throw new ActionError('invalid_input', '`text` is required.');

    const channel = await channelForTarget(await resolveTarget(to));
    const response = await slack.call('chat.postMessage', {
      channel: channel.id,
      text,
      ...(input.thread_ts ? { thread_ts: input.thread_ts } : {}),
      ...(input.client_msg_id ? { client_msg_id: String(input.client_msg_id) } : {}),
    });
    return { ok: true, channel: response.channel, channel_name: channel.name, ts: response.ts };
  }

  async function thread(input) {
    const channel = String(input.channel ?? '').startsWith('#')
      ? (await channels.find(input.channel)).channel
      : { id: input.channel };
    if (!channel?.id) throw new ActionError('invalid_input', '`channel` is required.');
    if (!input.ts) throw new ActionError('invalid_input', '`ts` is required.');

    const response = await slack.call('conversations.replies', {
      channel: channel.id,
      ts: input.ts,
      limit: Math.min(Number(input.limit) || 50, 200),
    });
    const messages = response.messages ?? [];
    const names = await users.namesFor(messages);

    return {
      channel: channel.id,
      count: messages.length,
      messages: messages.map((message) => ({
        user: message.user ? (names.get(message.user) ?? message.user) : null,
        user_id: message.user ?? null,
        ts: message.ts,
        text: message.text ?? '',
        reply_count: message.reply_count ?? 0,
      })),
    };
  }

  async function readLink(input) {
    const link = parsePermalink(input.url);
    let messages;

    if (link.threadTs) {
      const response = await slack.call('conversations.replies', {
        channel: link.channel,
        ts: link.threadTs,
        limit: 100,
      });
      messages = response.messages ?? [];
    } else {
      const history = await slack.call('conversations.history', {
        channel: link.channel,
        latest: link.ts,
        inclusive: true,
        limit: 1,
      });
      messages = history.messages ?? [];
      if (messages[0]?.reply_count > 0) {
        const replies = await slack.call('conversations.replies', {
          channel: link.channel,
          ts: link.ts,
          limit: 100,
        });
        messages = replies.messages ?? messages;
      }
    }

    const names = await users.namesFor(messages);
    return {
      channel: link.channel,
      ts: link.ts,
      thread_ts: link.threadTs,
      count: messages.length,
      messages: messages.map((message) => ({
        user: message.user ? (names.get(message.user) ?? message.user) : null,
        user_id: message.user ?? null,
        ts: message.ts,
        text: message.text ?? '',
        is_thread_parent: message.ts === (link.threadTs ?? link.ts),
      })),
    };
  }

  return { openDm, dm, post, thread, readLink };
}
