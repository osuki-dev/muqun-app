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
 * Two gates because bytes alone are the wrong measure. Tokenizing is linear in
 * characters; *rendering* is linear in spans, and React Native's cost per
 * nested `<Text>` dwarfs highlight.js's cost per character. A minified bundle
 * is 500 long lines -- slow to tokenize, cheap to render. A build log is 20,000
 * short ones -- the reverse. Either gate trips the fallback.
 *
 * Measured with `bun run scripts/bench-highlight.ts` on this machine (bun 1.4,
 * Apple Silicon):
 *
 *   input                      chars     time    spans    lines
 *   demo theme.diff              368  0.02 ms        9        9   (diff path)
 *   demo coverage.json            55  0.07 ms       22        1
 *   16 KiB TypeScript         16_384  5.90 ms    2_324      472
 *   64 KiB TypeScript         65_536 27.61 ms    9_303    1_874
 *   128 KiB TypeScript       131_072 43.89 ms   18_608    3_749
 *   64 KiB diff               65_536  0.16 ms    1_599    1_599
 *   40_000-line log        2_759_999  2.12 ms   40_000   40_000   (unmapped ext)
 *
 * Tokenizing is linear at roughly 0.35 ms/KiB here. Bun's JSC is well ahead of
 * Hermes, so 64 KiB -- 27.6 ms on this machine -- is about as much as a phone
 * can absorb in one shot without the sheet visibly stalling as it opens, and it
 * covers essentially every artifact an agent actually writes. 128 KiB was
 * measured and rejected: 43.9 ms here extrapolates past 150 ms on device.
 *
 * The line gate protects a different thing. Syntax spans cost little to render
 * -- nested `<Text>` inside one parent `<Text>` collapses to ranges on a single
 * native attributed string, not to views. Diff lines cannot: a full-width row
 * tint needs a real `<View>` per line, because a background on a text span only
 * paints behind the glyphs. 2_000 rows is already more than a mounted
 * `ScrollView` should carry, and it is far more diff than anyone reads on a
 * phone.
 *
 * `readAssetText` refuses anything over 512 KiB outright, so both sit under a
 * ceiling that already exists.
 */
export const HIGHLIGHT_MAX_BYTES = 64 * 1024;
export const HIGHLIGHT_MAX_LINES = 2_000;

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

function plainLines(text: string): CodeLine[] {
  return text.split('\n').map((line) => ({
    spans: line ? [{ text: line, role: 'plain' as TokenRole }] : [],
  }));
}
