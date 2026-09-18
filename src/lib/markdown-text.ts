/**
 * What the transcript still asks about a string the engine wrote.
 *
 * The agent surface now draws every piece of model- or engine-authored prose
 * through one markdown pipeline, which leaves these places where the app still
 * has to reason about the *syntax* rather than hand it to the renderer:
 *
 * - a closed notice shows two lines of a note that may be a whole document, and
 *   `## Search` on the first of those two lines is markdown leaking into a
 *   preview that is not rendering markdown;
 * - a form's field title and an option's label have to stay one line inside a
 *   pressable, so their block syntax is taken off rather than drawn;
 * - a failure is sometimes one sentence and sometimes a fenced report, and only
 *   the second is worth a native markdown view;
 * - a tool this build has never heard of returns prose from one MCP server and
 *   a log from the next, and only the first should stop being monospace.
 *
 * Pure, so each rule is stated once and tested once. Nothing here mutates what
 * the model said for display *inside* markdown -- `strikeMarkdown` is the one
 * exception and it is deliberately narrow; see its own note.
 */

/**
 * Markdown syntax, taken off, so a preview reads as one flat line.
 *
 * Not a parser and not trying to be: it removes the marks a reader would
 * otherwise see as punctuation in a two-line summary, keeps the words, and
 * collapses the blank lines a document is made of into single spaces.
 */
export function plainFromMarkdown(markdown: string): string {
  return (
    markdown
      // A fenced block is the one thing worth dropping whole: its body is code,
      // and code in a two-line preview says nothing about what the note is.
      .replace(/^[ \t]*(```|~~~)[^\n]*\n[\s\S]*?^[ \t]*\1[^\n]*$/gm, ' ')
      // An unterminated fence, which a streamed note is full of.
      .replace(/^[ \t]*(```|~~~)[^\n]*$/gm, ' ')
      .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
      .replace(/^[ \t]{0,3}>[ \t]?/gm, '')
      .replace(/^[ \t]{0,3}([-*+]|\d+[.)])[ \t]+/gm, '')
      .replace(/^[ \t]{0,3}([-*_][ \t]*){3,}$/gm, ' ')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/`+([^`]*)`+/g, '$1')
      .replace(/\*\*([\s\S]*?)\*\*/g, '$1')
      .replace(/(^|[^\w])__([\s\S]*?)__(?!\w)/g, '$1$2')
      // Emphasis, by the rule the renderer uses rather than "a star is a star":
      // a delimiter is one only with no space inside it, and an underscore only
      // outside a word -- `2 * 3` is arithmetic and `agent_tool_output` is an
      // identifier, and a preview that ate either would be lying about the text.
      .replace(/\*(?!\s)([^*\n]*[^\s*])\*/g, '$1')
      .replace(/(^|[^\w])_(?!\s)([^_\n]*[^\s_])_(?!\w)/g, '$1$2')
      .replace(/~~([\s\S]*?)~~/g, '$1')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/** The marks that make a string worth a markdown view rather than a `<Text>`. */
const MARKDOWN_MARKS: readonly RegExp[] = [
  /```|~~~/,
  /^[ \t]{0,3}#{1,6}[ \t]+\S/m,
  /^[ \t]{0,3}([-*+]|\d+[.)])[ \t]+\S/m,
  /^[ \t]{0,3}>[ \t]+\S/m,
  /^[ \t]{0,3}\|.*\|/m,
  /`[^`\n]+`/,
  /(\*\*|__)\S[\s\S]*?\1/,
  /\[[^\]\n]+\]\([^)\s]+\)/,
  /\$\$[\s\S]+\$\$/,
];

/**
 * Whether a string carries a mark a renderer would act on.
 *
 * The narrow question, for text that could just as well be a payload: a tool
 * this build has never heard of is an MCP call, and its result is prose from
 * one server and a log from the next. The app cannot tell those apart by
 * asking whether they have several lines -- raw output has several lines --
 * but a heading, a bullet list, a table, a link, bold or a backtick is
 * somebody writing markdown on purpose. Anything else stays monospace, where a
 * payload's own alignment survives.
 */
export function hasMarkdownMarks(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return MARKDOWN_MARKS.some((mark) => mark.test(trimmed));
}

/**
 * Whether a string the engine wrote has enough shape to be worth rendering.
 *
 * The wide question, for text that is prose either way: a failed tool is
 * usually one sentence -- "ENOENT: no such file or directory" -- and a native
 * markdown view for that is a view per failure for no gain. A failure that
 * arrives as a list, a fence or several lines is a small document and reads as
 * one. More than one line counts on its own here: a plain `<Text>` keeps the
 * line breaks but nothing else about the shape.
 */
export function hasMarkdownStructure(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (trimmed.includes('\n')) return true;
  return hasMarkdownMarks(trimmed);
}

/**
 * A finished checklist item, struck through.
 *
 * The one place the app adds syntax to the engine's own words, and the reason
 * is that the strike *is* the state: `MarkdownStyle` has no
 * `textDecorationLine`, so a done item drawn through the renderer would
 * otherwise lose the rule the list has always drawn through it. GitHub flavour
 * reads `~~…~~` as a strikethrough span, and inline code inside one still
 * renders.
 *
 * Deliberately narrow: strikethrough is an inline span, so anything that is
 * more than one line, or that already contains a tilde, is returned untouched
 * rather than wrapped into syntax that would then be shown literally.
 */
export function strikeMarkdown(text: string): string {
  const line = text.trim();
  if (!line || line.includes('~') || line.includes('\n')) return text;
  return `~~${line}~~`;
}
