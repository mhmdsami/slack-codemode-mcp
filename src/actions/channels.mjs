import { isFresh } from '../cache.mjs';
import { ActionError } from '../errors.mjs';
import { CHANNEL_ID } from './input.mjs';

export function createChannelActions({ slack, cache }) {
  async function list() {
    if (cache.channels && isFresh(cache.channelsAt, cache.ttlMs)) return cache.channels;

    const channels = [];
    let cursor = '';
    let complete = true;
    for (let page = 0; page < 10; page += 1) {
      const response = await slack.call('conversations.list', {
        limit: 1000,
        types: 'public_channel,private_channel',
        exclude_archived: true,
        ...(cursor ? { cursor } : {}),
      });
      for (const channel of response.channels ?? []) {
        channels.push({
          id: channel.id,
          name: channel.name,
          is_private: Boolean(channel.is_private),
          is_member: Boolean(channel.is_member),
        });
      }
      cursor = response.response_metadata?.next_cursor ?? '';
      if (!cursor) break;
      if (page === 9) complete = false;
    }

    cache.channels = channels;
    cache.channelsAt = Date.now();
    cache.channelsComplete = complete;
    return channels;
  }

  async function find(query) {
    const raw = String(query ?? '')
      .trim()
      .replace(/^#/, '');
    if (CHANNEL_ID.test(raw)) return { channel: { id: raw, name: raw }, complete: true };

    const needle = raw.toLowerCase();
    const matches = (await list())
      .map((channel) => {
        const name = (channel.name ?? '').toLowerCase();
        const score =
          name === needle ? 100 : name.startsWith(needle) ? 60 : name.includes(needle) ? 30 : 0;
        return { channel, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.channel);

    if (matches.length === 0) {
      const suffix = cache.channelsComplete
        ? ''
        : ' The directory scan is capped, so the channel may exist beyond it.';
      throw new ActionError('not_found', `No channel matched "${raw}".${suffix}`);
    }
    return {
      channel: matches.length === 1 ? matches[0] : null,
      matches: matches.slice(0, 5),
      total: matches.length,
      complete: cache.channelsComplete,
    };
  }

  return { find };
}
