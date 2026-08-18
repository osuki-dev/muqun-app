/**
 * `@` file mentions for the composer: when the caret is inside an `@word`, the
 * word is a query against the pane's workspace, and picking a result rewrites
 * that span into the file's relative path.
 *
 * Three rules govern this module, and the feature is only predictable as long
 * as it keeps them:
 *
 * 1. The trigger is decided from the text and the caret alone. No keystroke
 *    history, no "the user pressed @" flag -- a paste, an undo, or a caret moved
 *    back into an old mention all resolve the same way as fresh typing.
 * 2. What goes into the draft is exactly what the gateway answered, byte for
 *    byte, plus one separating space. The agent does its own `@` handling on the
 *    other side, so anything this module added would have to be un-added there.
 * 3. A query that is no longer the one being typed is never allowed to answer.
 *    Every request carries a generation, and a reply from a stale generation is
 *    dropped rather than rendered, so a slow gateway cannot repaint the panel
 *    with results for a prefix the user has already typed past.
 *
 * Kept free of transport and of React so the whole contract is a pure function
 * of a string, a caret, and a clock.
 */

/** What the gateway answers for one match: a relative path, and nothing else. */
export interface FileMentionHit {
  /** Relative to the pane's workspace root. Inserted verbatim. */
  path: string;
  /** The last segment, which is what the user is usually thinking of. */
  name: string;
  /** Decided from the name alone by the gateway: text, markdown, image, pdf, binary. */
  kind: string;
}

/** The `@word` the caret currently sits in, as a span of the draft. */
export interface FileMentionTrigger {
  /** Index of the `@` itself. */
  start: number;
  /** Index just past the query, i.e. the caret. */
  end: number;
  /** What was typed after the `@`. Empty right after the `@` is typed. */
  query: string;
}

/** How long the panel waits before asking, so a fast typist sends one request. */
export const FILE_MENTION_DEBOUNCE_MS = 200;
/** The gateway's own default page; asking for more is refused above 50. */
export const FILE_MENTION_LIMIT = 20;
/** How many rows the panel shows at once. Beyond this it scrolls. */
export const FILE_MENTION_VISIBLE_ROWS = 5;
/**
 * Past this many characters the `@word` stopped being a file query. Nothing in
 * a path picker needs a 96-character needle, and the cap keeps a pasted blob
 * with an `@` in it from turning every keystroke into a search.
 */
export const MAX_FILE_MENTION_QUERY = 96;

const WHITESPACE = /\s/;

/**
 * The mention span the caret is inside, or null when there is none.
 *
 * An `@` only opens a mention at the start of the draft or after whitespace,
 * which is what keeps `user@example.com`, `a@b`, and `npm i pkg@1.2.3` from
 * opening a file picker mid-word.
 */
export function findFileMentionTrigger(text: string, caret: number): FileMentionTrigger | null {
  if (!text) return null;
  const end = Math.max(0, Math.min(Math.round(caret), text.length));
  if (end === 0) return null;

  // Walk back from the caret through the current word. Whitespace before an `@`
  // means the caret is not in a mention at all.
  let index = end - 1;
  while (index >= 0) {
    const char = text[index] as string;
    if (WHITESPACE.test(char)) return null;
    if (char === '@') break;
    index -= 1;
  }
  if (index < 0) return null;

  const before = index > 0 ? (text[index - 1] as string) : '';
  if (before && !WHITESPACE.test(before)) return null;

  const query = text.slice(index + 1, end);
  if (query.length > MAX_FILE_MENTION_QUERY) return null;
  return { start: index, end, query };
}

/** Where the draft and caret land once a hit is chosen. */
export interface FileMentionInsertion {
  text: string;
  /** Collapsed caret position, just past the inserted path and its space. */
  caret: number;
}

/**
 * Replace the `@query` span with the path the user picked.
 *
 * The path goes in untouched -- no quoting, no `@` re-prefix -- because the
 * agent on the other end parses the line itself and anything added here would
 * be something it has to strip. A single space follows so the next word is a
 * new token, unless whatever already follows is whitespace, in which case the
 * caret simply steps over it rather than doubling it.
 */
export function insertFileMention(
  text: string,
  trigger: FileMentionTrigger,
  path: string
): FileMentionInsertion {
  const start = Math.max(0, Math.min(trigger.start, text.length));
  const end = Math.max(start, Math.min(trigger.end, text.length));
  const following = text.slice(end);
  const needsSpace = !following.startsWith(' ') && !following.startsWith('\t');
  const inserted = needsSpace ? `${path} ` : `${path}`;
  return {
    text: `${text.slice(0, start)}${inserted}${following}`,
    // Past the space either way: when one was already there, the caret lands on
    // its far side so the user types a word rather than a second space.
    caret: start + inserted.length + (needsSpace ? 0 : 1),
  };
}

