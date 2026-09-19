import { describe, expect, test } from 'bun:test';

import {
  capDiffRows,
  countMarked,
  INLINE_DIFF_HARD_CAP,
  INLINE_DIFF_STEP_ROWS,
  stepDiffLimit,
  diffRowsForFence,
  diffRowsForPatch,
  diffRowsFromPatches,
  diffTotals,
  fileChangeFromDiffItem,
  fileStatusFromPatch,
  fileStatusFromWire,
  INLINE_DIFF_MAX_ROWS,
  oldPathFromPatch,
  patchStateFromText,
} from '../agent-diff-rows';

const MODIFIED = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1111111..2222222 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,3 +1,4 @@ function main()',
  ' const a = 1;',
  '-const b = 2;',
  '+const b = 3;',
  '+const c = 4;',
  ' export { a };',
].join('\n');

const CREATED = [
  'diff --git a/new.txt b/new.txt',
  'new file mode 100644',
  '--- /dev/null',
  '+++ b/new.txt',
  '@@ -0,0 +1,2 @@',
  '+one',
  '+two',
].join('\n');

const DELETED = [
  'diff --git a/gone.txt b/gone.txt',
  'deleted file mode 100644',
  '--- a/gone.txt',
  '+++ /dev/null',
  '@@ -1,1 +0,0 @@',
  '-bye',
].join('\n');

const RENAMED = [
  'diff --git a/old.txt b/new.txt',
  'similarity index 90%',
  'rename from old.txt',
  'rename to new.txt',
  '--- a/old.txt',
  '+++ b/new.txt',
  '@@ -1,1 +1,1 @@',
  '-a',
  '+b',
].join('\n');

describe('fileStatusFromPatch', () => {
  test('reads the status off the header git already wrote', () => {
    expect(fileStatusFromPatch(CREATED, 2, 0)).toBe('added');
    expect(fileStatusFromPatch(DELETED, 0, 1)).toBe('deleted');
    expect(fileStatusFromPatch(RENAMED, 1, 1)).toBe('renamed');
    expect(fileStatusFromPatch(MODIFIED, 2, 1)).toBe('modified');
  });

  test('falls back to the /dev/null side when there is no mode line', () => {
    const headerless = ['--- /dev/null', '+++ b/x', '@@ -0,0 +1 @@', '+x'].join('\n');
    expect(fileStatusFromPatch(headerless, 1, 0)).toBe('added');
    const removed = ['--- a/x', '+++ /dev/null', '@@ -1 +0,0 @@', '-x'].join('\n');
    expect(fileStatusFromPatch(removed, 0, 1)).toBe('deleted');
  });

  test('an empty patch is a modification, not a crash', () => {
    expect(fileStatusFromPatch('', 0, 0)).toBe('modified');
  });
});

describe('oldPathFromPatch', () => {
  test('a rename says where it came from', () => {
    expect(oldPathFromPatch(RENAMED)).toBe('old.txt');
  });

  test('anything else came from nowhere', () => {
    expect(oldPathFromPatch(MODIFIED)).toBeNull();
    expect(oldPathFromPatch('')).toBeNull();
  });
});

describe('countMarked', () => {
  test('counts markers and never the +++/--- file headers', () => {
    expect(countMarked(MODIFIED, '+')).toBe(2);
    expect(countMarked(MODIFIED, '-')).toBe(1);
    expect(countMarked(CREATED, '+')).toBe(2);
    expect(countMarked(CREATED, '-')).toBe(0);
    expect(countMarked('', '+')).toBe(0);
  });
});

