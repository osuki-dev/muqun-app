/**
 * The composer's "type a character, get a list" machine: what a trigger
 * character in the draft means, what it filters to, and what a pick puts back.
 *
 * Written once for both surfaces that need it. `/` raises the pane's slash
 * command catalog; `@` raises a file search over the pane's workspace. The two
 * differ only in which character opens them, where in the draft that character
 * counts, and where the rows come from -- so those three are parameters and
 * everything else (the query scan, the fuzzy rank, the replacement, the
 * dismissal) is shared.
 *
 * Three rules govern it, and the callers are only correct as long as they keep
 * them:
 *
 * 1. **No catalog, no popup.** A trigger with nothing behind it is not a
 *    degraded popup, it is a plain character. `readComposerPopup` answers
 *    `open: false` before it reads the draft at all, so a screen wired to it
 *    renders nothing and asks the gateway for nothing.
 * 2. **Pure.** Everything here is a function of the draft, the caret and the
 *    catalog in hand. No fetching, no React, no timers -- which is what lets the
 *    whole trigger/filter/insert contract be tested as data.
 * 3. **The draft is the source of truth.** Dismissal is remembered as the
 *    offset it happened at, not as a boolean, so editing away the trigger and
 *    typing a new one reopens the popup without the caller resetting anything.
 */

/** One row as the panel draws it. Deliberately free of the source's shape. */
export interface ComposerPopupRow {
  /** Stable list key. */
  id: string;
  /** The row's headline -- a command name, a file name. */
  label: string;
  /** One line under the label. May be empty. */
  description: string;
  /**
   * What may follow once this row is inserted, in the source's own words
   * (`[instructions]`, `<path>`). Drawn as a placeholder, never inserted: it is
   * a prompt to the user, not text the agent should receive.
   */
  hint: string;
  /** A short provenance mark, e.g. `workspace`. Empty for the common case. */
  badge: string;
  /** What replaces the query in the draft, trigger character included. */
  insert: string;
}

/**
 * Where a trigger character is allowed to open a popup.
 *
 * `start` is the slash-command rule: a command is only a command when it is the
 * whole message, so only offset 0 counts. `word` is the mention rule: an `@`
 * after a space is a mention anywhere in a sentence.
 */
export type ComposerTriggerAnchor = 'start' | 'word';

/** The three things that differ between one popup and the next. */
export interface ComposerTrigger<T> {
  /** The single character that opens it. */
  char: string;
  anchor: ComposerTriggerAnchor;
  /** The catalog, already in hand. Empty means "no popup" -- see rule 1. */
  items: readonly T[];
  /** How one catalog entry is drawn and what it inserts. */
  present: (item: T, index: number) => ComposerPopupRow;
  /**
   * What the fuzzy filter matches the typed term against, best field first.
   * Defaults to the row's label.
   *
   * Later fields are real matches but weaker ones -- a command found by its
   * description, a file found by its directory -- and they are ranked below
   * every hit on an earlier field rather than mixed in with them, so the list
   * never puts a description hit above an exact name. They are also matched
   * more strictly: literally, and only once the term is long enough to mean
   * something (`MIN_SECONDARY_TERM`).
   */
  searchText?: (item: T, row: ComposerPopupRow) => string | readonly string[];
  /** Rows to return at most. Undefined keeps them all; the panel scrolls. */
  limit?: number;
}

/** The trigger character and everything typed after it, located in the draft. */
export interface ComposerPopupQuery {
  /** Offset of the trigger character in the draft. */
  start: number;
  /** Offset one past the last character of the query. */
  end: number;
  /** The trigger character plus the term, i.e. what is on screen. */
  text: string;
  /** Just what was typed after the trigger character. */
  term: string;
}

/**
 * Why the popup is shut. Not decoration: `no-query` is the one state in which a
 * remembered dismissal has to be forgotten -- the trigger it belonged to is
 * gone from the draft, so the next one the user types deserves a fresh popup.
 */
export type ComposerPopupClosedReason =
  | 'no-catalog'
  | 'no-query'
  | 'dismissed'
  | 'no-match';

export type ComposerPopupState<T = unknown> =
  | {
      open: false;
      reason: ComposerPopupClosedReason;
      query: null;
      rows: readonly ComposerPopupRow[];
      items: readonly T[];
    }
  | {
      open: true;
      reason: null;
      query: ComposerPopupQuery;
      rows: ComposerPopupRow[];
      items: T[];
    };

const NO_ROWS = Object.freeze([]) as readonly ComposerPopupRow[];

export function closedComposerPopup<T>(
  reason: ComposerPopupClosedReason = 'no-query'
): ComposerPopupState<T> {
  return { open: false, reason, query: null, rows: NO_ROWS, items: NO_ROWS as readonly T[] };
}

