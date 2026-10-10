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

/** A marker line, after any whitespace or bullet the agent draws before it. */
const MARKER_LINE = /^[\s\-*•●⏺>]*(?:MUQUN_TASK_DONE|MUQUN_TASK_BLOCKED):/;

/** Assistant text without its marker lines; the same string when it had none. */
export function stripTaskMarkers(text: string): string {
  if (!text.includes(TASK_DONE_MARKER) && !text.includes(TASK_BLOCKED_MARKER)) return text;
  const lines = text.split('\n');
  const kept = lines.filter((line) => !MARKER_LINE.test(line));
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

/**
 * The row as the transcript draws it: a `synthetic` part is not drawn, a text
 * part loses the plumbing its side carries, and one left with nothing to show
 * is not drawn either. Returns the same item when nothing changed.
 */
export function withoutTaskPlumbing(item: TimelineItem): TimelineItem | null {
  const { part } = item;
  if (part.type === 'synthetic') return null;
  if (part.type !== 'text' || item.role === 'system') return item;
  const text = item.role === 'user' ? stripTaskInstruction(part.text) : stripTaskMarkers(part.text);
  if (text === part.text) return item;
  if (!text.trim() && !item.attachments?.length && !item.image_assets?.length) return null;
  return { ...item, part: { ...part, text } };
}