describe('fileChangeFromDiffItem', () => {
  test('is the shape the shared file row reads', () => {
    const change = fileChangeFromDiffItem({
      path: 'src/a.ts',
      patch: MODIFIED,
      additions: 2,
      deletions: 1,
    });
    expect(change).toEqual({
      path: 'src/a.ts',
      oldPath: null,
      status: 'modified',
      // The agent's diff is the working tree against HEAD; there is no index
      // half to attribute it to.
      staged: false,
      unstaged: true,
      binary: false,
      added: 2,
      removed: 1,
    });
  });

  test("the engine's own status wins over the patch header", () => {
    // `…/vcs/diff` answers a modified file with a full-file patch often
    // enough that reading the header called every row "Added".
    expect(
      fileChangeFromDiffItem({
        path: 'README.md',
        patch: CREATED,
        additions: 3,
        deletions: 0,
        status: 'modified',
      }).status
    ).toBe('modified');
    // A status this app has never heard of is not a status; the header answers.
    expect(
      fileChangeFromDiffItem({
        path: 'README.md',
        patch: CREATED,
        additions: 3,
        deletions: 0,
        status: 'whatever',
      }).status
    ).toBe('added');
    expect(fileStatusFromWire(undefined)).toBeNull();
    expect(fileStatusFromWire('DELETED')).toBe('deleted');
  });

  test('a binary file is marked binary', () => {
    const change = fileChangeFromDiffItem({
      path: 'logo.png',
      patch: 'diff --git a/logo.png b/logo.png\nBinary files a/logo.png and b/logo.png differ\n',
      additions: 0,
      deletions: 0,
    });
    expect(change.binary).toBe(true);
  });
});

describe('patchStateFromText', () => {
  test('everything is in hand, so nothing is left to page', () => {
    const state = patchStateFromText(MODIFIED);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
    expect(state.hunks).toHaveLength(1);
    expect(state.loadedLines).toBe(state.totalLines);
    expect(state.hunks[0].lines.map((line) => line.kind)).toEqual([
      'context',
      'removed',
      'added',
      'added',
      'context',
    ]);
  });

  test('the gutter numbers come out of the hunk header', () => {
    const [hunk] = patchStateFromText(MODIFIED).hunks;
    expect(hunk.oldStart).toBe(1);
    expect(hunk.newStart).toBe(1);
    expect(hunk.heading).toBe('function main()');
    expect(hunk.lines[0]).toMatchObject({ oldLine: 1, newLine: 1 });
    expect(hunk.lines[1]).toMatchObject({ kind: 'removed', oldLine: 2, newLine: null });
    expect(hunk.lines[2]).toMatchObject({ kind: 'added', oldLine: null, newLine: 2 });
  });

  test('an empty patch parses to nothing rather than throwing', () => {
    const state = patchStateFromText('');
    expect(state.hunks).toEqual([]);
    expect(state.totalLines).toBe(0);
  });
});

describe('diffRowsFromPatches', () => {
  const files = [
    { path: 'src/a.ts', patch: MODIFIED, additions: 2, deletions: 1 },
    { path: 'new.txt', patch: CREATED, additions: 2, deletions: 0 },
  ];

  test('a collapsed set is one row per file', () => {
    const rows = diffRowsFromPatches(files, new Set());
    expect(rows.map((row) => row.type)).toEqual(['file', 'file']);
    expect(rows.map((row) => row.path)).toEqual(['src/a.ts', 'new.txt']);
  });

  test('an open file inserts its hunk and its lines under its own row', () => {
    const rows = diffRowsFromPatches(files, new Set(['src/a.ts']));
    expect(rows.map((row) => row.type)).toEqual([
      'file',
      'hunk',
      'line',
      'line',
      'line',
      'line',
      'line',
      'file',
    ]);
    // Everything is in hand, so there is never a "show more" row here.
    expect(rows.some((row) => row.type === 'more')).toBe(false);
  });

  test('keys are unique, which is what stops a row rendering twice', () => {
    const rows = diffRowsFromPatches(files, new Set(['src/a.ts', 'new.txt']));
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
  });

  test('no files is no rows, not an error', () => {
    expect(diffRowsFromPatches([], new Set())).toEqual([]);
  });
});

describe('diffRowsForPatch and diffRowsForFence', () => {
  test('one patch opens with its file row', () => {
    const rows = diffRowsForPatch('src/a.ts', MODIFIED);
    expect(rows[0]).toMatchObject({ type: 'file', path: 'src/a.ts', expanded: true });
    expect(rows[0]).toMatchObject({ file: { added: 2, removed: 1 } });
  });

  test('a fence has no file, so it has no file row', () => {
    const rows = diffRowsForFence(MODIFIED);
    expect(rows.some((row) => row.type === 'file')).toBe(false);
    expect(rows.map((row) => row.type)).toEqual(['hunk', 'line', 'line', 'line', 'line', 'line']);
  });

  test('a fence of prose that is not a patch draws nothing', () => {
    expect(diffRowsForFence('just some words\nand more of them')).toEqual([]);
  });
});

