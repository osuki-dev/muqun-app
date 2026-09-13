/**
 * The diff viewer's vocabulary and its parser.
 *
 * The Gateway runs `git`; this module turns what comes back into rows. It is
 * pure -- no React, no transport, no Lingui macro -- for the reason
 * `away-digest.ts` is: `bun test` transpiles with Bun rather than Babel and
 * never expands a macro, so a module with a real test suite cannot hold one.
 * The wording lives at the call sites and in `src/i18n/labels.ts`.
 *
 * Two decisions from the design note are load-bearing here and worth restating
 * where the code is:
 *
 * **The wire carries a raw unified patch, not structured lines.** Measured, a
 * hand-written line-oriented parser is cheaper than `JSON.parse` of the same
 * data already structured, on a payload about 45% smaller -- the parser is one
 * `split('\n')` and a `charCodeAt` switch, while JSON re-lexes every quoted
 * string and allocates an object per line. So `/git/status` is JSON, and
 * `/git/diff` is text that lands here.
 *
 * **Nothing throws.** Every `*FromResponse` function takes `unknown` and
 * answers with safe defaults, and `parseUnifiedPatch` answers with rows or with
 * nothing for any input at all -- a truncated page, a malformed hunk header, a
 * binary marker, an empty string. A diff that cannot be read is a diff with no
 * rows, never a crash in a sheet the reader opened to look at their own work.
 */

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

/** The gateway capability that gates the whole feature. */
export const GIT_DIFF_CAPABILITY = 'git_diff';

/**
 * The per-pane context route's own capability.
 *
 * Separate from `git_diff` because the route is useful without git -- it is the
 * join that answers cwd, agent and repo in one request -- and an older client
 * must be able to tell a gateway that has only one of them from a gateway that
 * has both.
 */
export const PANE_CONTEXT_CAPABILITY = 'pane_context';

/**
 * A gateway that predates these routes never gets asked for one. The routes
 * also answer 404, but the capability is what keeps the app from making the
 * request at all -- and, more importantly, what keeps the entry point
 * *invisible* rather than merely silent on an older server. The same argument
 * as `gatewaySupportsAgentEvents`, and deliberately the same shape.
 */
export function gatewaySupportsGitDiff(
  capabilities: readonly string[] | undefined | null
): boolean {
  return Array.isArray(capabilities) && capabilities.includes(GIT_DIFF_CAPABILITY);
}

/** Whether the pane context route exists. See `PANE_CONTEXT_CAPABILITY`. */
export function gatewaySupportsPaneContext(
  capabilities: readonly string[] | undefined | null
): boolean {
  return Array.isArray(capabilities) && capabilities.includes(PANE_CONTEXT_CAPABILITY);
}

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

/**
 * How many expanded files keep their parsed rows.
 *
 * Past this the least-recently-expanded file collapses back to its header and
 * its rows are dropped. Re-expanding refetches, and the request is one file's
 * patch, so the cost of being wrong here is a round trip rather than a heap
 * that only grows.
 */
export const MAX_OPEN_FILES = 12;

/**
 * The most patch lines one request may ask for, matching the gateway's own cap.
 * A file longer than this is read a page at a time through `from`.
 */
export const FILE_PATCH_MAX_LINES = 4000;

/**
 * A file whose numstat total is under this expands on its own when it is the
 * only changed file. Above it, every file starts collapsed: the sheet's first
 * paint must never depend on how large the biggest change happens to be.
 */
export const AUTO_EXPAND_MAX_LINES = 400;

/** `git diff -U<n>`. Three is git's own default and the one a reader expects. */
export const DIFF_CONTEXT_LINES = 3;

/** The badge stops counting here and says so. */
export const MAX_BADGE_COUNT = 99;

// ---------------------------------------------------------------------------
// The wire vocabulary
// ---------------------------------------------------------------------------

/** What happened to a file, as `git status --porcelain=v2` classifies it. */
export type GitFileStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'conflicted'
  | 'type_changed'
  | 'unknown';

const GIT_FILE_STATUSES: readonly GitFileStatus[] = [
  'added',
  'modified',
  'deleted',
  'renamed',
  'copied',
  'untracked',
  'conflicted',
  'type_changed',
];

