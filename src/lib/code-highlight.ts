/**
 * Syntax highlighting for the artifacts the asset viewer opens.
 *
 * Everything here is pure: text in, spans out. The colors are applied by the
 * component, from theme tokens, so this file never names one -- it names a
 * *role*, and the viewer decides what a role looks like in the current palette.
 *
 * Why this exists at all rather than being handed to the markdown renderer:
 * `react-native-enriched-markdown` cannot color a code block. Its
 * `CodeBlockStyleInternal` is `backgroundColor`, `borderColor`, `borderRadius`,
 * `borderWidth`, `padding` and one inherited text color -- there is no span or
 * scope concept in the native props, and that is still true in the newest
 * `0.8.0-nightly` build. Upstream closed the proposal to accept precomputed
 * spans (software-mansion/react-native-enriched-markdown#538) in favour of an
 * unscheduled optional side package, so there is nothing to wait for.
 */

import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import go from 'highlight.js/lib/languages/go';
import ini from 'highlight.js/lib/languages/ini';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

/**
 * Registered by hand rather than through `highlight.js/lib/common`, so the
 * bundle carries the languages an agent's workspace actually produces and not
 * the other twenty-five.
 */
const LANGUAGES = {
  bash,
  go,
  ini,
  javascript,
  json,
  markdown,
  python,
  rust,
  typescript,
  xml,
  yaml,
} as const;

let registered = false;

function ensureRegistered() {
  if (registered) return;
  for (const [name, definition] of Object.entries(LANGUAGES)) {
    hljs.registerLanguage(name, definition);
  }
  registered = true;
}

/**
 * The roles a token can have. Six, because six is what the semantic palette can
 * say: highlight.js emits forty-odd scopes and every one of them has to land in
 * a token that exists in `ThemeColors`. A finer split would be a precision the
 * palette cannot express, and it would break the moment the palette changes.
 */
export type TokenRole =
  | 'plain'
  | 'keyword'
  | 'string'
  | 'number'
  | 'comment'
  | 'name'
  | 'punctuation';

export interface CodeSpan {
  text: string;
  role: TokenRole;
}

/** One rendered line. Diff lines also carry a verdict for their background. */
export interface CodeLine {
  spans: CodeSpan[];
  /** Only set for diffs: what happened to this line. */
  diff?: 'added' | 'removed' | 'hunk' | 'meta';
}

export interface HighlightResult {
  lines: CodeLine[];
  /** The language actually used, or null when the file was rendered plain. */
  language: string | null;
  /** Set when the file was too big to color, so the viewer can say so. */
  skipped: 'size' | 'lines' | null;
}

/**
 * Where highlighting gives up.
 *
 * Two gates, and card #661 changed what both of them are protecting and what
 * one of them is worth.
 *
 * The viewer used to mount the whole file at once, so the count that hurt was
 * the *span* count -- every coloured run was a node in one enormous tree, built
 * and laid out synchronously on the frame the sheet opened. `CodeView`
 * virtualizes lines now, so render cost is bounded by the viewport rather than
 * by the file, and what is left is the work that is still linear in the whole
 * input:
 *
 *   * the byte gate is tokenizing time. highlight.js is a regex machine, it
 *     runs on the JS thread, and it cannot be interrupted part way.
 *   * the line gate is the arrays. Every line is a `CodeLine` in the JS heap
 *     whether or not it is on screen.
 *
 * The byte gate was 64 KiB, set from `scripts/bench-highlight.ts`: 27.6 ms for
 * 64 KiB of TypeScript, on bun's JSC, on an Apple Silicon desktop. The note
 * said Hermes would be slower. It is not slower, it is a different order --
 * measured through the app on an Android emulator, one file at a time, warm:
 *
 *   input                    bun/JSC     Hermes    ratio
 *   20 KiB TypeScript        14.1 ms     447 ms      32x
 *   60 KiB TypeScript        24.9 ms   1_906 ms      77x   (includes grammar
 *                                                           registration)
 *   20 KiB Rust               6.9 ms     142 ms      21x
 *   60 KiB Rust              11.8 ms     147 ms      12x
 *   60 KiB plain log          0.0 ms      10 ms       --   (no grammar)
 *
 * Hermes has its own regex engine and it is where the whole difference lives.
 * So the desktop benchmark was reading a machine nobody runs the app on, and
 * 64 KiB of TypeScript is not "about as much as a phone can absorb" -- it is
 * close to two seconds of a thread that cannot answer a touch.
 *
 * 16 KiB is what the same measurement supports: roughly 350 ms for the most
 * expensive grammar registered here, and well under a tenth of that for the
 * cheap ones, on a file bigger than almost everything an agent writes. It is
 * spent after the first paint rather than before it (see `CodeView`), so it is
 * colour arriving late on a page already being read -- but it is still a block,
 * and the number is chosen so it is a short one. Anything above the gate is
 * plain text with a caption saying so, which is what shipped before colour
 * existed at all.
 *
 * The line gate rose from 2_000 to 20_000 with the same change. 2_000 was the
 * point past which a mounted `View` per diff row stopped being affordable, and
 * there is no longer a `View` per row -- only the rows on screen exist. 20_000
 * is where the `CodeLine` array itself starts to be the expensive part, and
 * `readAssetText` refuses anything over 512 KiB outright, so both gates sit
 * under a ceiling that already exists.
 */
