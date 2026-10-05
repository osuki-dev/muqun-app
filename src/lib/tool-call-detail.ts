import { isDeclinedByUser } from './agent-engine-text';
import { asRecord, toolDurationMs, type ToolPart } from './agent-protocol';
import {
  classifyTool,
  executeErrored,
  shellExitFromMetadata,
  shellTimedOutFromMetadata,
  textFromContent,
} from './agent-tool-output';
import { cellsOf } from './diff-geometry';
import { indexTextLines } from './text-preview';

/**
 * One tool call, read whole: what it was asked, what it answered, how it ended.
 *
 * The transcript's card is a summary -- a header, a capped body, twenty lines
 * of output before "show more". This is the other half, the sheet a tap on that
 * header opens, and it shows the call as it is: the input pretty-printed, every
 * line of the output, and the way it ended said in words and in colour.
 *
 * Pure, so that the questions that decide what the sheet says -- did it fail,
 * was it stopped, is it still running, how long did it take, is the output too
 * big to read here -- are tested rather than read off a component.
 */

/** How the call ended, or that it has not. */
export type ToolCallStatus = 'running' | 'completed' | 'failed' | 'cancelled';

/** The grammar a section is coloured with. See `code-tokens.ts`. */
export type ToolCallLanguage = 'json' | 'shell' | 'code' | 'plain';

export interface ToolCallSection {
  /** The text the copy action copies: exactly what is drawn, every line. */
  text: string;
  lines: readonly string[];
  /** Character cells in the widest line, for the panning content's width. */
  widest: number;
  language: ToolCallLanguage;
}

export interface ToolCallDetail {
  id: string;
  name: string;
  /** The gateway's one-line summary of the call, when it derived one. */
  title?: string;
  status: ToolCallStatus;
  /** When the call started, for a running call's live clock. */
  startedAt?: number;
  /** How long it took, once it has finished and both ends are known. */
  durationMs?: number;
  /** `null` when the call carried no input at all. */
  input: ToolCallSection | null;
  /** The input is still arriving: what is drawn is a prefix. */
  inputStreaming: boolean;
  /** `null` when the call said nothing. */
  output: ToolCallSection | null;
  /** The engine's own failure message, as it came. */
  error?: string;
  /** The failure was the reader declining the permission. */
  declined: boolean;
  exitCode?: number;
  timedOut: boolean;
  /** The output the reader sees was clipped by the engine or the gateway. */
  truncated: boolean;
  /** Where the engine saved the whole output, when it clipped it. */
  fullOutputPath?: string;
  /** Too big to be worth reading in a sheet; offer the file instead. */
  large: boolean;
}

/** Past this many lines the output is offered as a file. */
export const LARGE_OUTPUT_LINES = 2_000;
/** Past this many characters the output is offered as a file. */
export const LARGE_OUTPUT_CHARS = 200 * 1024;

/** `15ms`, `3.2s`, `42s`, `2m 04s`: the short form a status line takes. */
export function formatToolDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

/**
 * How long a running call has been running, never negative.
 *
 * `startedAt` is the gateway host's clock and `now` is the phone's; a host a
 * second ahead would otherwise open the sheet on `-0.8s`.
 */
export function runningElapsedMs(startedAt: number, now: number): number {
  return Math.max(0, now - startedAt);
}

/**
 * Whether a failure was the call being stopped rather than going wrong.
 *
 * OpenCode ends an interrupted call as an error like any other, named
 * `MessageAbortedError` or saying "aborted". Red for that is the app accusing
 * the tool of something the reader did.
 */
export function isCancellation(error: { name?: string; message?: string } | undefined): boolean {
  if (!error) return false;
  const name = (error.name ?? '').toLowerCase();
  if (name.includes('abort') || name.includes('cancel')) return true;
  return /^(the\s+)?(tool\s+(call|execution)\s+)?(was\s+)?(aborted|cancell?ed|interrupted)\b/i.test(
    (error.message ?? '').trim()
  );
}

const EXIT_LINE = /\n?\s*(?:Command e|E)xited with code (-?\d+)\.?\s*$/i;
const SAVED_TO = /Full output saved to:?\s+(\S+)/i;

/** Pretty JSON when `text` is a JSON object or list, otherwise `null`. */
function prettyJsonText(text: string): string | null {
  const trimmed = text.trim();
  const object = trimmed.startsWith('{') && trimmed.endsWith('}');
  const list = trimmed.startsWith('[') && trimmed.endsWith(']');
  if (!object && !list) return null;
  try {
    return stringify(JSON.parse(trimmed));
  } catch {
    return null;
  }
}