/** Where a pane's checkout is and what it is pointed at. */
export interface GitRepoSummary {
  toplevel: string;
  branch: string | null;
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
  detached: boolean;
  head: string | null;
  /** What the badge shows. */
  changedFiles: number;
}

/** One row of the file list. */
export interface GitFileChange {
  path: string;
  /** Where a rename or a copy came from. */
  oldPath: string | null;
  status: GitFileStatus;
  staged: boolean;
  unstaged: boolean;
  binary: boolean;
  added: number | null;
  removed: number | null;
}

/** The answer from `…/git/status`. */
export interface GitStatus {
  sessionId: string;
  paneId: string;
  /** `null` when the pane is not in a checkout, which is not an error. */
  repo: GitRepoSummary | null;
  /** The gateway cut the list at its cap; the count is real, the list is not. */
  truncated: boolean;
  files: GitFileChange[];
}

/** What the pane's agent is, as the context route reports it. */
export interface PaneAgentContext {
  kind: string;
  status: string;
  foregroundCommand: string | null;
  /** Whether a declared profile backs this kind, rather than a guess. */
  profile: boolean;
}

/** The answer from `…/context`: the join, in one request. */
export interface PaneContext {
  sessionId: string;
  paneId: string;
  cwd: string | null;
  /** Whether the cwd is inside a directory this session already works in. */
  cwdInFence: boolean;
  git: GitRepoSummary | null;
  agent: PaneAgentContext | null;
}

/** One page of one file's unified patch. */
export interface GitFilePatchPage {
  path: string;
  binary: boolean;
  /** 0-based line offset into the file's full patch. */
  from: number;
  /** One past the last line this page carries. */
  end: number;
  totalLines: number;
  truncated: boolean;
  /** Dropped as soon as it is parsed; only rows are retained. */
  patch: string;
}

// ---------------------------------------------------------------------------
// Tolerant response parsing
// ---------------------------------------------------------------------------

/**
 * Every content route answers inside the same envelope, and every one of these
 * is written so a shape change is one edit here rather than a crash on a phone.
 * An object that is already the `data` body parses too, which is what lets the
 * demo fixtures go through the very same functions as the wire.
 */
function bodyOf(value: unknown): Record<string, unknown> {
  const envelope = (value ?? {}) as Record<string, unknown>;
  const data = envelope.data;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  return envelope;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function asNullableCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null;
}

function asCount(value: unknown, fallback = 0): number {
  const count = asNullableCount(value);
  return count === null ? fallback : count;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asFileStatus(value: unknown): GitFileStatus {
  return typeof value === 'string' && (GIT_FILE_STATUSES as readonly string[]).includes(value)
    ? (value as GitFileStatus)
    : 'unknown';
}

/**
 * The repo object, which the context route and the status route both carry and
 * which both spell the same way. `null` is the ordinary answer for a pane that
 * is not in a checkout.
 */
export function gitRepoSummaryFromResponse(value: unknown): GitRepoSummary | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const toplevel = asString(raw.toplevel);
  // Without a toplevel there is no repository to talk about, whatever else the
  // object carries.
  if (!toplevel) return null;
  return {
    toplevel,
    branch: asNullableString(raw.branch),
    upstream: asNullableString(raw.upstream),
    ahead: asNullableCount(raw.ahead),
    behind: asNullableCount(raw.behind),
    detached: asBoolean(raw.detached),
    head: asNullableString(raw.head),
    changedFiles: Math.max(0, asCount(raw.changed_files)),
  };
}

/** `GET …/panes/{paneId}/context`. */
export function paneContextFromResponse(value: unknown): PaneContext {
  const data = bodyOf(value);
  const agentRaw = data.agent;
  const agent =
    agentRaw && typeof agentRaw === 'object' && !Array.isArray(agentRaw)
      ? (agentRaw as Record<string, unknown>)
      : null;
  return {
    sessionId: asString(data.session_id),
    paneId: asString(data.pane_id),
    cwd: asNullableString(data.cwd),
    cwdInFence: asBoolean(data.cwd_in_fence),
    git: gitRepoSummaryFromResponse(data.git),
    agent: agent
      ? {
          kind: asString(agent.kind),
          status: asString(agent.status, 'unknown'),
          foregroundCommand: asNullableString(agent.foreground_command),
          profile: asBoolean(agent.profile),
        }
      : null,
  };
}