export const HIGHLIGHT_MAX_BYTES = 16 * 1024;
export const HIGHLIGHT_MAX_LINES = 20_000;

/**
 * Extension to language. Explicit, and no auto-detection: `highlightAuto` runs
 * every registered grammar over the input and is the expensive path, for a
 * guess we do not need when the file has a name.
 */
const EXTENSIONS: Record<string, string> = {
  bash: 'bash',
  sh: 'bash',
  zsh: 'bash',
  fish: 'bash',
  go: 'go',
  cfg: 'ini',
  conf: 'ini',
  ini: 'ini',
  toml: 'ini',
  cjs: 'javascript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  json: 'json',
  json5: 'json',
  jsonc: 'json',
  lock: 'json',
  md: 'markdown',
  markdown: 'markdown',
  py: 'python',
  pyi: 'python',
  rs: 'rust',
  cts: 'typescript',
  mts: 'typescript',
  ts: 'typescript',
  tsx: 'typescript',
  htm: 'xml',
  html: 'xml',
  svg: 'xml',
  xml: 'xml',
  plist: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
};

/** Files whose whole meaning is the per-line verdict, not the syntax. */
const DIFF_EXTENSIONS = new Set(['diff', 'patch', 'rej']);

/** Names with no extension that still say what they are. */
const FILENAMES: Record<string, string> = {
  dockerfile: 'bash',
  makefile: 'bash',
  '.bashrc': 'bash',
  '.zshrc': 'bash',
  '.env': 'ini',
  '.gitconfig': 'ini',
};

export function languageForFile(name: string): string | null {
  const lower = name.toLowerCase();
  const byName = FILENAMES[lower];
  if (byName) return byName;
  const dot = lower.lastIndexOf('.');
  if (dot < 0) return null;
  return EXTENSIONS[lower.slice(dot + 1)] ?? null;
}

export function isDiffFile(name: string): boolean {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf('.');
  return dot >= 0 && DIFF_EXTENSIONS.has(lower.slice(dot + 1));
}

/**
 * highlight.js scope to role.
 *
 * Matched on the leading segment, so `title.function_` and `title.class` both
 * resolve through `title` and a scope the library adds later degrades to
 * `plain` rather than throwing.
 */
const ROLES: Record<string, TokenRole> = {
  keyword: 'keyword',
  built_in: 'keyword',
  literal: 'keyword',
  'selector-tag': 'keyword',
  doctag: 'keyword',
  string: 'string',
  regexp: 'string',
  char: 'string',
  'meta-string': 'string',
  'template-tag': 'string',
  'template-variable': 'string',
  subst: 'string',
  number: 'number',
  symbol: 'number',
  bullet: 'number',
  'selector-id': 'number',
  comment: 'comment',
  quote: 'comment',
  title: 'name',
  class: 'name',
  type: 'name',
  attr: 'name',
  attribute: 'name',
  section: 'name',
  name: 'name',
  variable: 'name',
  property: 'name',
  'selector-class': 'name',
  punctuation: 'punctuation',
  operator: 'punctuation',
  params: 'punctuation',
  meta: 'punctuation',
  tag: 'punctuation',
  'meta-keyword': 'punctuation',
  deletion: 'plain',
  addition: 'plain',
};