/** `JSON.stringify(value, null, 2)` that cannot throw and cannot loop. */
function stringify(value: unknown): string {
  const seen = new WeakSet<object>();
  try {
    return (
      JSON.stringify(
        value,
        (_key, entry: unknown) => {
          if (typeof entry === 'bigint') return entry.toString();
          if (entry && typeof entry === 'object') {
            if (seen.has(entry)) return '[circular]';
            seen.add(entry);
          }
          return entry;
        },
        2
      ) ?? String(value)
    );
  } catch {
    return String(value);
  }
}

function section(text: string, language: ToolCallLanguage): ToolCallSection {
  const { lines } = indexTextLines(text);
  let widest = 0;
  for (const line of lines) widest = Math.max(widest, cellsOf(line));
  return { text, lines, widest, language };
}

/** Whether an input says nothing: absent, `null`, `{}` or `[]`. */
function isEmptyInput(input: unknown): boolean {
  if (input === null || input === undefined || input === '') return true;
  if (Array.isArray(input)) return input.length === 0;
  const record = asRecord(input);
  return record !== null && Object.keys(record).length === 0;
}

/**
 * The input, drawn the way a reader thinks of the call.
 *
 * Code Mode's `execute` and a shell are both a program with arguments around
 * it, and the program is the thing worth reading: the TUI calls the section
 * "Code" and shows the code. Every other tool is its arguments, as JSON.
 */
function inputSection(part: ToolPart): { input: ToolCallSection | null; streaming: boolean } {
  const kind = classifyTool(part.name);
  const record = asRecord(part.input);
  if (!record && !Array.isArray(part.input) && part.input_partial) {
    // Half an object. Not parsed, not reformatted: what has arrived, as it is.
    return { input: section(part.input_partial, 'json'), streaming: true };
  }
  const streaming = part.state === 'pending' || part.state === 'streaming';
  if (isEmptyInput(part.input)) return { input: null, streaming };
  if (kind === 'execute' && typeof record?.code === 'string' && record.code) {
    return { input: section(record.code, 'code'), streaming };
  }
  if (kind === 'shell' && typeof record?.command === 'string' && record.command) {
    return { input: section(record.command, 'shell'), streaming };
  }
  if (typeof part.input === 'string') {
    const pretty = prettyJsonText(part.input);
    return {
      input: pretty ? section(pretty, 'json') : section(part.input, 'plain'),
      streaming,
    };
  }
  return { input: section(stringify(part.input), 'json'), streaming };
}

/** The result as text, with a trailing "Command exited with code N" lifted out. */
function outputText(part: ToolPart): { text: string; exitCode?: number } {
  const fromContent = textFromContent(part.content);
  const raw: unknown = fromContent || part.output;
  let text = '';
  if (typeof raw === 'string') text = raw;
  else if (Array.isArray(raw)) {
    text = raw
      .map((entry) => {
        if (typeof entry === 'string') return entry;
        const value = asRecord(entry)?.text;
        return typeof value === 'string' ? value : '';
      })
      .filter(Boolean)
      .join('\n');
  } else if (raw !== null && raw !== undefined) {
    const record = asRecord(raw);
    const inner = record?.stdout ?? record?.output ?? record?.text;
    text = typeof inner === 'string' ? inner : stringify(raw);
  }
  const exit = EXIT_LINE.exec(text);
  if (!exit) return { text };
  return { text: text.slice(0, exit.index).trimEnd(), exitCode: Number(exit[1]) };
}

