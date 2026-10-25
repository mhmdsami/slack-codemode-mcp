import { ActionError } from '../errors.mjs';

const idShape = (prefix) => new RegExp(`^${prefix}(?=[A-Z0-9]*\\d)[A-Z0-9]{5,}$`);

export const SLACK_ID = idShape('[A-Z]');
export const USER_ID = idShape('U');
export const CHANNEL_ID = idShape('[CDG]');
export const CANVAS_ID = idShape('F');
export const SLACK_TS = /^\d{10,}\.\d{6}$/;

export function requiredText(value, field, { max = 4000 } = {}) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new ActionError('invalid_input', `\`${field}\` is required.`);
  if (text.length > max) {
    throw new ActionError('invalid_input', `\`${field}\` is longer than ${max} characters.`);
  }
  return text;
}

export function optionalText(value, field, { max = 4000 } = {}) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new ActionError('invalid_input', `\`${field}\` must be a string.`);
  }
  const text = value.trim();
  if (!text) return undefined;
  if (text.length > max) {
    throw new ActionError('invalid_input', `\`${field}\` is longer than ${max} characters.`);
  }
  return text;
}

export function requiredId(value, field, pattern = SLACK_ID) {
  const id = requiredText(value, field, { max: 64 });
  if (!pattern.test(id)) {
    throw new ActionError('invalid_input', `\`${field}\` is not a Slack id.`);
  }
  return id;
}

export function optionalId(value, field, pattern = SLACK_ID) {
  if (value === undefined || value === null || value === '') return undefined;
  return requiredId(value, field, pattern);
}

export function optionalTs(value, field) {
  if (value === undefined || value === null) return undefined;
  return requiredTs(value, field);
}

export function requiredTs(value, field) {
  const ts = requiredText(value, field, { max: 32 });
  if (!SLACK_TS.test(ts)) {
    throw new ActionError('invalid_input', `\`${field}\` is not a Slack timestamp.`);
  }
  return ts;
}

export function pageLimit(value, { fallback, max }) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), 1), max);
}

export function idList(value, field, pattern, { max = 20 } = {}) {
  if (value === undefined || value === null) return [];
  const list = Array.isArray(value) ? value : [value];
  if (list.length === 0) return [];
  if (list.length > max) {
    throw new ActionError('invalid_input', `\`${field}\` accepts at most ${max} ids.`);
  }
  return list.map((item, index) => requiredId(item, `${field}[${index}]`, pattern));
}

export function optionalArray(value, field, { max = 50 } = {}) {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length === 0) {
    throw new ActionError('invalid_input', `\`${field}\` must be a non-empty array.`);
  }
  if (value.length > max) {
    throw new ActionError('invalid_input', `\`${field}\` accepts at most ${max} items.`);
  }
  return value;
}