function roleForScope(scope: string): TokenRole {
  const direct = ROLES[scope];
  if (direct) return direct;
  const dot = scope.indexOf('.');
  if (dot > 0) return ROLES[scope.slice(0, dot)] ?? 'plain';
  const underscore = scope.indexOf('_');
  if (underscore > 0) return ROLES[scope.slice(0, underscore)] ?? 'plain';
  return 'plain';
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#x27': "'",
  '#39': "'",
  nbsp: ' ',
};

/**
 * The largest code point there is.
 *
 * `String.fromCodePoint` throws a RangeError for anything above it, and
 * `Number.isFinite` does not rule that out: `&#1114112;` is a perfectly finite
 * number and an invalid character. The entity text comes out of whatever file
 * the reader opened, so the input is arbitrary, and the throw would take the
 * whole preview down rather than one character.
 */
const MAX_CODE_POINT = 0x10ffff;

/** The character a numeric entity names, or the entity itself if it names none. */
function characterForCodePoint(code: number, entity: string): string {
  if (!Number.isInteger(code) || code < 0 || code > MAX_CODE_POINT) return entity;
  return String.fromCodePoint(code);
}

function unescapeEntities(value: string): string {
  if (!value.includes('&')) return value;
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, name: string) => {
    const known = ENTITIES[name.toLowerCase()] ?? ENTITIES[name];
    if (known !== undefined) return known;
    if (name.startsWith('#x') || name.startsWith('#X')) {
      return characterForCodePoint(Number.parseInt(name.slice(2), 16), whole);
    }
    if (name.startsWith('#')) {
      return characterForCodePoint(Number.parseInt(name.slice(1), 10), whole);
    }
    return whole;
  });
}

/**
 * highlight.js's public API emits an HTML string, so this reads it back.
 *
 * `lowlight` is the sanctioned way to get a tree instead, but it is ESM-only
 * and pulls two more packages, and Metro's package-exports resolution is where
 * this app has been bitten before. The emitted markup is not general HTML: it
 * is a strictly nested tree of `<span class="hljs-*">` over escaped text, with
 * a closed vocabulary. A stack is enough, and unlike a vendored walker every
 * rule here has a test.
 *
 * The innermost open scope wins, which is what makes JSON's
 * `hljs-literal > hljs-keyword` come out as one keyword rather than two roles
 * fighting over the same characters.
 */
export function spansFromHighlightHtml(html: string): CodeSpan[] {
  const spans: CodeSpan[] = [];
  const stack: TokenRole[] = [];
  let index = 0;

  function push(text: string) {
    if (!text) return;
    const role = stack.length > 0 ? stack[stack.length - 1] : 'plain';
    const last = spans[spans.length - 1];
    // Merging touching same-role runs is what keeps the span count -- the thing
    // the render budget is actually spent on -- close to the token count.
    if (last && last.role === role) last.text += text;
    else spans.push({ text, role });
  }

  while (index < html.length) {
    const next = html.indexOf('<', index);
    if (next < 0) {
      push(unescapeEntities(html.slice(index)));
      break;
    }
    push(unescapeEntities(html.slice(index, next)));

    const close = html.indexOf('>', next);
    if (close < 0) {
      // Truncated markup: take the remainder as text rather than dropping it.
      push(unescapeEntities(html.slice(next)));
      break;
    }

    const tag = html.slice(next + 1, close);
    if (tag.startsWith('/')) {
      stack.pop();
    } else {
      const scope = /class="hljs-([^"]+)"/.exec(tag)?.[1] ?? '';
      // A multi-class scope (`hljs-title function_`) is read from its first.
      stack.push(scope ? roleForScope(scope.split(' ')[0]) : 'plain');
    }
    index = close + 1;
  }

  return spans;
}

