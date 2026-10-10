/**
 * What the gateway adds to a delegated task's conversation so it can tell
 * when the task ends, kept off the reader's screen.
 *
 * A task from Home is sent as the goal followed by a request to call
 * `tasks.complete`, or else to print a marker line; the agent's reply may end
 * with that line. Both are the gateway talking to the agent. The reader only
 * needs to know the task went out and what came back, so neither is drawn.
 * A newer gateway sends the request as a `synthetic` part and strips the
 * markers itself; this keeps an older one just as clean.
 */

import type { TimelineItem } from './agent-protocol';

/** The line an agent prints when the delegated goal is finished. */
export const TASK_DONE_MARKER = 'MUQUN_TASK_DONE:';
/** The line it prints when it stopped because it needs the user. */
export const TASK_BLOCKED_MARKER = 'MUQUN_TASK_BLOCKED:';

/** The request's fixed first sentence, as the gateway words it. */
const INSTRUCTION_HEAD = 'When the whole task is finished, ';
/** It ends on one of the two marker templates. */
const INSTRUCTION_ENDS = [
  `${TASK_DONE_MARKER} <one-line summary>`,
  `${TASK_BLOCKED_MARKER} <one-line reason>`,
];

/** What may lead a marker: bullets, backticks, whitespace -- any run the gateway strips. */
const LINE_LEAD = /^[^\p{L}\p{N}]*/u;
const MARKERS = [TASK_DONE_MARKER, TASK_BLOCKED_MARKER];

/**
 * Assistant text without its marker lines; the same string when it had none.
 *
 * `streaming`: the text is still arriving, so its last, unterminated line is
 * held back too while it could still become a marker (`MUQUN_TASK_D`), rather
 * than flashing until the colon lands. A newline or the turn's end releases it.
 */
export function stripTaskMarkers(text: string, streaming = false): string {
  if (!streaming && !text.includes('MUQUN_TASK_')) return text;
  const lines = text.split('\n');
  const last = lines.length - 1;
  const kept = lines.filter((line, at) => {
    const body = line.replace(LINE_LEAD, '');
    return !MARKERS.some(
      (marker) =>
        body.startsWith(marker) ||
        (streaming && at === last && body.length > 0 && marker.startsWith(body))
    );
  });
  return kept.length === lines.length ? text : kept.join('\n').trimEnd();
}

/** A goal without the completion request an older gateway appended to it. */
export function stripTaskInstruction(text: string): string {
  const at = text.lastIndexOf(INSTRUCTION_HEAD);
  if (at < 0 || (at > 0 && !/\s/.test(text[at - 1] ?? ''))) return text;
  const request = text.slice(at).trimEnd();
  if (!INSTRUCTION_ENDS.some((end) => request.endsWith(end))) return text;
  return text.slice(0, at).trimEnd();
}

/** The one engine-injected part a reader acts on: which skill was invoked. */
const SHOWN_SYNTHETIC = 'skill-invocation';

/**
 * The row as the transcript draws it: a `synthetic` part is not drawn (but
 * for a skill invocation, which keeps its notice row), a text
 * part loses the plumbing its side carries, and one left with nothing to show
 * is not drawn either. `streaming`: see `stripTaskMarkers`. Returns the same
 * item when nothing changed.
 */
export function withoutTaskPlumbing(item: TimelineItem, streaming = false): TimelineItem | null {
  const { part } = item;
  if (part.type === 'synthetic') return part.description === SHOWN_SYNTHETIC ? item : null;
  if (part.type !== 'text' || item.role === 'system') return item;
  const text =
    item.role === 'user' ? stripTaskInstruction(part.text) : stripTaskMarkers(part.text, streaming);
  if (text === part.text) return item;
  if (!text.trim() && !item.attachments?.length && !item.image_assets?.length) return null;
  return { ...item, part: { ...part, text } };
}
