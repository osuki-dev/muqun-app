import { THEME_LIMITS } from './schema';

export class ThemeJsonFormatError extends Error {
  constructor(public readonly code: 'invalid-json' | 'too-large') {
    super(code);
    this.name = 'ThemeJsonFormatError';
  }
}

/** Change whitespace only: parsing validates syntax, never supplies output values. */
export function formatThemeJson(raw: string): string {
  const encoder = new TextEncoder();
  const limit = THEME_LIMITS.manifestBytes;
  if (raw.length > limit || encoder.encode(raw).length > limit)
    throw new ThemeJsonFormatError('too-large');
  try {
    JSON.parse(raw);
  } catch {
    throw new ThemeJsonFormatError('invalid-json');
  }
  // Validation above makes these lexical tokens unambiguous. Strings retain
  // their exact escapes; numbers and duplicate object keys are never rewritten.
  const tokens = raw.match(/"(?:\\[\s\S]|[^"\\])*"|[{}[\],:]|[^\s{}[\],:]+/g) ?? [];
  const parts: string[] = [];
  let bytes = 0;
  let depth = 0;
  const append = (value: string) => {
    bytes += encoder.encode(value).length;
    if (bytes > limit) throw new ThemeJsonFormatError('too-large');
    parts.push(value);
  };
  const newline = () => append(`\n${'  '.repeat(depth)}`);
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token === '{' || token === '[') {
      append(token);
      depth++;
      if (tokens[index + 1] !== (token === '{' ? '}' : ']')) newline();
    } else if (token === '}' || token === ']') {
      depth--;
      if (tokens[index - 1] !== (token === '}' ? '{' : '[')) newline();
      append(token);
    } else if (token === ',') {
      append(token);
      newline();
    } else if (token === ':') append(': ');
    else append(token);
  }
  return parts.join('');
}