/** Cut spans at newlines so each line can be laid out, and tinted, on its own. */
function splitLines(spans: CodeSpan[]): CodeLine[] {
  const lines: CodeLine[] = [{ spans: [] }];
  for (const span of spans) {
    const parts = span.text.split('\n');
    parts.forEach((part, index) => {
      if (index > 0) lines.push({ spans: [] });
      if (part) lines[lines.length - 1].spans.push({ text: part, role: span.role });
    });
  }
  return lines;
}

/**
 * A diff, read line by line.
 *
 * Deliberately ahead of highlight.js rather than through it: a diff's meaning
 * is the verdict on each line, not the syntax inside it, and hljs's own `diff`
 * grammar returns `addition`/`deletion` as inline scopes with no way to tint
 * the whole row. The row is the unit here.
 */
export function highlightDiff(text: string): CodeLine[] {
  return text.split('\n').map((line) => {
    const spans: CodeSpan[] = line ? [{ text: line, role: 'plain' }] : [];
    if (line.startsWith('@@')) return { spans, diff: 'hunk' };
    // Header markers are checked before the single-character ones, because
    // `---` and `+++` also start with `-` and `+`.
    if (
      line.startsWith('---') ||
      line.startsWith('+++') ||
      line.startsWith('diff ') ||
      line.startsWith('index ') ||
      line.startsWith('new file') ||
      line.startsWith('deleted file') ||
      line.startsWith('similarity index') ||
      line.startsWith('rename ')
    ) {
      return { spans, diff: 'meta' };
    }
    if (line.startsWith('+')) return { spans, diff: 'added' };
    if (line.startsWith('-')) return { spans, diff: 'removed' };
    return { spans };
  });
}

/**
 * The one entry point: a file's name and contents in, lines of roled spans out.
 *
 * Never throws. A grammar that fails on a malformed file is not a reason to
 * refuse to show the file -- it falls back to plain, which is exactly what
 * shipped before this existed.
 */
export function highlightFile(name: string, text: string): HighlightResult {
  if (isDiffFile(name)) {
    // Diffs skip the byte gate: the work is one pass of `startsWith` per line,
    // not a grammar, so the only thing that can hurt is the span count -- and
    // that is bounded by the line gate below.
    const lines = highlightDiff(text);
    if (lines.length > HIGHLIGHT_MAX_LINES) {
      return { lines: plainLines(text), language: null, skipped: 'lines' };
    }
    return { lines, language: 'diff', skipped: null };
  }

  const language = languageForFile(name);
  if (!language) return { lines: plainLines(text), language: null, skipped: null };

  if (text.length > HIGHLIGHT_MAX_BYTES) {
    return { lines: plainLines(text), language: null, skipped: 'size' };
  }

  ensureRegistered();
  let html: string;
  try {
    html = hljs.highlight(text, { language, ignoreIllegals: true }).value;
  } catch {
    return { lines: plainLines(text), language: null, skipped: null };
  }

  const lines = splitLines(spansFromHighlightHtml(html));
  if (lines.length > HIGHLIGHT_MAX_LINES) {
    return { lines: plainLines(text), language: null, skipped: 'lines' };
  }
  return { lines, language, skipped: null };
}

/**
 * The same result the fallbacks produce, with nothing coloured.
 *
 * Exported because `CodeView` paints this on the frame the sheet opens and
 * swaps the coloured result in afterwards: splitting on newlines is a fraction
 * of a millisecond even at 200 KB, where tokenizing is tens of milliseconds and
 * the reader is looking at an empty screen for every one of them.
 */
export function plainFile(text: string): HighlightResult {
  return { lines: plainLines(text), language: null, skipped: null };
}

function plainLines(text: string): CodeLine[] {
  return text.split('\n').map((line) => ({
    spans: line ? [{ text: line, role: 'plain' as TokenRole }] : [],
  }));
}