export interface ComposerPopupInput<T> {
  /** The composer's current text. */
  draft: string;
  /**
   * Caret offset. React Native reports it on `onSelectionChange`; a caller that
   * does not track it leaves it out and the end of the draft is assumed, which
   * is where typing puts it.
   */
  caret?: number;
  trigger: ComposerTrigger<T>;
  /**
   * The offset the user last dismissed at, from `dismissComposerPopup`. The
   * popup stays shut while the query still starts there -- so Esc survives the
   * next keystroke -- and reopens by itself once that trigger is edited away.
   */
  dismissedAt?: number | null;
  /**
   * The capability gate. `false` makes the trigger character plain text: no
   * scan, no rows, nothing rendered. See rule 1.
   */
  enabled?: boolean;
}

/**
 * The whole trigger/filter step. Answers what the popup should be showing for
 * this draft, or that it should not be showing at all.
 */
export function readComposerPopup<T>(input: ComposerPopupInput<T>): ComposerPopupState<T> {
  const { draft, trigger, dismissedAt = null, enabled = true } = input;
  // Rule 1, applied before the draft is even read.
  if (!enabled || trigger.items.length === 0 || trigger.char.length === 0) {
    return closedComposerPopup<T>('no-catalog');
  }

  const caret = clampCaret(input.caret, draft.length);
  const query = scanQuery(draft, caret, trigger.char, trigger.anchor);
  if (!query) return closedComposerPopup<T>('no-query');
  if (dismissedAt !== null && dismissedAt === query.start) {
    return closedComposerPopup<T>('dismissed');
  }

  const rows: ComposerPopupRow[] = [];
  const items: T[] = [];
  const ranked: { score: number; order: number; item: T; row: ComposerPopupRow }[] = [];
  for (const [index, item] of trigger.items.entries()) {
    const row = trigger.present(item, index);
    const score = query.term ? rankFields(query.term, searchFields(trigger, item, row)) : 0;
    if (score === null) continue;
    ranked.push({ score, order: index, item, row });
  }
  // A stable sort on (score, catalog order): the gateway already sorts its
  // table, and a list that reshuffles under a thumb for equally good matches is
  // worse than one that keeps the order the user just read.
  ranked.sort((a, b) => (a.score === b.score ? a.order - b.order : b.score - a.score));
  const limit = trigger.limit && trigger.limit > 0 ? trigger.limit : ranked.length;
  for (const entry of ranked.slice(0, limit)) {
    rows.push(entry.row);
    items.push(entry.item);
  }
  // Typed past every candidate: the term is now ordinary prose, not a query.
  if (rows.length === 0) return closedComposerPopup<T>('no-match');

  return { open: true, reason: null, query, rows, items };
}

/** The offset to remember when Esc is pressed or the backdrop is tapped. */
export function dismissComposerPopup<T>(state: ComposerPopupState<T>): number | null {
  return state.open ? state.query.start : null;
}

/**
 * How far up from the bottom of the screen the tap-outside backdrop stops.
 *
 * The backdrop is the other half of dismissal, and "outside" means the pane --
 * not the composer. The composer's own controls stay live while a panel is
 * open, and they are drawn above the backdrop anyway, so a backdrop that
 * reaches the bottom of the screen adds nothing.
 *
 * It costs something, though, and the cost is not cosmetic. A backdrop drawn as
 * a plain absolute fill is one screen-sized element in the accessibility tree
 * labelled "close the command list", laid over the composer. Anything that aims
 * at an element by its bounds -- a screen reader's explore-by-touch, a UI test
 * tapping an element's centre -- then aims at the middle of the screen, which
 * with the keyboard up is the pane strip. The tap lands on a pane chip, the
 * pane switches out from under a half-typed message, and the panel closes for
 * the wrong reason. Bounding the backdrop to the pane puts its centre back over
 * the pane, where a tap means what the label says.
 *
 * `keyboardOffset` is the composer's own translation, i.e. negative while the
 * keyboard is up, so subtracting it lifts the backdrop by exactly as much as
 * the composer rose. That offset only exists as a shared value, so this is
 * called from an animated style and has to be a worklet -- the same arrangement
 * `swipeDirection` is in, and for the same reason: the decision is worth
 * testing as arithmetic, and the UI thread is where it has to be applied.
 */
export function composerBackdropBottom(composerHeight: number, keyboardOffset: number): number {
  'worklet';
  return Math.max(0, composerHeight - keyboardOffset);
}

/** The draft after a row is picked, and where the caret lands in it. */
export interface ComposerPopupInsertion {
  draft: string;
  /** Caret offset, which is the end of what was inserted. */
  caret: number;
}

/**
 * Put the picked row into the draft in place of the query.
 *
 * The row's `insert` carries the trigger character, because the catalog does:
 * the gateway's slash commands are named `/compact`, not `compact`, and a
 * client that re-added the slash would send `//compact` the day a table starts
 * naming something else.
 */
