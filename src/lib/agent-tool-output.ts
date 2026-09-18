import { asRecord, type FileDiffItem, type ToolContent } from './agent-protocol';

/**
 * What a tool call is, and what is worth showing of what it said.
 *
 * Pure, so it can be tested: the component that draws a tool card decides
 * nothing here, it only picks a body. Two limits run through the whole module
 * and are the reason it exists at all.
 *
 * **A byte cap.** The gateway already cuts a tool result at 64 KiB and says
 * `truncated: true`, but a *local* `JSON.stringify(value, null, 2)` of a
 * megabyte of MCP output is not covered by that and used to land in a single
 * `<Text>`. Everything that can produce a string here goes through the same
 * cap and reports whether it bit.
 *
 * **A depth cap.** `parseToolOutput` unwraps the shapes OpenCode and MCP
 * servers put results in -- `{output: "…"}`, `{content: [...]}`, `{text: "…"}`
 * -- and those can nest. It used to recurse with no guard at all.
 */

/** What the gateway keeps per call, and therefore the most we can be handed. */
export const TOOL_OUTPUT_BYTE_CAP = 64 * 1024;

/** How far `parseToolOutput` will unwrap before it gives up and shows what it has. */
export const TOOL_OUTPUT_MAX_DEPTH = 6;

/** How deep a pretty-printed input is drawn before it collapses to a marker. */
export const TOOL_INPUT_MAX_DEPTH = 5;

/** Lines of output a card draws before it offers the rest. */
export const TOOL_OUTPUT_MAX_LINES = 20;

export interface CappedText {
  text: string;
  /** Whether the cap bit, which is what the badge is drawn from. */
  truncated: boolean;
}

/**
 * At most `limit` characters.
 *
 * Characters rather than bytes: JavaScript strings are counted in UTF-16 code
 * units and slicing by byte would cut a surrogate pair in half, which is a
 * replacement character in the middle of the reader's output. The cap is a
 * budget, not a measurement, so the cheaper unit is the right one.
 */
export function capText(text: string, limit: number = TOOL_OUTPUT_BYTE_CAP): CappedText {
  if (typeof text !== 'string') return { text: '', truncated: false };
  if (text.length <= limit) return { text, truncated: false };
  return { text: text.slice(0, limit), truncated: true };
}

export interface CappedLines {
  text: string;
  /** How many lines were held back. */
  hidden: number;
}

