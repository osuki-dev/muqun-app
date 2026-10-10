/**
 * The `@` mentions a composer draft holds, as plain text: a computer is the
 * word `@name`, a file the path the sheet inserted. Everything here reads the
 * draft; nothing stores the mentions apart from it, so what is drawn, what is
 * deleted and what is sent all agree with what the reader sees.
 */

export type MentionKind = 'computer' | 'file';

/** Text the draft may hold as one mention: `@name` for a computer, the inserted path for a file. */
export interface MentionToken {
  text: string;
  kind: MentionKind;
}

export interface MentionRange {
  start: number;
  end: number;
  kind: MentionKind;
}

const SPACE = /\s/;

function standsAlone(text: string, start: number, end: number): boolean {
  const before = start === 0 ? '' : (text[start - 1] ?? '');
  const after = end >= text.length ? '' : (text[end] ?? '');
  return (!before || SPACE.test(before)) && (!after || SPACE.test(after));
}

/**
 * Every occurrence of a token standing as its own word (start/whitespace
 * before, end/whitespace after); the longest token wins an overlap; sorted.
 */
export function mentionRanges(text: string, tokens: readonly MentionToken[]): MentionRange[] {
  if (!text) return [];
  const byLength = [
    ...new Map(tokens.filter((token) => token.text).map((token) => [token.text, token])).values(),
  ].sort((a, b) => b.text.length - a.text.length);
  const taken: MentionRange[] = [];
  for (const token of byLength) {
    let from = 0;
    for (;;) {
      const start = text.indexOf(token.text, from);
      if (start < 0) break;
      const end = start + token.text.length;
      from = start + 1;
      if (!standsAlone(text, start, end)) continue;
      if (taken.some((range) => start < range.end && end > range.start)) continue;
      taken.push({ start, end, kind: token.kind });
    }
  }
  return taken.sort((a, b) => a.start - b.start);
}

/**
 * When `next` is `prev` with the last character of a mention removed (a
 * backspace at its end), the draft without the whole token and the caret
 * where it began; otherwise null.
 */
export function deleteMentionAtomically(
  prev: string,
  next: string,
  ranges: readonly MentionRange[]
): { text: string; caret: number } | null {
  if (next.length !== prev.length - 1) return null;
  let index = 0;
  while (index < next.length && prev[index] === next[index]) index += 1;
  if (prev.slice(index + 1) !== next.slice(index)) return null;
  const range = ranges.find((candidate) => candidate.end - 1 === index);
  if (!range) return null;
  return { text: prev.slice(0, range.start) + prev.slice(range.end), caret: range.start };
}

export interface MentionComputer {
  serverId: string;
  name: string;
  reachable: boolean;
  /** The computer this composer already sends to. */
  current: boolean;
}

/**
 * Current first, then reachable, then unreachable; each group in the given
 * order; filtered by a case-insensitive name prefix.
 */
export function orderMentionComputers(
  computers: readonly MentionComputer[],
  query: string
): MentionComputer[] {
  const wanted = query.trim().toLowerCase();
  const rank = (computer: MentionComputer) => (computer.current ? 0 : computer.reachable ? 1 : 2);
  return computers
    .filter((computer) => computer.name.toLowerCase().startsWith(wanted))
    .map((computer, order) => ({ computer, order }))
    .sort((a, b) => rank(a.computer) - rank(b.computer) || a.order - b.order)
    .map(({ computer }) => computer);
}

/** As many computers as one task may name; the gateway refuses more. */
export const MAX_TASK_MENTIONS = 8;

/**
 * The `mentions` a task may carry: the computers the draft names, as the
 * target computer itself calls them -- each linked peer by the name its own
 * `GET /api/peers` lists, the target as `self` -- capped at
 * `MAX_TASK_MENTIONS`. A name the target has not linked is dropped: the
 * gateway refuses anything else.
 */
export function taskMentions(
  text: string,
  offered: readonly MentionComputer[],
  peers: readonly { serverId: string; name: string }[]
): string[] {
  const named = mentionedComputers(
    text,
    offered.map((computer) => computer.name)
  );
  const mentions: string[] = [];
  for (const name of named) {
    const computer = offered.find((candidate) => candidate.name === name);
    if (!computer) continue;
    const mention = computer.current
      ? 'self'
      : peers.find((peer) => peer.serverId === computer.serverId)?.name;
    if (mention && !mentions.includes(mention)) mentions.push(mention);
  }
  return mentions.slice(0, MAX_TASK_MENTIONS);
}

/** The computer names the draft mentions (`@name` as its own word), in draft order, each once. */
export function mentionedComputers(text: string, names: readonly string[]): string[] {
  const ranges = mentionRanges(
    text,
    names.map((name) => ({ text: `@${name}`, kind: 'computer' as const }))
  );
  return [...new Set(ranges.map((range) => text.slice(range.start + 1, range.end)))];
}