/** Everything the detail sheet draws for `part`. */
export function toolCallDetail(part: ToolPart): ToolCallDetail {
  const kind = classifyTool(part.name);
  const { input, streaming } = inputSection(part);
  const { text: rawOutput, exitCode: printedExit } = outputText(part);
  const exitCode = shellExitFromMetadata(part.metadata) ?? printedExit;
  const timedOut = kind === 'shell' && shellTimedOutFromMetadata(part.metadata);

  const pretty = prettyJsonText(rawOutput);
  const output = rawOutput.trim() ? section(pretty ?? rawOutput, pretty ? 'json' : 'plain') : null;

  const declined = Boolean(part.error?.message && isDeclinedByUser(part.error.message));
  const pending =
    part.state === 'pending' || part.state === 'streaming' || part.state === 'running';
  let status: ToolCallStatus;
  if (part.state === 'failed') {
    status = !declined && isCancellation(part.error) ? 'cancelled' : 'failed';
  } else if (pending) {
    status = 'running';
  } else {
    // A call the engine says completed can still have gone wrong: a shell
    // that exited non-zero or was killed for time, or Code Mode whose code
    // threw. The engine ran the tool fine; the reader's command did not.
    const nonZero = kind === 'shell' && exitCode !== undefined && exitCode !== 0;
    status =
      nonZero || timedOut || (kind === 'execute' && executeErrored(part.metadata))
        ? 'failed'
        : 'completed';
  }

  const startedAt = part.time?.ran ?? part.time?.created;
  const durationMs =
    toolDurationMs(part.time) ??
    (part.time?.created !== undefined && part.time.completed !== undefined
      ? Math.max(0, part.time.completed - part.time.created)
      : undefined);

  const metadataPath = part.metadata.outputPath ?? part.metadata.output_path;
  const fullOutputPath =
    typeof metadataPath === 'string' && metadataPath
      ? metadataPath
      : (SAVED_TO.exec(rawOutput)?.[1] ?? undefined);

  const large =
    output !== null &&
    (output.lines.length > LARGE_OUTPUT_LINES || output.text.length > LARGE_OUTPUT_CHARS);

  return {
    id: part.id,
    name: part.name,
    ...(part.title ? { title: part.title } : {}),
    status,
    ...(status === 'running' && startedAt !== undefined ? { startedAt } : {}),
    ...(status !== 'running' && durationMs !== undefined ? { durationMs } : {}),
    input,
    inputStreaming: streaming,
    output,
    ...(part.error?.message ? { error: part.error.message } : {}),
    declined,
    ...(exitCode !== undefined ? { exitCode } : {}),
    timedOut,
    truncated: part.truncated === true,
    ...(fullOutputPath ? { fullOutputPath } : {}),
    large,
  };
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export type ToolCallSectionName = 'input' | 'output';

/**
 * One row of the sheet's list.
 *
 * Both sections are one list -- one vertical scroller, one horizontal pan --
 * so a heading, a numbered line and the space between sections are all rows.
 * `line` has the shape `gutterNumbersOf` reads, which is what sizes the gutter.
 */
export type ToolCallRow =
  | { type: 'heading'; key: string; section: ToolCallSectionName }
  | { type: 'edge'; key: string }
  | {
      type: 'line';
      key: string;
      section: ToolCallSectionName;
      newLine: number;
      text: string;
      language: ToolCallLanguage;
      /** Drawn in the danger colour: the output of a call that failed. */
      failed: boolean;
    }
  | { type: 'error'; key: string; text: string; declined: boolean }
  | { type: 'empty'; key: string; section: ToolCallSectionName }
  | { type: 'gap'; key: string };

function pushLines(
  rows: ToolCallRow[],
  name: ToolCallSectionName,
  body: ToolCallSection,
  failed: boolean
) {
  rows.push({ type: 'edge', key: `${name}-top` });
  body.lines.forEach((text, index) =>
    rows.push({
      type: 'line',
      key: `${name}-${index}`,
      section: name,
      newLine: index + 1,
      text,
      // A failure is read as one: red, not a syntax-coloured success.
      language: failed ? 'plain' : body.language,
      failed,
    })
  );
  rows.push({ type: 'edge', key: `${name}-bottom` });
}

/** The rows for `detail`, in order. */
export function toolCallRows(detail: ToolCallDetail): ToolCallRow[] {
  const rows: ToolCallRow[] = [{ type: 'heading', key: 'input-heading', section: 'input' }];
  if (detail.input) pushLines(rows, 'input', detail.input, false);
  else rows.push({ type: 'empty', key: 'input-empty', section: 'input' });

  rows.push({ type: 'gap', key: 'gap' });
  rows.push({ type: 'heading', key: 'output-heading', section: 'output' });
  const failed = detail.status === 'failed';
  // The engine's own message comes first, wrapped: it is a sentence about the
  // call, not a line of its output, and it is the thing the reader opened the
  // sheet to find. Output the tool printed before it failed still follows.
  if (detail.error && detail.status !== 'running') {
    rows.push({
      type: 'error',
      key: 'output-error',
      text: detail.error,
      declined: detail.declined,
    });
  }
  if (detail.output) pushLines(rows, 'output', detail.output, failed);
  else if (!detail.error) rows.push({ type: 'empty', key: 'output-empty', section: 'output' });
  return rows;
}