/** `GET …/panes/{paneId}/git/status`. */
export function gitStatusFromResponse(value: unknown): GitStatus {
  const data = bodyOf(value);
  const entries = Array.isArray(data.files) ? data.files : [];
  const files: GitFileChange[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const raw = entry as Record<string, unknown>;
    const path = asString(raw.path);
    // A row with no path cannot be listed, expanded or fetched. Skipped rather
    // than shown as a blank line the reader cannot do anything with.
    if (!path) continue;
    files.push({
      path,
      oldPath: asNullableString(raw.old_path),
      status: asFileStatus(raw.status),
      staged: asBoolean(raw.staged),
      // v1 shows the union of the index and the working tree, so a row that
      // says neither is still a row: default to the working-tree side rather
      // than to "this change is in no state at all".
      unstaged: asBoolean(raw.unstaged, !asBoolean(raw.staged)),
      binary: asBoolean(raw.binary),
      added: asNullableCount(raw.added),
      removed: asNullableCount(raw.removed),
    });
  }
  return {
    sessionId: asString(data.session_id),
    paneId: asString(data.pane_id),
    repo: gitRepoSummaryFromResponse(data.repo),
    truncated: asBoolean(data.truncated),
    files,
  };
}

/** `GET …/panes/{paneId}/git/diff`. */
export function gitDiffPageFromResponse(value: unknown, requestedPath = ''): GitFilePatchPage {
  const data = bodyOf(value);
  const patch = asString(data.patch);
  const from = Math.max(0, asCount(data.from));
  // A gateway that forgets to say how far it got is taken at the length of what
  // it actually sent, so paging still terminates.
  const measured = patch ? countLines(patch) : 0;
  const end = Math.max(from, asCount(data.end, from + measured));
  return {
    path: asString(data.path, requestedPath),
    binary: asBoolean(data.binary),
    from,
    end,
    totalLines: Math.max(end, asCount(data.total_lines, end)),
    truncated: asBoolean(data.truncated),
    patch,
  };
}

function countLines(patch: string): number {
  let lines = 1;
  for (let index = 0; index < patch.length; index += 1) {
    if (patch.charCodeAt(index) === 10) lines += 1;
  }
  // A trailing newline is a separator, not another line.
  return patch.charCodeAt(patch.length - 1) === 10 ? lines - 1 : lines;
}

// ---------------------------------------------------------------------------
// The patch parser
// ---------------------------------------------------------------------------

/** What a line of a hunk is. */
export type GitDiffLineKind = 'context' | 'added' | 'removed';

/** One line of a hunk, with the numbers the gutter shows. */
export interface GitDiffLine {
  kind: GitDiffLineKind;
  /** The line itself, with the `+`/`-`/space marker already taken off. */
  text: string;
  oldLine: number | null;
  newLine: number | null;
  /** git's `\ No newline at end of file` applied to this line. */
  noNewline: boolean;
}

/** One `@@ … @@` run. */
export interface GitDiffHunk {
  /** The header as git wrote it, for the row that shows it. */
  header: string;
  /** The function or section name git puts after the second `@@`, if any. */
  heading: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: GitDiffLine[];
}

/** What one page of patch text turned into. */
export interface ParsedPatch {
  hunks: GitDiffHunk[];
  /** git said this file is binary; there are no hunks and there never will be. */
  binary: boolean;
}

/**
 * `@@ -1,7 +1,9 @@ heading`, and the combined-diff `@@@ … @@@` spelling with
 * it. Deliberately forgiving: a count may be absent (meaning one line), and
 * anything after the closing marker is the heading.
 */
const HUNK_HEADER = /^@@+ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@+(.*)$/;

