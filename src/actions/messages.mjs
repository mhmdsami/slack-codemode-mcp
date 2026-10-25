import { getCached, setCached } from '../cache.mjs';
import { ActionError } from '../errors.mjs';
import {
  CHANNEL_ID,
  optionalArray,
  optionalText,
  optionalTs,
  pageLimit,
  requiredId,
  requiredText,
  requiredTs,
  USER_ID,
} from './input.mjs';

const SORTS = ['score', 'timestamp'];
const SORT_DIRS = ['asc', 'desc'];

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

function messageBody(input, text) {
  const blocks = optionalArray(input.blocks, 'blocks', { max: 50 });
  const attachments = optionalArray(input.attachments, 'attachments', { max: 50 });
  if (!text && !blocks && !attachments) {
    throw new ActionError('invalid_input', 'Provide `text`, `blocks`, or `attachments`.');
  }
  return {
    ...(text ? { text } : {}),
    ...(blocks ? { blocks } : {}),
    ...(attachments ? { attachments } : {}),
  };
}

function messageOptions(input) {
  const options = {};
  if (input.mrkdwn !== undefined) options.mrkdwn = Boolean(input.mrkdwn);
  if (input.unfurl_links !== undefined) options.unfurl_links = Boolean(input.unfurl_links);
  if (input.unfurl_media !== undefined) options.unfurl_media = Boolean(input.unfurl_media);
  if (input.reply_broadcast !== undefined) {
    options.reply_broadcast = Boolean(input.reply_broadcast);
  }
  return options;
}

export function summarizeMessage(message, names) {
  return {
    user: message.user ? (names.get(message.user) ?? message.user) : null,
    user_id: message.user ?? null,
    ts: message.ts,
    text: message.text ?? '',
    files: (message.files ?? []).map((file) => ({
      id: file.id,
      name: file.name ?? file.title ?? null,
      mimetype: file.mimetype ?? null,
    })),
    attachments: (message.attachments ?? []).length,
    reactions: (message.reactions ?? []).map((reaction) => ({
      name: reaction.name,
      count: reaction.count,
    })),
    edited: Boolean(message.edited),
    subtype: message.subtype ?? null,
  };
}

