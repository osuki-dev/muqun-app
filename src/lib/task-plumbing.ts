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
 * Text without its task markers; the same string when it had none.
 *
 * A marker cuts its line from the marker to the line's end and keeps the words
 * before it, for an agent that runs its last sentence into the marker
 * (`…help?MUQUN_TASK_DONE: …`). A line that held only the marker goes.
 *
 * `streaming`: the text is still arriving, so its last, unterminated line is
 * held back too while it could still become a marker (`MUQUN_TASK_D`), rather
 * than flashing until the colon lands. A newline or the turn's end releases it.
 */
export function stripTaskMarkers(text: string, streaming = false): string {
  if (!streaming && !text.includes('MUQUN_TASK_')) return text;
  const lines = text.split('\n');
  const last = lines.length - 1;
  let changed = false;
  const kept: string[] = [];
  lines.forEach((line, at) => {
    const cuts = MARKERS.map((marker) => line.indexOf(marker)).filter((index) => index >= 0);
    const body = line.replace(LINE_LEAD, '');
    const partial =
      streaming &&
      at === last &&
      body.length > 0 &&
      MARKERS.some((marker) => marker.startsWith(body));
    if (cuts.length === 0 && !partial) {
      kept.push(line);
      return;
    }
    changed = true;
    const before = cuts.length > 0 ? line.slice(0, Math.min(...cuts)).trimEnd() : '';
    if (before.replace(LINE_LEAD, '')) kept.push(before);
  });
  return changed ? kept.join('\n').trimEnd() : text;
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