describe('capDiffRows', () => {
  const rows = diffRowsForFence(
    ['@@ -1,40 +1,40 @@', ...Array.from({ length: 40 }, (_, i) => ` line ${i}`)].join('\n')
  );

  test('under the cap nothing is held back, and the array is the same one', () => {
    const capped = capDiffRows(rows, 100);
    expect(capped.hidden).toBe(0);
    expect(capped.rows).toBe(rows);
  });

  test('over the cap the rest is counted rather than drawn', () => {
    const capped = capDiffRows(rows, 10);
    expect(capped.rows).toHaveLength(10);
    expect(capped.hidden).toBe(rows.length - 10);
  });

  test('the default is the inline budget', () => {
    expect(INLINE_DIFF_MAX_ROWS).toBe(60);
    expect(capDiffRows(rows).hidden).toBe(0);
  });

  test('a cap of zero draws nothing and says so', () => {
    expect(capDiffRows(rows, 0)).toEqual({ rows: [], hidden: rows.length });
  });
});

describe('stepDiffLimit', () => {
  /**
   * "Show the rest" used to mean exactly that: one tap replaced the cap with
   * the whole row list. Every row in an inline block is a mounted component
   * with its own animated style, and the block sits inside a timeline cell
   * inside a virtualised list -- so a six-thousand-line patch mounted six
   * thousand animated styles at once. The step is what stops that.
   */
  test('a tap adds a page rather than everything', () => {
    expect(stepDiffLimit(60)).toEqual({ limit: 60 + INLINE_DIFF_STEP_ROWS, exhausted: false });
  });

  test('stepping never passes the hard cap', () => {
    expect(stepDiffLimit(INLINE_DIFF_HARD_CAP - 1).limit).toBe(INLINE_DIFF_HARD_CAP);
    expect(stepDiffLimit(INLINE_DIFF_HARD_CAP).limit).toBe(INLINE_DIFF_HARD_CAP);
  });

  test('a block at the cap says it is out of room, so the tap is not offered', () => {
    expect(stepDiffLimit(INLINE_DIFF_HARD_CAP - 1).exhausted).toBe(true);
    expect(stepDiffLimit(INLINE_DIFF_HARD_CAP).exhausted).toBe(true);
    expect(stepDiffLimit(0).exhausted).toBe(false);
  });

  test('the bounds are the ones the block is built around', () => {
    expect(INLINE_DIFF_STEP_ROWS).toBe(200);
    expect(INLINE_DIFF_HARD_CAP).toBe(1000);
  });
});

describe('diffTotals', () => {
  test('adds the chips up across files', () => {
    expect(
      diffTotals([
        { path: 'a', patch: '', additions: 2, deletions: 1 },
        { path: 'b', patch: '', additions: 5, deletions: 0 },
      ])
    ).toEqual({ additions: 7, deletions: 1 });
    expect(diffTotals([])).toEqual({ additions: 0, deletions: 0 });
  });
});

describe('large collapsed diffs', () => {
  test('keeps only summaries until a file is expanded', () => {
    const patch = '@@ -0,0 +1,220 @@\n' + '+added line\n'.repeat(220);
    const files = Array.from({ length: 415 }, (_, i) => ({
      path: `file-${i}.ts`,
      patch,
      additions: 220,
      deletions: 0,
    }));
    const collapsed = diffRowsFromPatches(files, new Set());
    expect(collapsed).toHaveLength(415);
    expect(collapsed.every((row) => row.type === 'file')).toBe(true);
    const expanded = diffRowsFromPatches(files, new Set(['file-200.ts']));
    expect(expanded.filter((row) => row.type === 'line')).toHaveLength(220);
    expect(expanded.filter((row) => row.type === 'file')).toHaveLength(415);
  });

  test('reads binary and rename metadata only before the first hunk', () => {
    expect(
      fileChangeFromDiffItem({
        path: 'new.ts',
        additions: 1,
        deletions: 1,
        patch: 'rename from old.ts\r\nrename to new.ts\r\n@@ -1 +1 @@\r\n-before\r\n+after\r\n',
      })
    ).toMatchObject({ status: 'renamed', oldPath: 'old.ts', binary: false });
    expect(
      fileChangeFromDiffItem({
        path: 'image.png',
        additions: 0,
        deletions: 0,
        patch: 'diff --git a/image.png b/image.png\nGIT binary patch\nliteral 3\nabc',
      }).binary
    ).toBe(true);
  });
});
