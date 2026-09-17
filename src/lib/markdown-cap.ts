/**
 * How much content one native view is allowed to be handed.
 *
 * `EnrichedMarkdownText` measures its whole document in one shadow node. A
 * 5000-line file read, inlined into one card, measured to ~70,000px, and Fabric
 * gave up on the layout: `ShadowTree.cpp:324 assertion failed (attempts <
 * 1024)`, then `abort`. The renderer is not at fault for being asked to draw
 * seventy thousand pixels in one node -- nothing should ask it to.
 *
 * So every markdown string the transcript hands a native view goes through
 * here first. The reader loses nothing: what is cut is offered again behind a
 * "Show more", one chunk at a time, and the app says when it was the one that
 * cut something.
 *
 * Pure, and therefore tested: the components that draw the caps decide
 * nothing.
 */

/** Characters of markdown one native view draws before the reader asks for more. */
export const MARKDOWN_CHUNK_CHARS = 12_000;

/**
 * Beyond this, no native markdown view at all.
 *
 * The defensive half of the guard: a string this long has already defeated
 * whatever assumption produced it, and a plain `<Text>` in a height-capped
 * scroller is a readable answer that cannot take the process down with it.
 */
export const MARKDOWN_NATIVE_CEILING = 48_000;

/** Lines of a tool body drawn before the reader asks for more. */
export const TOOL_BODY_MAX_LINES = 400;

export interface CappedMarkdown {
  text: string;
  /** Characters held back; `0` when the whole string is drawn. */
  hidden: number;
}

/** How many fence markers a chunk opened. An odd count leaves one unclosed. */
function fenceCount(text: string): number {
  let count = 0;
  for (const line of text.split('\n')) {
    if (/^\s{0,3}(```|~~~)/.test(line)) count += 1;
  }
  return count;
}

/**
 * At most `limit` characters of markdown, cut at a line boundary.
 *
 * A cut in the middle of a line is a cut in the middle of a word, and a cut
 * inside a fenced block leaves the fence open -- which makes the *next* chunk
 * parse as code. So the cut goes back to the last newline within reach, and an
 * odd number of fences is closed before the string is handed over.
 */
export function capMarkdown(
  markdown: string,
  limit: number = MARKDOWN_CHUNK_CHARS
): CappedMarkdown {
  if (typeof markdown !== 'string') return { text: '', hidden: 0 };
  if (markdown.length <= limit) return { text: markdown, hidden: 0 };
  const newline = markdown.lastIndexOf('\n', limit);
  // Only when the line boundary is somewhere near the budget: a single line of
  // 40 KB has no newline to go back to and would otherwise cut to nothing.
  const end = newline > limit / 2 ? newline : limit;
  let text = markdown.slice(0, end);
  if (fenceCount(text) % 2 === 1) text += '\n```';
  return { text, hidden: markdown.length - end };
}

export interface CappedBody {
  text: string;
  /** Lines held back; `0` when the whole body is drawn. */
  hidden: number;
}

/** The first `limit` lines of a tool body, and a count of the rest. */
export function capBodyLines(text: string, limit: number = TOOL_BODY_MAX_LINES): CappedBody {
  if (!text) return { text: '', hidden: 0 };
  const lines = text.split('\n');
  if (lines.length <= limit) return { text, hidden: 0 };
  return { text: lines.slice(0, limit).join('\n'), hidden: lines.length - limit };
}

/**
 * Both caps, in the order they have to be applied.
 *
 * A body is cut by lines first, because that is the unit a reader asked for,
 * and by characters second, because that is the unit the native view chokes
 * on: four hundred lines of minified JavaScript is still a megabyte.
 */
export function capToolBody(
  text: string,
  lineLimit: number = TOOL_BODY_MAX_LINES,
  charLimit: number = MARKDOWN_NATIVE_CEILING
): CappedBody {
  const byLines = capBodyLines(text, lineLimit);
  if (byLines.text.length <= charLimit) return byLines;
  const byChars = capMarkdown(byLines.text, charLimit);
  const rest = byLines.text.slice(byChars.text.length);
  return {
    text: byChars.text,
    hidden: byLines.hidden + (rest ? rest.split('\n').length : 0),
  };
}
