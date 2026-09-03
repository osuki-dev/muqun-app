/**
 * Text a server sent, made safe to show in the app's own chrome.
 *
 * A keyboard-interactive challenge's name, instruction and prompts, the
 * reason a transport gave for dropping, the message inside an `SshError` --
 * all of it is written by the far side, and a hostile server writes it to
 * pass as the app's own words: a "prompt" that reads like a system dialog, a
 * bidirectional override that hides half a sentence, a control character
 * that a text renderer turns into something else, or a megabyte of it.
 *
 * What comes back is plain text and nothing more: control characters and
 * the invisible format characters (bidi overrides and isolates, zero-width
 * joiners and spaces, the byte-order mark) are removed, `\r\n` and the
 * Unicode line separators become `\n`, tabs become spaces, and the whole is
 * cut at `limit` characters with an ellipsis. Whitespace at either end is
 * trimmed. Nothing is interpreted: not markdown, not links, not escapes.
 * Wherever such text is shown -- a dialog, a status line, a toast -- it goes
 * through here first.
 */

/** Default ceiling on what is kept. A prompt or an error message is a sentence, not a page. */
export const SERVER_TEXT_LIMIT = 512;

/** `\r\n`, a bare `\r`, NEL, and the Unicode line and paragraph separators. */
const LINE_BREAKS = /\r\n|\r|\u0085|\u2028|\u2029/gu;
const TABS = /\t/gu;
/**
 * C0 (except `\n`, handled above), DEL, C1, and the format characters that
 * change how text reads without showing: soft hyphen, the Arabic letter mark
 * and Mongolian vowel separator, zero-width space / non-joiner / joiner /
 * LRM / RLM, the bidi embeddings and overrides, the word joiner and
 * invisible operators, the bidi isolates, and the byte-order mark.
 */
const INVISIBLE =
  /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/gu;

export function sanitizeServerText(value: unknown, limit: number = SERVER_TEXT_LIMIT): string {
  if (typeof value !== 'string' || value === '') return '';
  const plain = value.replace(LINE_BREAKS, '\n').replace(TABS, ' ').replace(INVISIBLE, '').trim();
  if (plain.length <= limit) return plain;
  const characters = Array.from(plain);
  if (characters.length <= limit) return plain;
  return `${characters
    .slice(0, Math.max(0, limit - 1))
    .join('')
    .trimEnd()}…`;
}

/** Ceiling for one line of chrome: a status line, a toast, a dialog title. */
export const SERVER_LINE_LIMIT = 160;

/**
 * An `SshFailure` as one line for a toast or a status: the code, which is
 * the library's own word, and the message, which may quote the server.
 */
export function sshFailureLine(failure: { code: string; message: string }): string {
  const code = sanitizeServerText(failure.code, 32);
  const message = sanitizeServerText(failure.message, SERVER_LINE_LIMIT);
  return message ? `${code}: ${message}` : code;
}