/** The first `limit` lines, and a count of the rest. */
export function capLines(text: string, limit: number = TOOL_OUTPUT_MAX_LINES): CappedLines {
  if (!text) return { text: '', hidden: 0 };
  const lines = text.split('\n');
  if (lines.length <= limit) return { text, hidden: 0 };
  return { text: lines.slice(0, limit).join('\n'), hidden: lines.length - limit };
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * The tool families OpenCode 2.0.1 ships, plus a bucket for MCP additions.
 *
 * The advertised set is agent- and config-dependent -- a `build` session lists
 * twelve tools, an `explore` session fewer, and an MCP server adds whatever it
 * likes -- so an unrecognised name is a first-class case with a card of its
 * own, never a reason to render raw JSON.
 */
export type ToolKind =
  | 'shell'
  | 'read'
  | 'edit'
  | 'write'
  | 'patch'
  | 'glob'
  | 'grep'
  | 'search'
  | 'web'
  | 'subagent'
  | 'skill'
  | 'todo'
  | 'question'
  | 'execute'
  | 'browser'
  | 'mcp';

export function classifyTool(name: string): ToolKind {
  const n = (name ?? '').toLowerCase();
  if (n === 'shell' || n === 'bash' || n === 'terminal' || n === 'run') return 'shell';
  if (n === 'read' || n === 'list' || n === 'cat') return 'read';
  if (n === 'edit' || n === 'multiedit' || n === 'str_replace' || n === 'str_replace_editor') {
    return 'edit';
  }
  if (n === 'write' || n === 'create' || n === 'new_file') return 'write';
  if (n === 'patch' || n === 'apply_patch') return 'patch';
  if (n === 'glob' || n === 'find') return 'glob';
  if (n === 'grep' || n === 'ripgrep') return 'grep';
  if (n === 'search' || n === 'codesearch') return 'search';
  if (n === 'webfetch' || n === 'fetch' || n === 'websearch' || n === 'web_search') return 'web';
  // The tool is named `subagent`; `task` is accepted as an alias.
  if (n === 'subagent' || n === 'task' || n === 'spawn' || n === 'agent') return 'subagent';
  if (n === 'skill' || n === 'load_skill') return 'skill';
  // Only `todowrite`/`todo`/`tasks` become a checklist; `subagent` is a tool
  // row, whatever it is called.
  if (n === 'todowrite' || n === 'todoread' || n === 'todo' || n === 'tasks') return 'todo';
  if (n === 'question' || n === 'ask') return 'question';
  if (n === 'execute' || n === 'code') return 'execute';
  if (n === 'browser') return 'browser';
  return 'mcp';
}

function pickString(rec: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = rec[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

const PATH_KEYS = ['path', 'filePath', 'file_path', 'file'] as const;

/**
 * A tool's input, or `null` when it is still streaming.
 *
 * In `streaming` state OpenCode's `input` is a **partial JSON string**, and
 * everywhere else it is an object. Parsing it defensively is the difference
 * between a card that fills in as the input arrives and a card that throws on
 * the first frame.
 */
export function toolInputRecord(input: unknown): Record<string, unknown> | null {
  const direct = asRecord(input);
  if (direct) return direct;
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    return asRecord(JSON.parse(trimmed));
  } catch {
    // A partial object is not yet an object -- but the part of it that has
    // arrived is still an answer to "what is this call pointed at". The
    // half-written *payload* never reaches a header; the values pulled out of
    // it do, so a shell card fills in its command as the command streams.
    const partial = partialJsonStrings(trimmed);
    return Object.keys(partial).length > 0 ? partial : null;
  }
}

/**
 * The string fields a half-written JSON object has got to so far.
 *
 * A scanner rather than a parser: `JSON.parse` is all-or-nothing and the input
 * here is by definition not valid JSON yet. It walks the text once, takes
 * every `"key": "value"` pair it completes, and takes the last value even when
 * its closing quote has not arrived -- which is the interesting one, because
 * that is the argument currently being written. Escapes are honoured so a
 * command containing `\"` does not end a value early, and anything that is not
 * a string value is skipped rather than guessed at.
 *
 * It never throws and it never loops unboundedly: every branch consumes at
 * least one character.
 */
export function partialJsonStrings(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  let index = 0;

  /** The string starting at `index`, and whether it was closed. */
  const readString = (): { value: string; closed: boolean } => {
    index += 1; // the opening quote
    let value = '';
    while (index < text.length) {
      const char = text[index];
      if (char === '\\') {
        const next = text[index + 1];
        if (next === undefined) {
          index += 1;
          return { value, closed: false };
        }
        value += next === 'n' ? '\n' : next === 't' ? '\t' : next;
        index += 2;
        continue;
      }
      if (char === '"') {
        index += 1;
        return { value, closed: true };
      }
      value += char;
      index += 1;
    }
    return { value, closed: false };
  };

  while (index < text.length) {
    if (text[index] !== '"') {
      index += 1;
      continue;
    }
    const key = readString();
    if (!key.closed) break;
    // Past the colon, if it has arrived.
    while (index < text.length && (text[index] === ' ' || text[index] === '\t')) index += 1;
    if (text[index] !== ':') continue;
    index += 1;
    while (index < text.length && (text[index] === ' ' || text[index] === '\t')) index += 1;
    if (index >= text.length) break;
    if (text[index] !== '"') {
      // A number, a boolean, an object, a list: not something a header draws,
      // and not something to guess at half-written. Skip to the next comma at
      // this level, or give up if the object has not got that far.
      const comma = text.indexOf(',', index);
      if (comma < 0) break;
      index = comma + 1;
      continue;
    }
    const value = readString();
    if (key.value) out[key.value] = value.value;
    if (!value.closed) break;
  }

  return out;
}

/** The one-line target a tool is pointed at: the path, the pattern, the URL… */
export function extractTarget(kind: ToolKind, input: unknown): string {
  const rec = toolInputRecord(input);
  // Nothing readable yet -- not even a key. While a tool is `streaming` its
  // input is a *partial JSON string*, and what is drawn from it is the value
  // (`git sta`), never the payload around it (`{"command": "git sta`): the
  // protocol's own half-written text in a card's title is not a title.
  if (!rec) return '';
  switch (kind) {
    case 'shell':
      return pickString(rec, ['command', 'cmd']) ?? '';
    case 'read':
    case 'edit':
    case 'write':
      return pickString(rec, PATH_KEYS) ?? '';
    case 'patch': {
      const text = pickString(rec, ['patchText', 'patch_text', 'patch']);
      return text ? (parsePatchSections(text)[0]?.path ?? '') : '';
    }
    case 'glob':
    case 'grep':
    case 'search':
      return pickString(rec, ['pattern', 'query', 'literal']) ?? '';
    case 'web':
      return pickString(rec, ['url', 'query']) ?? '';
    case 'subagent':
      return (
        pickString(rec, ['description']) ??
        pickString(rec, ['agent', 'agentID', 'agent_id', 'subagent']) ??
        pickString(rec, ['prompt'])?.split('\n')[0] ??
        ''
      );
    case 'skill':
      return pickString(rec, ['id', 'skillID', 'skill_id', 'skillId', 'skill']) ?? '';
    case 'question': {
      // The tool asks with `questions[]`, and each entry carries its own short
      // `header` -- "Approach", "Scope" -- which is exactly the one line a
      // header wants. The question itself is prose and belongs in the body.
      const first = parseToolQuestions(rec)[0];
      return first ? first.header || first.question : '';
    }
    case 'execute':
      return firstLineOf(pickString(rec, ['code']) ?? '');
    case 'browser':
      return pickString(rec, ['url', 'action', 'tabID']) ?? '';
    default:
      return (
        pickString(rec, ['command', 'cmd', ...PATH_KEYS, 'query', 'url', 'pattern', 'name']) ?? ''
      );
  }
}

/** The second line under the target: where it happened, if that is not the target. */
export function extractCaption(kind: ToolKind, input: unknown): string {
  const rec = toolInputRecord(input);
  if (!rec) return '';
  switch (kind) {
    case 'read':
    case 'edit':
    case 'write':
      // The title is the basename, so the caption is the rest of the path.
      return pickString(rec, PATH_KEYS) ?? '';
    case 'glob':
    case 'grep':
    case 'search':
      return pickString(rec, [...PATH_KEYS, 'include', 'directory']) ?? '';
    case 'shell':
      return pickString(rec, ['workdir', 'cwd']) ?? '';
    case 'subagent':
      return pickString(rec, ['agent', 'agentID', 'agent_id']) ?? '';
    case 'web':
      return pickString(rec, ['url']) === undefined ? '' : (pickString(rec, ['query']) ?? '');
    default:
      return '';
  }
}

/** The last path segment, which is what identifies a file on a phone. */
/**
 * The folder a path is in, as the caption under a file name.
 *
 * The caption used to be the whole path, which already had its basename in the
 * title above it: the same long name, truncated twice, in two directions.
 */
export function dirname(path: string): string {
  if (!path) return '';
  const cut = path.lastIndexOf('/');
  if (cut < 0) return '';
  if (cut === 0) return '/';
  return path.slice(0, cut);
}

export function basename(path: string): string {
  if (!path) return '';
  const parts = path.split('/').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

function firstLineOf(text: string): string {
  const index = text.indexOf('\n');
  return index < 0 ? text : text.slice(0, index);
}

// ---------------------------------------------------------------------------
// Syntax highlighting
// ---------------------------------------------------------------------------

/**
 * Fence language for a file path, when the markdown renderer has a grammar.
 *
 * Only the nineteen tree-sitter grammars vendored into the native binary are
 * worth naming: a fence whose language has no grammar is drawn as plain code,
 * which is what an unknown extension should get anyway.
 */
const LANG_BY_EXT: Readonly<Record<string, string>> = {
  ts: 'typescript',
  tsx: 'tsx',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  jsonc: 'json',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'css',
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'markdown',
  yml: 'yaml',
  yaml: 'yaml',
  go: 'go',
  java: 'java',
  py: 'python',
  pyi: 'python',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  rs: 'rust',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  swift: 'swift',
  php: 'php',
  rb: 'ruby',
  cs: 'c-sharp',
};

export function fenceLanguageForPath(path?: string): string | undefined {
  if (!path) return undefined;
  const name = basename(path);
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return undefined;
  return LANG_BY_EXT[name.slice(dot + 1).toLowerCase()];
}

/** A fenced code block for the markdown renderer, capped. */
export function fencedCode(body: string, language?: string): CappedText {
  const capped = capText(body);
  return {
    text: `\`\`\`${language ?? ''}\n${capped.text}\n\`\`\``,
    truncated: capped.truncated,
  };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface ParsedToolOutput {
  stdout: string;
  exitCode?: number;
  truncated: boolean;
}

const EXIT_LINE = /Command exited with code (-?\d+)/i;

/**
 * Whatever the tool said, as text, with the exit line lifted out.
 *
 * OpenCode's `shell` answers with two content items -- stdout, then "Command
 * exited with code 0." -- so the code is pulled out and shown as a chip rather
 * than left as a sentence at the bottom of the output. Everything else is
 * unwrapped until it is a string, with `depth` bounding how far that goes.
 */
export function parseToolOutput(raw: unknown, depth = 0): ParsedToolOutput {
  if (raw === null || raw === undefined) return { stdout: '', truncated: false };
  if (depth >= TOOL_OUTPUT_MAX_DEPTH) {
    // As deep as this goes. Whatever is left is shown as it is rather than
    // unwrapped further, and the badge says the reading is partial.
    return { stdout: capText(safeStringify(raw, 1)).text, truncated: true };
  }

  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (
      (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
      (trimmed.startsWith('{') && trimmed.endsWith('}'))
    ) {
      try {
        return parseToolOutput(JSON.parse(trimmed), depth + 1);
      } catch {
        // Not JSON after all; it is the output.
      }
    }
    const capped = capText(raw);
    const exit = EXIT_LINE.exec(capped.text);
    return exit
      ? {
          stdout: capped.text
            .replace(exit[0], '')
            .replace(/\.\s*$/, '')
            .trimEnd(),
          exitCode: Number(exit[1]),
          truncated: capped.truncated,
        }
      : { stdout: capped.text, truncated: capped.truncated };
  }

  if (Array.isArray(raw)) {
    let stdout = '';
    let exitCode: number | undefined;
    let truncated = false;
    for (const item of raw) {
      const rec = asRecord(item);
      const text =
        typeof item === 'string' ? item : rec && typeof rec.text === 'string' ? rec.text : '';
      if (!text) continue;
      const exit = EXIT_LINE.exec(text);
      if (exit) {
        exitCode = Number(exit[1]);
        continue;
      }
      stdout = stdout ? `${stdout}\n${text}` : text;
      if (stdout.length > TOOL_OUTPUT_BYTE_CAP) {
        stdout = stdout.slice(0, TOOL_OUTPUT_BYTE_CAP);
        truncated = true;
        break;
      }
    }
    return { stdout, ...(exitCode === undefined ? {} : { exitCode }), truncated };
  }

  const rec = asRecord(raw);
  if (rec) {
    if (typeof rec.stdout === 'string') {
      const capped = capText(rec.stdout);
      const exitCode =
        typeof rec.exitCode === 'number'
          ? rec.exitCode
          : typeof rec.exit === 'number'
            ? rec.exit
            : undefined;
      return {
        stdout: capped.text,
        ...(exitCode === undefined ? {} : { exitCode }),
        truncated: capped.truncated,
      };
    }
    // Any shape, not only a string: `{output: {output: {…}}}` is exactly the
    // nesting the depth cap exists for, and a type check here would have meant
    // it was never reached.
    if (rec.output !== undefined) return parseToolOutput(rec.output, depth + 1);
    if (Array.isArray(rec.content)) return parseToolOutput(rec.content, depth + 1);
    if (rec.text !== undefined) return parseToolOutput(rec.text, depth + 1);
    const pretty = prettyJson(raw);
    return { stdout: pretty.text, truncated: pretty.truncated };
  }

  return { stdout: String(raw), truncated: false };
}

/** The text items of `content[]`, joined. `output` is the same thing flattened. */
export function textFromContent(content: readonly ToolContent[]): string {
  const parts: string[] = [];
  for (const item of content) {
    if (item.type === 'text' && item.text) parts.push(item.text);
  }
  return parts.join('\n');
}

/** The file items of `content[]`: images and PDFs a tool returned. */
export function filesFromContent(
  content: readonly ToolContent[]
): Extract<ToolContent, { type: 'file' }>[] {
  return content.filter(
    (item): item is Extract<ToolContent, { type: 'file' }> => item.type === 'file'
  );
}

// ---------------------------------------------------------------------------
// Pretty JSON, bounded in both directions
// ---------------------------------------------------------------------------

/**
 * A value as readable JSON, capped by depth and then by length.
 *
 * `JSON.stringify(value, null, 2)` on an MCP result that happens to embed a
 * base64 image is megabytes of string in one `<Text>`. Depth is bounded first
 * because that is what makes a deep object cheap to format at all, and the byte
 * cap then bounds the breadth.
 */
export function prettyJson(value: unknown, maxDepth = TOOL_INPUT_MAX_DEPTH): CappedText {
  const capped = capText(safeStringify(value, maxDepth));
  return capped;
}

function safeStringify(value: unknown, maxDepth: number): string {
  const seen = new WeakSet<object>();
  const walk = (input: unknown, depth: number): unknown => {
    if (input === null || typeof input !== 'object') return input;
    if (seen.has(input)) return '[circular]';
    if (depth >= maxDepth) return Array.isArray(input) ? '[…]' : '{…}';
    seen.add(input);
    if (Array.isArray(input)) return input.map((entry) => walk(entry, depth + 1));
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(input as Record<string, unknown>)) {
      out[key] = walk(entry, depth + 1);
    }
    return out;
  };
  try {
    return JSON.stringify(walk(value, 0), null, 2) ?? String(value);
  } catch {
    // A getter that throws, a BigInt, a value `JSON` refuses: whatever it is,
    // a tool card is not the place to find out about it.
    return String(value);
  }
}

/** How long the argument line under a streaming header is allowed to get. */
export const TOOL_ARGUMENT_LINE_CAP = 240;

/**
 * The arguments a call is being made with, on one line.
 *
 * Drawn under the header while the input is still arriving. The header's title
 * is one line shared with the tool name and clipped in the middle, which is
 * the wrong shape for a command being typed out a token at a time; this line
 * is monospace, wraps, and holds every argument that has landed. `key value`
 * pairs rather than JSON, because this is the one place the payload's own
 * punctuation would read as the payload.
 */
export function toolArgumentLine(rec: Record<string, unknown> | null): string {
  if (!rec) return '';
  const parts: string[] = [];
  for (const [key, value] of Object.entries(rec)) {
    const text =
      typeof value === 'string'
        ? value
        : typeof value === 'number' || typeof value === 'boolean'
          ? String(value)
          : '';
    if (!text) continue;
    parts.push(`${key} ${text}`);
    if (parts.join('  ').length >= TOOL_ARGUMENT_LINE_CAP) break;
  }
  const line = parts.join('  ');
  return line.length > TOOL_ARGUMENT_LINE_CAP ? line.slice(0, TOOL_ARGUMENT_LINE_CAP) : line;
}

// ---------------------------------------------------------------------------
// `question`
// ---------------------------------------------------------------------------

/** One choice offered for a question, as OpenCode words it. */
export interface ToolQuestionOption {
  label: string;
  /** The line under the label, when the agent wrote one. */
  description?: string;
}

/**
 * One question of a `question` call.
 *
 * The input is `{questions: [{question, header, options, multiple?}]}` -- the
 * plural is the whole shape, and the card used to read `input.question` and
 * `input.prompt`, neither of which the tool has ever sent. `header` is the
 * short label the agent puts above the question; `question` is the prose.
 */
export interface ToolQuestion {
  header: string;
  question: string;
  options: ToolQuestionOption[];
  /** More than one option may be picked; the answer is then a list. */
  multiple: boolean;
}

/** How many questions and options a card draws before it stops. */
export const QUESTION_MAX = 6;
export const QUESTION_OPTION_MAX = 8;

export function parseToolQuestions(input: unknown): ToolQuestion[] {
  const rec = toolInputRecord(input);
  if (!rec || !Array.isArray(rec.questions)) return [];
  const out: ToolQuestion[] = [];
  for (const entry of rec.questions) {
    const question = asRecord(entry);
    if (!question) continue;
    const text = pickString(question, ['question', 'prompt', 'text']) ?? '';
    const header = pickString(question, ['header', 'title', 'label']) ?? '';
    if (!text && !header) continue;
    const options: ToolQuestionOption[] = [];
    if (Array.isArray(question.options)) {
      for (const raw of question.options) {
        if (typeof raw === 'string') {
          if (raw) options.push({ label: raw });
          continue;
        }
        const option = asRecord(raw);
        if (!option) continue;
        const label = pickString(option, ['label', 'value', 'title']);
        if (!label) continue;
        const description = pickString(option, ['description', 'detail', 'hint']);
        options.push({ label, ...(description ? { description } : {}) });
      }
    }
    out.push({ header, question: text, options, multiple: question.multiple === true });
  }
  return out;
}

/**
 * What was answered, per question, as `metadata.answers` states it.
 *
 * `string[][]`: one list per question, because a `multiple` question is
 * answered with several of its options. A payload that sent one string per
 * question rather than a list is read as a list of one.
 */
export function questionAnswersFromMetadata(metadata: Record<string, unknown>): string[][] {
  const raw = metadata.answers;
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    if (typeof entry === 'string') return entry ? [entry] : [];
    if (!Array.isArray(entry)) return [];
    return entry.filter((value): value is string => typeof value === 'string' && value.length > 0);
  });
}

// ---------------------------------------------------------------------------
// Per-tool readings of `metadata`
// ---------------------------------------------------------------------------

/**
 * The ready-to-render unified diffs an `edit` carries.
 *
 * `metadata.files` is `FileDiff.Info[]` -- `{file, patch, additions,
 * deletions, status}` -- and is the single highest-value hook in the whole
 * tool protocol: a real diff card for every edit with no extra request.
 */
export function editFilesFromMetadata(metadata: Record<string, unknown>): FileDiffItem[] {
  const raw = metadata.files;
  if (!Array.isArray(raw)) return [];
  const out: FileDiffItem[] = [];
  for (const entry of raw) {
    const rec = asRecord(entry);
    if (!rec) continue;
    const path = pickString(rec, ['file', 'path', 'filePath', 'file_path']);
    const patch =
      typeof rec.patch === 'string' ? rec.patch : typeof rec.diff === 'string' ? rec.diff : '';
    if (!path || !patch) continue;
    // `FileDiff.Info.status` -- added, modified, deleted -- is what OpenCode
    // says happened. Dropping it left every row to be classified by reading
    // the patch header, and a modified file whose patch covers the whole file
    // read as "Added".
    const status = pickString(rec, ['status', 'change', 'change_type', 'changeType']);
    out.push({
      path,
      patch,
      additions: typeof rec.additions === 'number' ? rec.additions : 0,
      deletions: typeof rec.deletions === 'number' ? rec.deletions : 0,
      ...(status ? { status } : {}),
    });
  }
  return out;
}

/**
 * The diffs any payload carries, however it carries them.
 *
 * `edit` and `write` answer with `metadata.files`; `patch` answers with that
 * *and* a flat `{filepath, diff}` pair, and a permission ask for any of the
 * three carries whichever the tool would have returned. One reading, so a
 * permission card and a tool card cannot show two different diffs for the same
 * change.
 */
export function diffFilesFromMetadata(metadata: Record<string, unknown>): FileDiffItem[] {
  const files = editFilesFromMetadata(metadata);
  if (files.length > 0) return files;
  const patch = pickString(metadata, ['diff', 'patch']);
  if (!patch) return [];
  const path = pickString(metadata, ['filepath', 'filePath', 'file', 'path', 'file_path']) ?? '';
  return [
    {
      path,
      patch,
      additions: countMarkedLines(patch, '+'),
      deletions: countMarkedLines(patch, '-'),
    },
  ];
}

/** Added or removed lines of a patch, not counting its `+++`/`---` headers. */
function countMarkedLines(patch: string, marker: '+' | '-'): number {
  const header = marker.repeat(3);
  let count = 0;
  for (const line of patch.split('\n')) {
    if (line.startsWith(marker) && !line.startsWith(header)) count += 1;
  }
  return count;
}

/**
 * What a skill actually is, rather than the id it was asked for by.
 *
 * `metadata.name` is the skill's own name and `metadata.directory` is where it
 * was loaded from. The header used to show `input.id` -- `pdf`, `docx` -- and
 * nothing else, which named the file and not the thing.
 */
export function skillNameFromMetadata(metadata: Record<string, unknown>): string {
  return pickString(metadata, ['name', 'title']) ?? '';
}

export function skillDirectoryFromMetadata(metadata: Record<string, unknown>): string {
  return pickString(metadata, ['directory', 'dir', 'path']) ?? '';
}

/** The content type a `webfetch` got back, for the chip beside the host. */
export function contentTypeFromMetadata(metadata: Record<string, unknown>): string {
  const raw = pickString(metadata, ['contentType', 'content_type', 'mime']);
  if (!raw) return '';
  // `text/html; charset=utf-8` is a header value; the chip wants the type.
  return raw.split(';')[0].trim();
}

/** Who answered a `websearch`; OpenCode sends it on progress and on success. */
export function searchProviderFromMetadata(metadata: Record<string, unknown>): string {
  return pickString(metadata, ['provider', 'engine']) ?? '';
}

/** A URL split for a header: the host identifies it, the path says which page. */
export function splitUrl(url: string): { host: string; path: string } {
  const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)([^#]*)/i.exec(url.trim());
  if (!match) return { host: '', path: '' };
  const host = match[1].replace(/^www\./i, '');
  const path = match[2] === '/' ? '' : match[2];
  return { host, path };
}

/** The exit status a `shell` reports in its own metadata. */
export function shellExitFromMetadata(metadata: Record<string, unknown>): number | undefined {
  return typeof metadata.exit === 'number' ? metadata.exit : undefined;
}

/** A subagent's own progress, which runs independently of the tool's state. */
export function subagentStatusFromMetadata(metadata: Record<string, unknown>): string | undefined {
  return typeof metadata.status === 'string' ? metadata.status : undefined;
}

/** How many things a search found, as the tool counted them. */
export function resultCountFromMetadata(metadata: Record<string, unknown>): number | undefined {
  for (const key of ['count', 'matches', 'results', 'total']) {
    const value = metadata[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

/** How a call Code Mode made ended, as OpenCode reports it. */
export type ExecuteCallStatus = 'running' | 'completed' | 'error';

/** One call the sandboxed code made, from `metadata.toolCalls`. */
export interface ExecuteToolCall {
  name: string;
  status: ExecuteCallStatus;
  /** What it was called with, when the payload said; a header line, not a body. */
  input?: string;
}

function parseExecuteCallStatus(value: unknown): ExecuteCallStatus {
  const raw = typeof value === 'string' ? value.toLowerCase() : '';
  if (raw === 'error' || raw === 'failed' || raw === 'rejected') return 'error';
  if (raw === 'running' || raw === 'pending' || raw === 'started') return 'running';
  return 'completed';
}

/**
 * The calls Code Mode made, with how each one went.
 *
 * `metadata.toolCalls` is `{tool, status, input?}` per entry and the app kept
 * only the names, joined into one grey line -- so a `read` that failed inside
 * the sandbox and a `read` that worked were the same three letters. The
 * progress event streams this list live, which is why `running` is a status a
 * card has to be able to draw rather than an impossible one.
 */
export function executeToolCalls(metadata: Record<string, unknown>): ExecuteToolCall[] {
  const raw = metadata.toolCalls ?? metadata.tool_calls;
  if (!Array.isArray(raw)) return [];
  const out: ExecuteToolCall[] = [];
  for (const entry of raw) {
    if (typeof entry === 'string') {
      if (entry) out.push({ name: entry, status: 'completed' });
      continue;
    }
    const rec = asRecord(entry);
    if (!rec) continue;
    const name = pickString(rec, ['tool', 'name', 'id']);
    if (!name) continue;
    const input = executeCallInput(rec.input);
    out.push({
      name,
      status: parseExecuteCallStatus(rec.status),
      ...(input ? { input } : {}),
    });
  }
  return out;
}

/** A call's argument as one line: the string it is, or the shape it has. */
function executeCallInput(value: unknown): string {
  if (typeof value === 'string') return firstLineOf(value).slice(0, 120);
  const rec = asRecord(value);
  if (!rec) return '';
  const line = toolArgumentLine(rec);
  return line.slice(0, 120);
}

/** Whether the sandboxed code itself threw, which is not the tool failing. */
export function executeErrored(metadata: Record<string, unknown>): boolean {
  return metadata.error === true;
}

// ---------------------------------------------------------------------------
// The subagent envelope
// ---------------------------------------------------------------------------

const SUBAGENT_OPEN = /<subagent\s+([^>]*)>/i;

export interface SubagentResult {
  /** The result with the envelope taken off. */
  text: string;
  sessionId?: string;
  state?: string;
}

/**
 * A subagent's result, unwrapped.
 *
 * OpenCode wraps it in `<subagent sessionID="ses_…" state="completed">…
 * </subagent>`. Showing that to a reader is showing them the protocol; the
 * `sessionID` in it is also a usable fallback for the deep link when the
 * metadata did not carry one.
 */
export function stripSubagentEnvelope(raw: string): SubagentResult {
  if (!raw) return { text: '' };
  const open = SUBAGENT_OPEN.exec(raw);
  if (!open) return { text: raw };
  const attributes = open[1];
  const sessionId = /sessionID\s*=\s*"([^"]+)"/i.exec(attributes)?.[1];
  const state = /state\s*=\s*"([^"]+)"/i.exec(attributes)?.[1];
  const bodyStart = open.index + open[0].length;
  const close = raw.toLowerCase().lastIndexOf('</subagent>');
  const body = close > bodyStart ? raw.slice(bodyStart, close) : raw.slice(bodyStart);
  return {
    text: body.trim(),
    ...(sessionId ? { sessionId } : {}),
    ...(state ? { state } : {}),
  };
}

// ---------------------------------------------------------------------------
// `apply_patch` sections
// ---------------------------------------------------------------------------

export type PatchAction = 'add' | 'update' | 'delete' | 'move';

export interface PatchSection {
  action: PatchAction;
  path: string;
  /** The section's body, in the `+`/`-`/space shape a diff row reads. */
  patch: string;
}

const PATCH_HEADER = /^\*\*\*\s+(Add|Update|Delete|Move)\s+File:\s*(.+?)\s*$/i;

/**
 * `apply_patch`'s own format, as per-file patches.
 *
 * The tool takes one `patchText` holding `*** Add File: a`, `*** Update File:
 * b` and so on, which is not a unified diff and does not render as one. Split
 * into sections it is: each body is already marker-prefixed, so a synthetic
 * `@@` header is all a diff row needs to number it.
 */
export function parsePatchSections(patchText: string): PatchSection[] {
  if (!patchText) return [];
  const sections: PatchSection[] = [];
  let current: { action: PatchAction; path: string; lines: string[] } | null = null;

  const flush = () => {
    if (!current) return;
    const body = current.lines.join('\n').replace(/\s+$/, '');
    sections.push({
      action: current.action,
      path: current.path,
      patch: body ? `@@ ${current.path} @@\n${body}` : '',
    });
    current = null;
  };

  for (const line of patchText.split('\n')) {
    const header = PATCH_HEADER.exec(line);
    if (header) {
      flush();
      current = {
        action: header[1].toLowerCase() as PatchAction,
        path: header[2],
        lines: [],
      };
      continue;
    }
    if (line.startsWith('*** ')) {
      // `*** Begin Patch` / `*** End Patch` and anything else the format grows.
      if (/^\*\*\*\s+End Patch/i.test(line)) flush();
      continue;
    }
    if (current) current.lines.push(line);
  }
  flush();
  return sections;
}

// ---------------------------------------------------------------------------
// grep output
// ---------------------------------------------------------------------------

export interface GrepFileMatches {
  file: string;
  lines: { line: number | null; text: string }[];
}

const GREP_FILE = /^(\S.*):$/;
const GREP_LINE = /^\s+Line (\d+):\s?(.*)$/;
const GREP_INLINE = /^(.+?):(\d+):(.*)$/;

/**
 * `grep`'s output, grouped by file.
 *
 * OpenCode prints `Found N matches`, then a file path on its own line, then
 * indented `Line 12: …` rows. Some MCP greps print `path:12:text` instead, so
 * both are read. A line that is neither is kept as a match with no number
 * rather than dropped, because the reader asked to see the matches.
 */
export function groupGrepMatches(output: string): GrepFileMatches[] {
  if (!output) return [];
  const groups: GrepFileMatches[] = [];
  let current: GrepFileMatches | null = null;

  for (const raw of output.split('\n')) {
    if (!raw.trim()) continue;
    if (/^Found \d+ match/i.test(raw)) continue;

    const indented = GREP_LINE.exec(raw);
    if (indented && current) {
      current.lines.push({ line: Number(indented[1]), text: indented[2] });
      continue;
    }

    const inline = GREP_INLINE.exec(raw);
    if (inline && !raw.startsWith(' ')) {
      if (!current || current.file !== inline[1]) {
        current = { file: inline[1], lines: [] };
        groups.push(current);
      }
      current.lines.push({ line: Number(inline[2]), text: inline[3] });
      continue;
    }

    const fileHeader = GREP_FILE.exec(raw);
    if (fileHeader) {
      current = { file: fileHeader[1], lines: [] };
      groups.push(current);
      continue;
    }

    if (current) current.lines.push({ line: null, text: raw.trim() });
  }

  return groups;
}

/** `read` prefixes every line with its number; the fence should not repeat it. */
export function stripReadLineNumbers(output: string): string {
  if (!output) return '';
  const lines = output.split('\n');
  // `read` prints its own header first. Its presence is what makes the rest
  // numbering rather than content -- a file whose own text happens to have
  // "12: something" on one line is not a numbered listing, and stripping that
  // line's prefix would silently edit what the reader is looking at.
  const hasHeader = lines[0]?.startsWith('Read file ') === true;
  const body = hasHeader ? lines.slice(1) : lines;
  const numbering = /^\s*(\d+):\s?(.*)$/;
  if (!hasHeader) {
    const meaningful = body.filter((line) => line.trim().length > 0);
    if (meaningful.length === 0 || !meaningful.every((line) => numbering.test(line))) {
      return output;
    }
  }
  return body.map((line) => numbering.exec(line)?.[2] ?? line).join('\n');
}