export function createMessageActions({ slack, cache, users, channels }) {
  async function openDm(userIds) {
    const key = userIds.join(',');
    const cached = getCached(cache.dms, key, cache.ttlMs);
    if (cached) return cached;
    const response = await slack.call('conversations.open', { users: key });
    const channel = response.channel?.id;
    if (!channel)
      throw new ActionError('internal_error', 'conversations.open returned no channel.');
    setCached(cache.dms, key, channel, cache.maxEntries);
    return channel;
  }

  async function resolveTarget(to) {
    const raw = String(to ?? '').trim();
    if (!raw) throw new ActionError('invalid_input', 'A channel or user is required.');

    const bare = raw.replace(/^@/, '');
    if (raw.startsWith('@') || USER_ID.test(bare)) {
      const ids = bare
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      return { dm: true, users: ids };
    }

    if (CHANNEL_ID.test(raw)) return { dm: false, id: raw, name: raw };

    const found = await channels.find(raw);
    if (!found.channel) {
      throw new ActionError('ambiguous', `"${raw}" matched ${found.total} channels.`, {
        matches: found.matches,
      });
    }
    return { dm: false, id: found.channel.id, name: found.channel.name };
  }

  async function channelForTarget(target) {
    if (!target.dm) return { id: target.id, name: target.name };
    const ids = [];
    for (const user of target.users) ids.push((await users.resolve(user)).id);
    return { id: await openDm(ids), name: ids.join(',') };
  }

  async function resolveChannel(value) {
    const raw = requiredText(value, 'channel', { max: 128 });
    if (!raw.startsWith('#')) return { id: requiredId(raw, 'channel', CHANNEL_ID) };
    const found = await channels.find(raw);
    if (!found.channel) {
      throw new ActionError('ambiguous', `"${raw}" matched ${found.total} channels.`, {
        matches: found.matches,
      });
    }
    return found.channel;
  }

  async function dm(input) {
    const candidates = Array.isArray(input.user) ? input.user : String(input.user ?? '').split(',');
    const ids = [];
    for (const user of candidates.map((value) => String(value).trim()).filter(Boolean)) {
      ids.push((await users.resolve(user)).id);
    }
    if (ids.length === 0) throw new ActionError('invalid_input', '`user` is required.');

    const channel = await openDm(ids);
    const text = optionalText(input.text, 'text', { max: 40_000 });
    const threadTs = optionalTs(input.thread_ts, 'thread_ts');
    const response = await slack.call('chat.postMessage', {
      channel,
      ...messageBody(input, text),
      ...(threadTs ? { thread_ts: threadTs } : {}),
      ...(input.client_msg_id ? { client_msg_id: String(input.client_msg_id) } : {}),
      ...messageOptions(input),
    });
    return { ok: true, users: ids, channel: response.channel, ts: response.ts };
  }

  async function post(input) {
    const to = String(input.to ?? input.channel ?? '').trim();
    if (!to)
      throw new ActionError('invalid_input', '`to` is required (channel, #name, @user, or id).');
    const text = optionalText(input.text, 'text', { max: 40_000 });

    const channel = await channelForTarget(await resolveTarget(to));
    const threadTs = optionalTs(input.thread_ts, 'thread_ts');
    const response = await slack.call('chat.postMessage', {
      channel: channel.id,
      ...messageBody(input, text),
      ...(threadTs ? { thread_ts: threadTs } : {}),
      ...(input.client_msg_id ? { client_msg_id: String(input.client_msg_id) } : {}),
      ...messageOptions(input),
    });
    return { ok: true, channel: response.channel, channel_name: channel.name, ts: response.ts };
  }

  async function edit(input) {
    const channel = await resolveChannel(input.channel);
    const ts = requiredTs(input.ts, 'ts');
    const text = optionalText(input.text, 'text', { max: 40_000 });
    const blocks = optionalArray(input.blocks, 'blocks', { max: 50 });
    if (!text && !blocks) {
      throw new ActionError('invalid_input', 'Provide `text` or `blocks`.');
    }
    const response = await slack.call('chat.update', {
      channel: channel.id,
      ts,
      ...(text ? { text } : {}),
      ...(blocks ? { blocks } : {}),
      ...(input.reply_broadcast !== undefined
        ? { reply_broadcast: Boolean(input.reply_broadcast) }
        : {}),
    });
    return {
      ok: true,
      channel: response.channel ?? channel.id,
      ts: response.ts ?? ts,
      text: response.text ?? text ?? null,
    };
  }

  async function search(input) {
    const query = requiredText(input.query, 'query', { max: 1000 });
    if (input.sort !== undefined && !SORTS.includes(input.sort)) {
      throw new ActionError('invalid_input', '`sort` must be "score" or "timestamp".');
    }
    if (input.sort_dir !== undefined && !SORT_DIRS.includes(input.sort_dir)) {
      throw new ActionError('invalid_input', '`sort_dir` must be "asc" or "desc".');
    }
    const count = pageLimit(input.count ?? input.limit, { fallback: 20, max: 100 });
    const page = pageLimit(input.page, { fallback: 1, max: 100 });
    const response = await slack.call('search.messages', {
      query,
      count,
      page,
      ...(input.sort ? { sort: input.sort } : {}),
      ...(input.sort_dir ? { sort_dir: input.sort_dir } : {}),
      ...(input.highlight !== undefined ? { highlight: Boolean(input.highlight) } : {}),
    });
    const result = response.messages ?? {};
    const matches = (result.matches ?? []).map((match) => ({
      channel: match.channel?.name ?? null,
      channel_id: match.channel?.id ?? null,
      user: match.username ?? null,
      user_id: match.user ?? null,
      ts: match.ts ?? null,
      text: match.text ?? '',
      permalink: match.permalink ?? null,
    }));
    return {
      ok: true,
      total: result.total ?? matches.length,
      page: result.paging?.page ?? page,
      pages: result.paging?.pages ?? 1,
      count: matches.length,
      matches,
    };
  }

  async function thread(input) {
    const channel = await resolveChannel(input.channel);
    const ts = requiredTs(input.ts, 'ts');

    const response = await slack.call('conversations.replies', {
      channel: channel.id,
      ts,
      limit: pageLimit(input.limit, { fallback: 50, max: 200 }),
    });
    const messages = response.messages ?? [];
    const names = await users.namesFor(messages);

    return {
      channel: channel.id,
      count: messages.length,
      has_more: Boolean(response.has_more),
      next_cursor: response.response_metadata?.next_cursor ?? null,
      messages: messages.map((message) => ({
        ...summarizeMessage(message, names),
        reply_count: message.reply_count ?? 0,
      })),
    };
  }

  async function readLink(input) {
    const link = parsePermalink(input.url);
    let messages;
    let hasMore = false;

    if (link.threadTs) {
      const response = await slack.call('conversations.replies', {
        channel: link.channel,
        ts: link.threadTs,
        limit: 100,
      });
      messages = response.messages ?? [];
      hasMore = Boolean(response.has_more);
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
        hasMore = Boolean(replies.has_more);
      }
    }

    const names = await users.namesFor(messages);
    return {
      channel: link.channel,
      ts: link.ts,
      thread_ts: link.threadTs,
      count: messages.length,
      has_more: hasMore,
      messages: messages.map((message) => ({
        ...summarizeMessage(message, names),
        is_thread_parent: message.ts === (link.threadTs ?? link.ts),
      })),
    };
  }

  return { dm, post, edit, search, thread, readLink, resolveTarget, channelForTarget };
}