/**
 * The envelope parser for `GET .../panes/{id}/files`.
 *
 * A hit without a path is not a hit, and `root: null` -- a pane the gateway will
 * not look inside, such as one sitting in the home directory -- arrives as an
 * empty list rather than as an error, because "nothing to mention here" is a
 * normal answer and not a failure to report.
 */
export function fileMentionHitsFromResponse(value: unknown): FileMentionHit[] {
  const envelope = (value ?? {}) as Record<string, unknown>;
  const data = (envelope.data ?? envelope) as Record<string, unknown>;
  const entries = Array.isArray(data.files) ? data.files : [];
  const hits: FileMentionHit[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const raw = entry as Record<string, unknown>;
    if (typeof raw.path !== 'string' || !raw.path) continue;
    const name = typeof raw.name === 'string' && raw.name ? raw.name : lastSegment(raw.path);
    hits.push({
      path: raw.path,
      name,
      kind: typeof raw.kind === 'string' && raw.kind ? raw.kind : 'text',
    });
  }
  return hits;
}

function lastSegment(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut >= 0 ? path.slice(cut + 1) : path;
}

// ---------------------------------------------------------------------------
// Debounced, cancellable querying
// ---------------------------------------------------------------------------

type TimerHandle = ReturnType<typeof setTimeout>;

export interface FileMentionSearchOptions {
  /** Runs the query. Rejections are swallowed: see `onResults`. */
  search: (query: string) => Promise<FileMentionHit[]>;
  /** Called only for the newest generation, and only on success. */
  onResults: (query: string, hits: FileMentionHit[]) => void;
  /** Quiet period before a typed query is sent. */
  delayMs?: number;
  /** Swappable for tests; defaults to the platform timers. */
  timers?: {
    setTimeout: (fn: () => void, ms: number) => TimerHandle;
    clearTimeout: (handle: TimerHandle) => void;
  };
}

export interface FileMentionSearch {
  /**
   * Ask for `query`. Any pending timer and any in-flight request are
   * invalidated first, so the panel only ever shows the last thing typed.
   * `immediate` skips the debounce, which is what opening the panel on a bare
   * `@` uses so the first screen is not 200 ms late.
   */
  request(query: string, options?: { immediate?: boolean }): void;
  /** Drop the timer and invalidate anything in flight. Nothing else happens. */
  cancel(): void;
  /** True while a request has been asked for and has not been answered. */
  isPending(): boolean;
}

export function createFileMentionSearch(options: FileMentionSearchOptions): FileMentionSearch {
  const delayMs = options.delayMs ?? FILE_MENTION_DEBOUNCE_MS;
  const timers = options.timers ?? {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (handle) => clearTimeout(handle),
  };

  // The generation is the whole of the cancellation story: a reply is only
  // rendered when the generation it was issued under is still the current one.
  // Bumping it is therefore how both "the user typed again" and "the panel
  // closed" cancel work that cannot actually be recalled from the network.
  let generation = 0;
  let timer: TimerHandle | null = null;
  let pending = false;

  function clearTimer(): void {
    if (timer !== null) {
      timers.clearTimeout(timer);
      timer = null;
    }
  }

  function run(query: string, issued: number): void {
    let result: Promise<FileMentionHit[]>;
    try {
      result = options.search(query);
    } catch {
      // A search that throws synchronously is the same as one that rejects:
      // silence, because a mention panel must never interrupt typing.
      if (issued === generation) pending = false;
      return;
    }
    void result.then(
      (hits) => {
        if (issued !== generation) return;
        pending = false;
        options.onResults(query, hits);
      },
      () => {
        // Offline, timed out, or refused. The panel keeps whatever it had and
        // shows no error: the composer is still a composer without this.
        if (issued === generation) pending = false;
      }
    );
  }

  return {
    request(query, requestOptions) {
      clearTimer();
      generation += 1;
      const issued = generation;
      pending = true;
      if (requestOptions?.immediate || delayMs <= 0) {
        run(query, issued);
        return;
      }
      timer = timers.setTimeout(() => {
        timer = null;
        if (issued !== generation) return;
        run(query, issued);
      }, delayMs);
    },
    cancel() {
      clearTimer();
      generation += 1;
      pending = false;
    },
    isPending() {
      return pending;
    },
  };
}
