import {
  flattenDiffRows,
  NO_PATCH_CARRY,
  parseUnifiedPatch,
  type GitDiffRow,
  type GitFileChange,
  type GitFilePatchState,
  type GitFileStatus,
} from './git-diff';
import type { FileDiffItem } from './agent-protocol';

/**
 * A unified patch the agent already handed us, as the rows the diff viewer
 * draws.
 *
 * The terminal side fetches its patches a page at a time from the gateway, so
 * `applyPatchPage` does the arithmetic there. The agent side never pages: an
 * `edit` tool call carries `metadata.files[].patch` whole, and `…/vcs/diff`
 * answers with every file's patch in one body. So the whole text is parsed once
 * and the state is built literally, which is the twenty lines that let both
 * surfaces render through the very same row components.
 *
 * Pure, and therefore tested. Nothing here fetches and nothing here throws:
 * `parseUnifiedPatch` already promises the second, and a patch that parses to
 * nothing is a file with no textual change rather than an error.
 */

/** How many rows an inline block draws before it offers the rest. */
export const INLINE_DIFF_MAX_ROWS = 60;

/** How many more it draws each time the reader asks. */
export const INLINE_DIFF_STEP_ROWS = 200;

/**
 * The most an inline block will ever draw, however many times it is asked.
 *
 * "Show the rest" used to mean exactly that: one tap replaced the cap with the
 * whole row list, and every row in an inline block is a mounted component with
 * its own `useAnimatedStyle` -- so a six-thousand-line patch inside a timeline
 * cell mounted six thousand animated styles at once, in a cell that is itself
 * inside a virtualised list. Past this, the answer is the sheet, which is
 * virtualised and recycles.
 */
export const INLINE_DIFF_HARD_CAP = 1000;

/**
 * The next cap after a tap, and whether the block has run out of room.
 *
 * Pure so the two bounds can be tested rather than trusted: stepping never
 * passes the hard cap, and a block already at it says so instead of offering a
 * tap that would do nothing.
 */
export function stepDiffLimit(current: number): { limit: number; exhausted: boolean } {
  const next = Math.min(current + INLINE_DIFF_STEP_ROWS, INLINE_DIFF_HARD_CAP);
  return { limit: next, exhausted: next >= INLINE_DIFF_HARD_CAP };
}

/**
 * What git would have called this change, read out of the patch header.
 *
 * `…/vcs/diff` and a tool's `metadata.files[]` do not carry a status, and a
 * file row that said "Changed" for a file that was created is a worse answer
 * than one read off the `new file mode` line git puts there itself.
 */
export function fileStatusFromPatch(
  patch: string,
  additions: number,
  deletions: number
): GitFileStatus {
  if (/^new file mode /m.test(patch)) return 'added';
  if (/^deleted file mode /m.test(patch)) return 'deleted';
  if (/^rename from /m.test(patch)) return 'renamed';
  if (/^copy from /m.test(patch)) return 'copied';
  if (additions > 0 && deletions === 0 && /^--- \/dev\/null$/m.test(patch)) return 'added';
  if (deletions > 0 && additions === 0 && /^\+\+\+ \/dev\/null$/m.test(patch)) return 'deleted';
  return 'modified';
}

/**
 * Every status OpenCode may state on a `FileDiff.Info`, as this app names it.
 *
 * The wire word is preferred over the patch header whenever it is one this app
 * knows: the header is a guess from text, and a `…/vcs/diff` patch that opens
 * against `/dev/null` is a full-file diff of a file that already existed as
 * often as it is a new one.
 */
const WIRE_FILE_STATUS: Readonly<Record<string, GitFileStatus>> = {
  added: 'added',
  add: 'added',
  new: 'added',
  created: 'added',
  modified: 'modified',
  modify: 'modified',
  changed: 'modified',
  deleted: 'deleted',
  delete: 'deleted',
  removed: 'deleted',
  renamed: 'renamed',
  rename: 'renamed',
  copied: 'copied',
  copy: 'copied',
  untracked: 'untracked',
  conflicted: 'conflicted',
  type_changed: 'type_changed',
};

/** The status OpenCode stated, or `null` when it stated nothing this app knows. */
export function fileStatusFromWire(status: string | undefined): GitFileStatus | null {
  if (!status) return null;
  return WIRE_FILE_STATUS[status.trim().toLowerCase()] ?? null;
}

/** Where a rename came from, or `null`. */
export function oldPathFromPatch(patch: string): string | null {
  return /^rename from (.+)$/m.exec(patch)?.[1] ?? /^copy from (.+)$/m.exec(patch)?.[1] ?? null;
}