const CHAR_PLUS = 43;
const CHAR_MINUS = 45;
const CHAR_SPACE = 32;
const CHAR_BACKSLASH = 92;
const CHAR_AT = 64;
const CHAR_D = 100;
const CHAR_B = 66;
const CHAR_G = 71;
const CHAR_CR = 13;

/**
 * A unified patch, or one page of one.
 *
 * The gateway cuts a page at a hunk boundary, so every page starts at a
 * `diff --git` or an `@@` line and can be parsed on its own -- which is what
 * makes "show more" a matter of appending hunks rather than of re-parsing the
 * file from the top.
 *
 * Line-oriented on purpose: one `split('\n')` and a `charCodeAt` switch. The
 * only regular expression is the hunk header, which runs a handful of times per
 * file rather than once per line.
 *
 * Never throws. A header that does not parse still opens a hunk, with no line
 * numbers rather than wrong ones; text before any hunk is metadata and is
 * dropped; a `+`/`-` line outside a hunk is not a diff line and is ignored.
 */
export function parseUnifiedPatch(patch: string): ParsedPatch {
  const hunks: GitDiffHunk[] = [];
  if (typeof patch !== 'string' || !patch) return { hunks, binary: false };

  let binary = false;
  let current: GitDiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  const rows = patch.split('\n');
  for (let index = 0; index < rows.length; index += 1) {
    let line = rows[index];
    // CRLF. A patch of a Windows checkout carries the carriage return on every
    // line, and a trailing \r in a fixed-height monospace row draws as a box.
    if (line.charCodeAt(line.length - 1) === CHAR_CR) line = line.slice(0, -1);
    // The final element of a split on a trailing newline.
    if (!line && index === rows.length - 1) continue;

    const first = line.charCodeAt(0);

    if (first === CHAR_AT && line.charCodeAt(1) === CHAR_AT) {
      const match = HUNK_HEADER.exec(line);
      if (match) {
        const oldStart = Number.parseInt(match[1], 10);
        const newStart = Number.parseInt(match[3], 10);
        current = {
          header: line,
          heading: match[5].trim(),
          oldStart,
          oldLines: match[2] === undefined ? 1 : Number.parseInt(match[2], 10),
          newStart,
          newLines: match[4] === undefined ? 1 : Number.parseInt(match[4], 10),
          lines: [],
        };
        oldLine = oldStart;
        newLine = newStart;
      } else {
        // Malformed, and still a hunk: the lines under it are the reader's
        // change and are worth showing. They get no numbers, because a made-up
        // number in a diff gutter is worse than none.
        current = {
          header: line,
          heading: '',
          oldStart: 0,
          oldLines: 0,
          newStart: 0,
          newLines: 0,
          lines: [],
        };
        oldLine = 0;
        newLine = 0;
      }
      hunks.push(current);
      continue;
    }

    if (current === null) {
      // Before the first hunk: `diff --git`, `index`, mode lines, `---`/`+++`,
      // rename and similarity lines. None of them is a row.
      //
      // `Binary files … differ` and `GIT binary patch` are the one thing worth
      // keeping from this region, because they are the whole answer for the
      // file.
      if (
        (first === CHAR_B && line.startsWith('Binary files ')) ||
        (first === CHAR_G && line.startsWith('GIT binary patch'))
      ) {
        binary = true;
      }
      continue;
    }

    // `diff --git` while a hunk is open ends the previous file. The app asks
    // for one path at a time, so this is defensive rather than expected.
    if (first === CHAR_D && line.startsWith('diff --git ')) {
      current = null;
      continue;
    }

    if (first === CHAR_BACKSLASH) {
      // `\ No newline at end of file`, which belongs to the line above it.
      const previous = current.lines[current.lines.length - 1];
      if (previous) previous.noNewline = true;
      continue;
    }

    if (first === CHAR_PLUS) {
      current.lines.push({
        kind: 'added',
        text: line.slice(1),
        oldLine: null,
        newLine: newLine || null,
        noNewline: false,
      });
      if (newLine) newLine += 1;
      continue;
    }

    if (first === CHAR_MINUS) {
      current.lines.push({
        kind: 'removed',
        text: line.slice(1),
        oldLine: oldLine || null,
        newLine: null,
        noNewline: false,
      });
      if (oldLine) oldLine += 1;
      continue;
    }

    // A space is a context line; so is an empty line, which is what a tool that
    // strips trailing whitespace leaves behind where git wrote a lone space.
    if (first === CHAR_SPACE || line.length === 0) {
      current.lines.push({
        kind: 'context',
        text: line.length === 0 ? '' : line.slice(1),
        oldLine: oldLine || null,
        newLine: newLine || null,
        noNewline: false,
      });
      if (oldLine) oldLine += 1;
      if (newLine) newLine += 1;
      continue;
    }

    // Anything else inside a hunk is not part of the format. Dropped rather
    // than rendered as a line that lies about what changed.
  }

  return { hunks, binary };
}