export function insertComposerPick(
  draft: string,
  query: ComposerPopupQuery,
  row: ComposerPopupRow
): ComposerPopupInsertion {
  const head = draft.slice(0, query.start);
  const tail = draft.slice(query.end);
  // One trailing space so the argument can be typed straight away, and so a
  // command that takes none still reads as finished. Never two: the tail may
  // already start with one when the pick happened mid-sentence.
  const inserted = tail.startsWith(' ') ? row.insert : `${row.insert} `;
  return { draft: `${head}${inserted}${tail}`, caret: head.length + inserted.length };
}

function searchFields<T>(
  trigger: ComposerTrigger<T>,
  item: T,
  row: ComposerPopupRow
): readonly string[] {
  if (!trigger.searchText) return [row.label];
  const fields = trigger.searchText(item, row);
  return typeof fields === 'string' ? [fields] : fields;
}

/** How far apart two search fields are kept. Wider than any single score. */
const FIELD_RANK_STEP = 2000;
/**
 * Below this, only the first field is searched.
 *
 * A two-letter term against a sentence matches almost everything -- "co" is in
 * "context", in "Claude Code", in "colored" -- and a list that answers the
 * second keystroke with the whole catalog again is worse than one that waits.
 * Names have no such problem, so they are searched from the first character.
 */
const MIN_SECONDARY_TERM = 3;

function rankFields(term: string, fields: readonly string[]): number | null {
  const primary = fuzzyScore(term, fields[0] ?? '');
  if (primary !== null) return primary;
  if (term.length < MIN_SECONDARY_TERM) return null;
  for (const [index, field] of fields.slice(1).entries()) {
    // Prose is matched literally, never as a subsequence: a description is a
    // sentence, and every sentence contains almost every short subsequence.
    if (!field.toLowerCase().includes(term.toLowerCase())) continue;
    return 800 - field.length - (index + 1) * FIELD_RANK_STEP;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

function clampCaret(caret: number | undefined, length: number): number {
  if (typeof caret !== 'number' || !Number.isFinite(caret)) return length;
  return Math.max(0, Math.min(length, Math.round(caret)));
}

/**
 * The query the caret is sitting in, if any.
 *
 * Scans back from the caret to the nearest whitespace and requires the trigger
 * character at that boundary -- so a popup never opens on a `/` inside a path,
 * and closes the moment a space is typed, which is exactly when the term stops
 * being a name and becomes an argument.
 */
function scanQuery(
  draft: string,
  caret: number,
  char: string,
  anchor: ComposerTriggerAnchor
): ComposerPopupQuery | null {
  let start = caret;
  while (start > 0 && !isBoundary(draft[start - 1])) start -= 1;
  if (draft[start] !== char) return null;
  if (anchor === 'start' && start !== 0) return null;
  // A trigger at a word start still needs whitespace in front of it, otherwise
  // `a@b` in an email address would raise the mention list.
  if (anchor === 'word' && start > 0 && !isBoundary(draft[start - 1])) return null;

  let end = start + char.length;
  while (end < draft.length && !isBoundary(draft[end])) end += 1;
  // The caret has to be inside the query: the popup follows what is being
  // typed, and a caret parked before the trigger is editing something else.
  if (caret < start || caret > end) return null;

  return {
    start,
    end,
    text: draft.slice(start, end),
    term: draft.slice(start + char.length, end),
  };
}

function isBoundary(character: string | undefined): boolean {
  return character === undefined || /\s/.test(character);
}

// ---------------------------------------------------------------------------
// Fuzzy rank
// ---------------------------------------------------------------------------

/**
 * How well `term` matches `text`, or `null` for no match at all.
 *
 * A subsequence match, scored so that the orderings a user expects fall out:
 * a prefix beats a match at a word boundary, which beats a scattered one, and
 * among equals the shorter candidate wins. Case-insensitive, because nobody
 * capitalizes a command they are filtering for.
 */
export function fuzzyScore(term: string, text: string): number | null {
  const needle = term.toLowerCase();
  const haystack = text.toLowerCase();
  if (needle.length === 0) return 0;
  if (needle.length > haystack.length) return null;

  if (haystack.startsWith(needle)) return 1000 - haystack.length;
  // The trigger character is part of the name the catalog carries, so a term
  // typed without it still has to line up with the name's first real letter.
  const bare = haystack.replace(/^[^a-z0-9]+/, '');
  if (bare.startsWith(needle)) return 900 - haystack.length;
  if (haystack.includes(needle)) return 800 - haystack.length;

  let score = 700 - haystack.length;
  let at = 0;
  for (const character of needle) {
    const found = haystack.indexOf(character, at);
    if (found < 0) return null;
    // Landing on a word boundary is a deliberate abbreviation ("cc" for
    // "code-check"); landing mid-word is a coincidence worth less.
    if (found === 0 || /[^a-z0-9]/.test(haystack[found - 1] ?? '')) score += 8;
    else if (found === at) score += 4;
    at = found + 1;
  }
  return score;
}
