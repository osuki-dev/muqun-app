import { utf8Bytes } from './multipart';

/** Read a recognized pane-output envelope; an error object is never terminal text. */
export function parseWorkOutputText(value: unknown, depth = 0): string {
  if (depth > 4) throw new Error('Output unavailable');
  if (typeof value === 'string') {
    if (value.length > 1024 * 1024 || utf8Bytes(value).length > 1024 * 1024)
      throw new Error('Output unavailable');
    return value;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Output unavailable');
  const raw = value as Record<string, unknown>;
  for (const key of ['text', 'output', 'content']) {
    if (key in raw) {
      if (typeof raw[key] !== 'string') throw new Error('Output unavailable');
      return parseWorkOutputText(raw[key], depth + 1);
    }
  }
  for (const key of ['read', 'result', 'data']) {
    if (key in raw) return parseWorkOutputText(raw[key], depth + 1);
  }
  throw new Error('Output unavailable');
}