// ---------------------------------------------------------------------------
// Flattening
// ---------------------------------------------------------------------------

/**
 * Everything the sheet knows about one file it has opened.
 *
 * The raw patch is not here on purpose: it is parsed on arrival and dropped,
 * and only `hunks` survives. `loadedLines` and `totalLines` are what the "show
 * more" row is computed from, so paging never has to consult the transport.
 */
export interface GitFilePatchState {
  hunks: GitDiffHunk[];
  binary: boolean;
  /** One past the last patch line in hand: the `from` of the next page. */
  loadedLines: number;
  totalLines: number;
  loading: boolean;
  /** A sentence already in the reader's language, or `null`. */
  error: string | null;
}

/** The empty state for a file that is expanding for the first time. */
export function emptyFilePatchState(): GitFilePatchState {
  return { hunks: [], binary: false, loadedLines: 0, totalLines: 0, loading: true, error: null };
}

/**
 * Appends a freshly parsed page to what is already in hand.
 *
 * Pure, and the only place page arithmetic happens. A page that starts before
 * where the last one ended is a re-read of the same range -- which is what a
 * retry after an error is -- so it replaces rather than duplicates.
 */
export function appendPatchPage(
  previous: GitFilePatchState | undefined,
  page: GitFilePatchPage,
  parsed: ParsedPatch
): GitFilePatchState {
  const base = previous && page.from > 0 && page.from <= previous.loadedLines ? previous : null;
  return {
    hunks: base ? [...base.hunks, ...parsed.hunks] : parsed.hunks,
    binary: parsed.binary || page.binary,
    loadedLines: Math.max(page.end, base?.loadedLines ?? 0),
    totalLines: Math.max(page.totalLines, page.end),
    loading: false,
    error: null,
  };
}

/** One row of the flat list the sheet draws. */
export type GitDiffRow =
  | {
      type: 'file';
      key: string;
      path: string;
      file: GitFileChange;
      expanded: boolean;
      loading: boolean;
      /** Binary, empty or failed: the one line under the path, or `null`. */
      note: 'binary' | 'empty' | 'error' | null;
      error: string | null;
    }
  | {
      type: 'hunk';
      key: string;
      path: string;
      header: string;
      heading: string;
    }
  | {
      type: 'line';
      key: string;
      path: string;
      kind: GitDiffLineKind;
      text: string;
      oldLine: number | null;
      newLine: number | null;
      noNewline: boolean;
    }
  | {
      type: 'more';
      key: string;
      path: string;
      /** How many patch lines are still unread. */
      remaining: number;
      loading: boolean;
    };

/** The kind of a row, which is also its size bucket and its recycling pool. */
export type GitDiffRowType = GitDiffRow['type'];

/**
 * The file list plus whatever has been expanded, as one flat array.
 *
 * Flat rather than sections, and a pure function rather than a reducer inside
 * the component, for the same two reasons: expanding a file is then a cheap
 * array rebuild that Legend List can diff, and the ordering rules are testable
 * without a renderer.
 *
 * Keys are stable across a rebuild and unique whatever a path contains -- the
 * indices come first, so no path can collide with another path's row.
 */