/** One agent-side file, in the shape the shared file row reads. */
export function fileChangeFromDiffItem(item: FileDiffItem): GitFileChange {
  const parsed = parseUnifiedPatch(item.patch);
  return {
    path: item.path,
    oldPath: oldPathFromPatch(item.patch),
    status:
      fileStatusFromWire(item.status) ??
      fileStatusFromPatch(item.patch, item.additions, item.deletions),
    // The agent's diff is the working tree against HEAD; there is no index
    // half to attribute it to, and claiming one would be a lie the `all` view's
    // S/U marks would then repeat.
    staged: false,
    unstaged: true,
    binary: parsed.binary,
    added: item.additions,
    removed: item.deletions,
  };
}

/** The whole patch, parsed once, as the state the row flattener consumes. */
export function patchStateFromText(patch: string): GitFilePatchState {
  const parsed = parseUnifiedPatch(patch);
  const lines = patch ? patch.split('\n').length : 0;
  return {
    hunks: parsed.hunks,
    binary: parsed.binary,
    // Everything is in hand, so there is nothing left to page and no "show
    // more" row: `loadedLines` is deliberately not below `totalLines`.
    loadedLines: lines,
    totalLines: lines,
    loading: false,
    error: null,
    carry: NO_PATCH_CARRY,
  };
}

/**
 * The flat rows for a set of patches, with `expanded` naming the files whose
 * bodies are open.
 *
 * The same `flattenDiffRows` the terminal's sheet uses, so the two surfaces
 * cannot drift into two orderings or two key schemes.
 */
export function diffRowsFromPatches(
  files: readonly FileDiffItem[],
  expanded: ReadonlySet<string>
): GitDiffRow[] {
  const changes: GitFileChange[] = [];
  const pages = new Map<string, GitFilePatchState>();
  for (const file of files) {
    changes.push(fileChangeFromDiffItem(file));
    if (expanded.has(file.path)) pages.set(file.path, patchStateFromText(file.patch));
  }
  return flattenDiffRows(changes, expanded, pages);
}

/**
 * The rows of a bare patch, with no file row above them.
 *
 * A ` ```diff ``` ` fence in a model's prose names no file, and a `diff` part
 * carries its file name in a header of its own. Both want the hunks and the
 * lines and neither wants the file row, so this is the same flattener minus a
 * row rather than a second flattener.
 */
export function diffRowsForFence(patch: string): GitDiffRow[] {
  return diffRowsForPatch('', patch).filter((row) => row.type !== 'file');
}

/** The rows for one patch with its file row already open. */
export function diffRowsForPatch(path: string, patch: string): GitDiffRow[] {
  const additions = countMarked(patch, '+');
  const deletions = countMarked(patch, '-');
  return diffRowsFromPatches([{ path, patch, additions, deletions }], new Set([path]));
}

/** Added or removed lines, not counting the `+++`/`---` file headers. */
export function countMarked(patch: string, marker: '+' | '-'): number {
  if (!patch) return 0;
  const header = marker.repeat(3);
  let count = 0;
  for (const line of patch.split('\n')) {
    if (line.startsWith(marker) && !line.startsWith(header)) count += 1;
  }
  return count;
}

export interface CappedDiffRows {
  rows: readonly GitDiffRow[];
  /** How many rows were held back, which is what the affordance offers. */
  hidden: number;
}

/**
 * The first `limit` rows, and a count of the rest.
 *
 * An inline diff lives inside a timeline cell, and a timeline cell is inside a
 * list. A nested virtualised list is the hazard this exists to avoid, and a
 * six-thousand-row `.map()` is the hazard on the other side of it -- so the
 * block draws a bounded number of rows and says how many it is not drawing.
 * Expanding is the reader's decision, never a side effect of having scrolled.
 */
export function capDiffRows(
  rows: readonly GitDiffRow[],
  limit: number = INLINE_DIFF_MAX_ROWS
): CappedDiffRows {
  if (limit <= 0) return { rows: [], hidden: rows.length };
  if (rows.length <= limit) return { rows, hidden: 0 };
  return { rows: rows.slice(0, limit), hidden: rows.length - limit };
}

/** The additions and deletions across a set of patches, for the chips. */
export function diffTotals(files: readonly FileDiffItem[]): {
  additions: number;
  deletions: number;
} {
  let additions = 0;
  let deletions = 0;
  for (const file of files) {
    additions += file.additions;
    deletions += file.deletions;
  }
  return { additions, deletions };
}
