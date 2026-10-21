import { isFresh } from '../cache.mjs';
import { ActionError } from '../errors.mjs';

export function normalizeName(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function scoreUser(user, query) {
  const needle = normalizeName(query);
  if (!needle) return 0;
  const fields = [user.name, user.real_name, user.display_name, user.email?.split('@')[0]]
    .map(normalizeName)
    .filter(Boolean);
  if (fields.some((field) => field === needle)) return 100;
  if (fields.some((field) => field.startsWith(needle))) return 70;
  if (fields.some((field) => field.split(' ').includes(needle))) return 60;
  if (fields.some((field) => field.includes(needle))) return 40;
  return 0;
}

export function summarizeUser(user) {
  return {
    id: user.id,
    name: user.name,
    real_name: user.full_name ?? user.real_name ?? null,
    display_name: user.display_name ?? null,
    email: user.email ?? null,
  };
}

export function createUserActions({ slack, cache }) {
  async function search(query) {
    const response = await slack.call('assistant.search.context', {
      query,
      content_types: ['users'],
      limit: 10,
      include_bots: false,
    });
    return (response.results?.users ?? []).map((user) => ({
      id: user.user_id ?? user.id,
      name: user.name ?? (user.email ? user.email.split('@')[0] : null),
      real_name: user.full_name ?? user.real_name ?? user.author_name ?? null,
      display_name: user.display_name ?? null,
      email: user.email ?? null,
    }));
  }

  async function list({ force = false } = {}) {
    if (!force && cache.users && isFresh(cache.usersAt, cache.ttlMs)) return cache.users;

    const users = [];
    let cursor = '';
    for (let page = 0; page < 2; page += 1) {
      const response = await slack.call('users.list', {
        limit: 1000,
        ...(cursor ? { cursor } : {}),
      });
      for (const user of response.members ?? []) {
        if (user.deleted) continue;
        users.push({
          id: user.id,
          name: user.name,
          real_name: user.real_name ?? null,
          display_name: user.profile?.display_name ?? null,
          is_bot: Boolean(user.is_bot),
        });
      }
      cursor = response.response_metadata?.next_cursor ?? '';
      if (!cursor) break;
    }

    cache.users = users;
    cache.usersAt = Date.now();
    for (const user of users) {
      cache.names.set(user.id, user.real_name || user.display_name || user.name);
    }
    return users;
  }

  function rank(users, query) {
    return users
      .map((user) => ({ user, score: scoreUser(user, query) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.user);
  }

  async function find(query) {
    const raw = String(query ?? '')
      .trim()
      .replace(/^@/, '');
    if (!raw) throw new ActionError('invalid_input', 'A user name, id, or email is required.');

    if (/^U[A-Z0-9]{6,}$/i.test(raw)) {
      const response = await slack.call('users.info', { user: raw });
      return { user: summarizeUser(response.user) };
    }

    if (raw.includes('@')) {
      const response = await slack.call('users.lookupByEmail', { email: raw });
      return { user: summarizeUser(response.user) };
    }

    const remote = await search(raw).catch(() => []);
    if (remote.length > 0) {
      const best = remote
        .map((user) => ({ user, score: scoreUser(user, raw) }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((entry) => entry.user);
      if (best.length > 0) {
        return {
          user: best.length === 1 ? summarizeUser(best[0]) : null,
          matches: best.slice(0, 5).map(summarizeUser),
          total: best.length,
          source: 'rts',
        };
      }
    }

    let matches = rank(await list(), raw);
    if (matches.length === 0) matches = rank(await list({ force: true }), raw);
    if (matches.length === 0) throw new ActionError('not_found', `No user matched "${raw}".`);

    return {
      user: matches.length === 1 ? summarizeUser(matches[0]) : null,
      matches: matches.slice(0, 5).map(summarizeUser),
      total: matches.length,
    };
  }

  async function resolve(query) {
    const result = await find(query);
    if (result.user) return result.user;
    throw new ActionError(
      'ambiguous',
      `"${query}" matched ${result.total} users. Pass an exact name, id, or email.`,
      { matches: result.matches },
    );
  }

  async function namesFor(messages) {
    const names = new Map(cache.names);
    const unresolved = [...new Set(messages.map((message) => message.user).filter(Boolean))]
      .filter((id) => !names.has(id))
      .slice(0, 25);
    for (const id of unresolved) {
      try {
        const response = await slack.call('users.info', { user: id });
        names.set(id, response.user?.real_name || response.user?.name || id);
      } catch {
        names.set(id, id);
      }
    }
    return names;
  }

  return { search, list, find, resolve, namesFor };
}