export function flattenDiffRows(
  files: readonly GitFileChange[],
  expanded: ReadonlySet<string>,
  pages: ReadonlyMap<string, GitFilePatchState>
): GitDiffRow[] {
  const rows: GitDiffRow[] = [];
  for (const file of files) {
    const open = expanded.has(file.path);
    const state = pages.get(file.path);
    const loading = open && (state?.loading ?? true);
    const binary = file.binary || (state?.binary ?? false);
    const error = state?.error ?? null;
    rows.push({
      type: 'file',
      key: `f:${file.path}`,
      path: file.path,
      file,
      expanded: open,
      loading,
      note:
        !open || loading
          ? null
          : error
            ? 'error'
            : binary
              ? 'binary'
              : (state?.hunks.length ?? 0) === 0
                ? 'empty'
                : null,
      error,
    });
    if (!open || !state || loading || error || binary) continue;

    for (let hunkIndex = 0; hunkIndex < state.hunks.length; hunkIndex += 1) {
      const hunk = state.hunks[hunkIndex];
      rows.push({
        type: 'hunk',
        key: `h:${hunkIndex}:${file.path}`,
        path: file.path,
        header: hunk.header,
        heading: hunk.heading,
      });
      for (let lineIndex = 0; lineIndex < hunk.lines.length; lineIndex += 1) {
        const line = hunk.lines[lineIndex];
        rows.push({
          type: 'line',
          key: `l:${hunkIndex}:${lineIndex}:${file.path}`,
          path: file.path,
          kind: line.kind,
          text: line.text,
          oldLine: line.oldLine,
          newLine: line.newLine,
          noNewline: line.noNewline,
        });
      }
    }

    if (state.loadedLines < state.totalLines) {
      rows.push({
        type: 'more',
        key: `m:${file.path}`,
        path: file.path,
        remaining: state.totalLines - state.loadedLines,
        loading: false,
      });
    }
  }
  return rows;
}

/**
 * The indices of the file headers, for `stickyHeaderIndices`: the file being
 * read is always named, however deep into its patch the reader has scrolled.
 */
export function fileHeaderIndices(rows: readonly GitDiffRow[]): number[] {
  const indices: number[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    if (rows[index].type === 'file') indices.push(index);
  }
  return indices;
}

/**
 * How wide the content is, in character cells: the longest line in hand.
 *
 * Counted over rows rather than measured per row, because the answer is one
 * number for the whole list and it only ever grows as pages arrive. Tabs count
 * as one cell here, which is what `<Text>` draws them as at a fixed advance.
 */
export function widestRow(rows: readonly GitDiffRow[], floor = 0): number {
  let widest = floor;
  for (const row of rows) {
    if (row.type === 'line') {
      if (row.text.length > widest) widest = row.text.length;
    } else if (row.type === 'hunk') {
      if (row.header.length > widest) widest = row.header.length;
    }
  }
  return widest;
}

/**
 * Whether a file is small enough to open without being asked.
 *
 * Only ever applied to a single-file change set: with more than one file on
 * screen, opening one of them is a choice about which one, and the sheet must
 * not make it.
 */
export function shouldAutoExpand(files: readonly GitFileChange[]): string | null {
  if (files.length !== 1) return null;
  const file = files[0];
  if (file.binary) return null;
  const total = (file.added ?? 0) + (file.removed ?? 0);
  return total > 0 && total <= AUTO_EXPAND_MAX_LINES ? file.path : null;
}

/**
 * The expansion set after a file is opened, with the oldest evicted past
 * `MAX_OPEN_FILES`.
 *
 * The order is the order files were opened in, so "least recently expanded" is
 * the head of the list. Returned as a new array; nothing here mutates.
 */
export function openFile(order: readonly string[], path: string): string[] {
  const next = order.filter((entry) => entry !== path);
  next.push(path);
  return next.length > MAX_OPEN_FILES ? next.slice(next.length - MAX_OPEN_FILES) : next;
}

/** The expansion set after a file is collapsed. */
export function closeFile(order: readonly string[], path: string): string[] {
  return order.filter((entry) => entry !== path);
}

/** `99+`, and the exact number below that. */
export function badgeCount(count: number): string {
  return count > MAX_BADGE_COUNT ? `${MAX_BADGE_COUNT}+` : `${Math.max(0, Math.trunc(count))}`;
}
