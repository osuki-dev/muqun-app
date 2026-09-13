/**
 * The diff viewer's rules: what the parser makes of a patch, what the flattener
 * makes of a file list, and what the response parsers do when the gateway hands
 * back something other than what the contract promises.
 *
 * The load-bearing assertion in this file is not any one case -- it is that
 * every one of them produces rows or nothing, and never an exception. The sheet
 * is opened to look at work in progress, which is exactly when a patch is at
 * its least well-formed.
 */
import { describe, expect, test } from 'bun:test';

import {
  AUTO_EXPAND_MAX_LINES,
  GIT_DIFF_CAPABILITY,
  MAX_OPEN_FILES,
  NO_PATCH_CARRY,
  applyPatchPage,
  badgeCount,
  closeFile,
  emptyFilePatchState,
  fileHeaderIndices,
  flattenDiffRows,
  gatewaySupportsGitDiff,
  gatewaySupportsPaneContext,
  gitDiffPageFromResponse,
  gitStatusFromResponse,
  openFile,
  paneContextFromResponse,
  parseUnifiedPatch,
  shouldAutoExpand,
  widestRow,
  type GitFileChange,
  type GitFilePatchState,
} from '../git-diff';

function change(patch: Partial<GitFileChange> & Pick<GitFileChange, 'path'>): GitFileChange {
  return {
    oldPath: null,
    status: 'modified',
    staged: false,
    unstaged: true,
    binary: false,
    added: 1,
    removed: 1,
    ...patch,
  };
}

function state(patch: Partial<GitFilePatchState> = {}): GitFilePatchState {
  return { ...emptyFilePatchState(), loading: false, ...patch };
}

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

describe('capability gate', () => {
  test('an absent capability list is an older gateway', () => {
    expect(gatewaySupportsGitDiff(undefined)).toBe(false);
    expect(gatewaySupportsGitDiff(null)).toBe(false);
    expect(gatewaySupportsGitDiff([])).toBe(false);
  });

  test('the string has to be there', () => {
    expect(gatewaySupportsGitDiff(['agent_events'])).toBe(false);
    expect(gatewaySupportsGitDiff(['agent_events', GIT_DIFF_CAPABILITY])).toBe(true);
  });

  test('pane context is its own capability', () => {
    expect(gatewaySupportsPaneContext([GIT_DIFF_CAPABILITY])).toBe(false);
    expect(gatewaySupportsPaneContext(['pane_context'])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The parser
// ---------------------------------------------------------------------------

const MODIFIED = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1111111..2222222 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,4 +1,5 @@ export function a()',
  ' const first = 1;',
  '-const second = 2;',
  '+const second = 22;',
  '+const third = 3;',
  ' const last = 9;',
  '',
].join('\n');

describe('parseUnifiedPatch', () => {
  test('a modified file numbers both sides', () => {
    const { hunks, binary } = parseUnifiedPatch(MODIFIED);
    expect(binary).toBe(false);
    expect(hunks).toHaveLength(1);
    const hunk = hunks[0];
    expect(hunk.heading).toBe('export function a()');
    expect(hunk.oldStart).toBe(1);
    expect(hunk.oldLines).toBe(4);
    expect(hunk.newStart).toBe(1);
    expect(hunk.newLines).toBe(5);
    expect(hunk.lines.map((line) => line.kind)).toEqual([
      'context',
      'removed',
      'added',
      'added',
      'context',
    ]);
    expect(hunk.lines.map((line) => [line.oldLine, line.newLine])).toEqual([
      [1, 1],
      [2, null],
      [null, 2],
      [null, 3],
      [3, 4],
    ]);
    // The marker is off; the text is the line.
    expect(hunk.lines[2].text).toBe('const second = 22;');
  });

  test('metadata before the first hunk is not a row', () => {
    const { hunks } = parseUnifiedPatch(MODIFIED);
    expect(hunks[0].lines.some((line) => line.text.includes('a/src/a.ts'))).toBe(false);
  });

  test('a rename with no content change has no hunks and does not throw', () => {
    const patch = [
      'diff --git a/src/old.ts b/src/new.ts',
      'similarity index 100%',
      'rename from src/old.ts',
      'rename to src/new.ts',
      '',
    ].join('\n');
    expect(parseUnifiedPatch(patch)).toMatchObject({ hunks: [], binary: false });
  });

  test('a rename that also changed keeps its hunk', () => {
    const patch = [
      'diff --git a/src/old.ts b/src/new.ts',
      'similarity index 88%',
      'rename from src/old.ts',
      'rename to src/new.ts',
      '--- a/src/old.ts',
      '+++ b/src/new.ts',
      '@@ -3,2 +3,2 @@',
      '-old();',
      '+renamed();',
      '',
    ].join('\n');
    const { hunks } = parseUnifiedPatch(patch);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].lines.map((line) => line.text)).toEqual(['old();', 'renamed();']);
  });

  test('an added file is all additions against /dev/null', () => {
    const patch = [
      'diff --git a/src/new.ts b/src/new.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/src/new.ts',
      '@@ -0,0 +1,2 @@',
      '+export const one = 1;',
      '+export const two = 2;',
      '',
    ].join('\n');
    const { hunks } = parseUnifiedPatch(patch);
    expect(hunks[0].oldStart).toBe(0);
    expect(hunks[0].lines.every((line) => line.kind === 'added')).toBe(true);
    expect(hunks[0].lines.map((line) => line.newLine)).toEqual([1, 2]);
    // Nothing on the old side, so nothing is numbered there.
    expect(hunks[0].lines.every((line) => line.oldLine === null)).toBe(true);
  });

  test('a deleted file is all removals', () => {
    const patch = [
      'diff --git a/src/gone.ts b/src/gone.ts',
      'deleted file mode 100644',
      '--- a/src/gone.ts',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-export const one = 1;',
      '-export const two = 2;',
      '',
    ].join('\n');
    const { hunks } = parseUnifiedPatch(patch);
    expect(hunks[0].lines.every((line) => line.kind === 'removed')).toBe(true);
    expect(hunks[0].lines.map((line) => line.oldLine)).toEqual([1, 2]);
  });

  test('a removed line that looks like a header is still a removed line', () => {
    const patch = ['@@ -1,2 +1,1 @@', ' keep', '--- not a header', ''].join('\n');
    const { hunks } = parseUnifiedPatch(patch);
    expect(hunks[0].lines[1]).toMatchObject({ kind: 'removed', text: '-- not a header' });
  });

  test('"\\ No newline at end of file" marks the line above it', () => {
    const patch = [
      '@@ -1,1 +1,1 @@',
      '-one',
      '\\ No newline at end of file',
      '+two',
      '\\ No newline at end of file',
      '',
    ].join('\n');
    const { hunks } = parseUnifiedPatch(patch);
    expect(hunks[0].lines.map((line) => line.noNewline)).toEqual([true, true]);
    // And it is not itself a row.
    expect(hunks[0].lines).toHaveLength(2);
  });

  test('CRLF is stripped so a fixed-height row does not draw a box', () => {
    const patch = ['@@ -1,1 +1,1 @@\r', '-one\r', '+two\r', ''].join('\n');
    const { hunks } = parseUnifiedPatch(patch);
    expect(hunks[0].header).toBe('@@ -1,1 +1,1 @@');
    expect(hunks[0].lines.map((line) => line.text)).toEqual(['one', 'two']);
  });

  test('a binary marker is the whole answer', () => {
    const patch = [
      'diff --git a/assets/logo.png b/assets/logo.png',
      'index 3333333..4444444 100644',
      'Binary files a/assets/logo.png and b/assets/logo.png differ',
      '',
    ].join('\n');
    expect(parseUnifiedPatch(patch)).toMatchObject({ hunks: [], binary: true });
  });

  test('a GIT binary patch is binary too', () => {
    const patch = ['diff --git a/a.bin b/a.bin', 'GIT binary patch', 'literal 4', ''].join('\n');
    expect(parseUnifiedPatch(patch).binary).toBe(true);
  });

  test('an empty patch is no rows, not a throw', () => {
    expect(parseUnifiedPatch('')).toEqual({ hunks: [], binary: false, carry: NO_PATCH_CARRY });
    expect(parseUnifiedPatch('\n')).toMatchObject({ hunks: [], binary: false });
    // The signature says string; the wire says whatever it says.
    expect(parseUnifiedPatch(undefined as unknown as string)).toEqual({
      hunks: [],
      binary: false,
      carry: NO_PATCH_CARRY,
    });
  });

  test('a malformed hunk header still opens a hunk, with no numbers', () => {
    const patch = ['@@ nonsense @@', '-one', '+two', ''].join('\n');
    const { hunks } = parseUnifiedPatch(patch);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].header).toBe('@@ nonsense @@');
    expect(hunks[0].lines).toHaveLength(2);
    expect(hunks[0].lines.every((line) => line.oldLine === null && line.newLine === null)).toBe(
      true
    );
  });

  test('a page that starts at @@ parses on its own', () => {
    const patch = ['@@ -400,3 +400,4 @@ function later()', ' a', '+b', ' c', ''].join('\n');
    const { hunks } = parseUnifiedPatch(patch);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].oldStart).toBe(400);
    expect(hunks[0].lines[2].newLine).toBe(402);
  });

  test('a hunk header with no counts means one line each', () => {
    const { hunks } = parseUnifiedPatch(['@@ -7 +7 @@', '-a', '+b', ''].join('\n'));
    expect(hunks[0].oldLines).toBe(1);
    expect(hunks[0].newLines).toBe(1);
    expect(hunks[0].lines[0].oldLine).toBe(7);
  });

  test('two files in one patch are two runs of hunks', () => {
    const patch = [MODIFIED, 'diff --git a/b.ts b/b.ts', '@@ -1,1 +1,1 @@', '-x', '+y', ''].join(
      '\n'
    );
    const { hunks } = parseUnifiedPatch(patch);
    expect(hunks).toHaveLength(2);
    expect(hunks[1].lines.map((line) => line.text)).toEqual(['x', 'y']);
  });

  test('an empty context line survives as an empty line', () => {
    const patch = ['@@ -1,3 +1,3 @@', ' a', '', '+b', ''].join('\n');
    const { hunks } = parseUnifiedPatch(patch);
    expect(hunks[0].lines.map((line) => [line.kind, line.text])).toEqual([
      ['context', 'a'],
      ['context', ''],
      ['added', 'b'],
    ]);
  });

  test('a large patch parses without stack growth', () => {
    const body: string[] = ['@@ -1,6000 +1,6000 @@'];
    for (let index = 0; index < 6000; index += 1) body.push(` line ${index}`);
    const { hunks } = parseUnifiedPatch(body.join('\n'));
    expect(hunks[0].lines).toHaveLength(6000);
    expect(hunks[0].lines[5999].oldLine).toBe(6000);
  });
});

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

describe('paneContextFromResponse', () => {
  test('nothing at all is a pane with no cwd and no repo', () => {
    expect(paneContextFromResponse({})).toEqual({
      sessionId: '',
      paneId: '',
      cwd: null,
      cwdInFence: false,
      git: null,
      agent: null,
    });
    expect(paneContextFromResponse(undefined).git).toBeNull();
    expect(paneContextFromResponse('not an object').git).toBeNull();
  });

  test('the envelope is unwrapped, and a bare body parses too', () => {
    const data = {
      session_id: 'default',
      pane_id: 'wA:p1',
      cwd: '/Users/x/p/src',
      cwd_in_fence: true,
      git: {
        toplevel: '/Users/x/p',
        branch: 'feat/x',
        upstream: 'origin/main',
        ahead: 2,
        behind: 0,
        detached: false,
        head: '70c8c85',
        changed_files: 3,
      },
      agent: { kind: 'claude', status: 'working', foreground_command: 'claude', profile: true },
    };
    const wrapped = paneContextFromResponse({ schema_version: '1.5.0', capabilities: {}, data });
    expect(wrapped).toEqual(paneContextFromResponse(data));
    expect(wrapped.git?.branch).toBe('feat/x');
    expect(wrapped.git?.changedFiles).toBe(3);
    expect(wrapped.agent?.kind).toBe('claude');
  });

  test('a repo object with no toplevel is not a repo', () => {
    expect(paneContextFromResponse({ data: { git: { branch: 'main' } } }).git).toBeNull();
  });

  test('a partial repo keeps what it was given and nulls the rest', () => {
    const context = paneContextFromResponse({ data: { git: { toplevel: '/p' } } });
    expect(context.git).toEqual({
      toplevel: '/p',
      branch: null,
      upstream: null,
      ahead: null,
      behind: null,
      detached: false,
      head: null,
      changedFiles: 0,
    });
  });
});

describe('gitStatusFromResponse', () => {
  test('nothing at all is an empty, repo-less status', () => {
    expect(gitStatusFromResponse({})).toEqual({
      sessionId: '',
      paneId: '',
      repo: null,
      truncated: false,
      files: [],
    });
    expect(gitStatusFromResponse(null).files).toEqual([]);
  });

  test('a row with no path is dropped rather than drawn blank', () => {
    const status = gitStatusFromResponse({
      data: { files: [{ path: '' }, null, 'nope', { path: 'src/a.ts' }] },
    });
    expect(status.files.map((file) => file.path)).toEqual(['src/a.ts']);
  });

  test('an unknown status word is "unknown", not a crash', () => {
    const status = gitStatusFromResponse({
      data: { files: [{ path: 'a', status: 'exploded' }] },
    });
    expect(status.files[0].status).toBe('unknown');
  });

  test('a row that says neither staged nor unstaged is unstaged', () => {
    const status = gitStatusFromResponse({ data: { files: [{ path: 'a' }] } });
    expect(status.files[0]).toMatchObject({ staged: false, unstaged: true });
  });

  test('the whole contract round-trips', () => {
    const status = gitStatusFromResponse({
      schema_version: '1.5.0',
      data: {
        session_id: 'default',
        pane_id: 'wA:p1',
        repo: { toplevel: '/p', changed_files: 2 },
        truncated: true,
        files: [
          {
            path: 'src/a.ts',
            old_path: 'src/b.ts',
            status: 'renamed',
            staged: true,
            unstaged: false,
            binary: false,
            added: 41,
            removed: 6,
          },
        ],
      },
    });
    expect(status.truncated).toBe(true);
    expect(status.files[0]).toEqual({
      path: 'src/a.ts',
      oldPath: 'src/b.ts',
      status: 'renamed',
      staged: true,
      unstaged: false,
      binary: false,
      added: 41,
      removed: 6,
    });
  });
});

describe('gitDiffPageFromResponse', () => {
  test('nothing at all is an empty page that cannot ask for more', () => {
    const page = gitDiffPageFromResponse({}, 'src/a.ts');
    expect(page).toEqual({
      path: 'src/a.ts',
      binary: false,
      from: 0,
      end: 0,
      totalLines: 0,
      truncated: false,
      patch: '',
    });
  });

  test('a page with no end is measured from the patch it carries', () => {
    const page = gitDiffPageFromResponse({ data: { patch: 'a\nb\nc\n' } });
    expect(page.end).toBe(3);
    expect(page.totalLines).toBe(3);
  });

  test('a total smaller than the end is raised to it, so paging terminates', () => {
    const page = gitDiffPageFromResponse({
      data: { from: 0, end: 900, total_lines: 10, patch: '@@ -1,1 +1,1 @@' },
    });
    expect(page.totalLines).toBe(900);
  });

  test('the contract round-trips', () => {
    const page = gitDiffPageFromResponse({
      data: {
        session_id: 'default',
        pane_id: 'wA:p1',
        path: 'src/a.ts',
        binary: false,
        from: 0,
        end: 812,
        total_lines: 812,
        truncated: false,
        patch: '@@ -1,1 +1,1 @@\n-a\n+b\n',
      },
    });
    expect(page).toMatchObject({ path: 'src/a.ts', from: 0, end: 812, totalLines: 812 });
  });
});

// ---------------------------------------------------------------------------
// Flattening
// ---------------------------------------------------------------------------

const FILES: GitFileChange[] = [
  change({ path: 'src/a.ts' }),
  change({ path: 'src/b.ts', status: 'added', added: 12, removed: 0 }),
  change({ path: 'assets/logo.png', status: 'modified', binary: true, added: null, removed: null }),
];

describe('flattenDiffRows', () => {
  test('collapsed is one row per file, in the list’s own order', () => {
    const rows = flattenDiffRows(FILES, new Set(), new Map());
    expect(rows.map((row) => row.type)).toEqual(['file', 'file', 'file']);
    expect(rows.map((row) => row.path)).toEqual(['src/a.ts', 'src/b.ts', 'assets/logo.png']);
    expect(rows.every((row) => row.type === 'file' && !row.expanded)).toBe(true);
  });

  test('expanding inserts the hunk and its lines under that file only', () => {
    const parsed = parseUnifiedPatch(MODIFIED);
    const pages = new Map([
      ['src/a.ts', state({ hunks: parsed.hunks, loadedLines: 11, totalLines: 11 })],
    ]);
    const rows = flattenDiffRows(FILES, new Set(['src/a.ts']), pages);
    expect(rows.map((row) => row.type)).toEqual([
      'file',
      'hunk',
      'line',
      'line',
      'line',
      'line',
      'line',
      'file',
      'file',
    ]);
    expect(rows[1]).toMatchObject({ path: 'src/a.ts', heading: 'export function a()' });
  });

  test('a file still loading shows no rows under it and no note', () => {
    const pages = new Map([['src/a.ts', emptyFilePatchState()]]);
    const rows = flattenDiffRows(FILES, new Set(['src/a.ts']), pages);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ type: 'file', loading: true, note: null });
  });

  test('an expanded file with no page yet is treated as loading', () => {
    const rows = flattenDiffRows(FILES, new Set(['src/a.ts']), new Map());
    expect(rows[0]).toMatchObject({ loading: true });
    expect(rows).toHaveLength(3);
  });

  test('binary, empty and failed each get their one-line note', () => {
    const pages = new Map<string, GitFilePatchState>([
      ['assets/logo.png', state({ binary: true })],
      ['src/b.ts', state({ error: 'Could not read the diff.' })],
      ['src/a.ts', state({ hunks: [] })],
    ]);
    const rows = flattenDiffRows(FILES, new Set(FILES.map((file) => file.path)), pages);
    expect(rows.filter((row) => row.type === 'file').map((row) => row.note)).toEqual([
      'empty',
      'error',
      'binary',
    ]);
    // None of the three opens any rows under it.
    expect(rows).toHaveLength(3);
  });

  test('a part-loaded file ends in a "show more" row carrying what is left', () => {
    const parsed = parseUnifiedPatch(MODIFIED);
    const pages = new Map([
      ['src/a.ts', state({ hunks: parsed.hunks, loadedLines: 4000, totalLines: 6000 })],
    ]);
    const rows = flattenDiffRows(FILES, new Set(['src/a.ts']), pages);
    const more = rows.find((row) => row.type === 'more');
    expect(more).toMatchObject({ type: 'more', path: 'src/a.ts', remaining: 2000 });
  });

  test('a fully loaded file has no "show more" row', () => {
    const parsed = parseUnifiedPatch(MODIFIED);
    const pages = new Map([
      ['src/a.ts', state({ hunks: parsed.hunks, loadedLines: 11, totalLines: 11 })],
    ]);
    expect(
      flattenDiffRows(FILES, new Set(['src/a.ts']), pages).some((r) => r.type === 'more')
    ).toBe(false);
  });

  test('keys are stable across a rebuild and unique whatever the path holds', () => {
    const parsed = parseUnifiedPatch(MODIFIED);
    const awkward: GitFileChange[] = [
      change({ path: 'a:1:weird.ts' }),
      change({ path: 'a:1' }),
      change({ path: 'l:0:0:a' }),
    ];
    const pages = new Map(
      awkward.map((file) => [
        file.path,
        state({ hunks: parsed.hunks, loadedLines: 11, totalLines: 11 }),
      ])
    );
    const expanded = new Set(awkward.map((file) => file.path));
    const first = flattenDiffRows(awkward, expanded, pages);
    const second = flattenDiffRows(awkward, expanded, pages);
    expect(first.map((row) => row.key)).toEqual(second.map((row) => row.key));
    expect(new Set(first.map((row) => row.key)).size).toBe(first.length);
  });

  test('collapsing a file restores exactly the collapsed list', () => {
    const parsed = parseUnifiedPatch(MODIFIED);
    const pages = new Map([
      ['src/a.ts', state({ hunks: parsed.hunks, loadedLines: 11, totalLines: 11 })],
    ]);
    const collapsed = flattenDiffRows(FILES, new Set(), pages);
    const expanded = flattenDiffRows(FILES, new Set(['src/a.ts']), pages);
    expect(expanded.length).toBeGreaterThan(collapsed.length);
    expect(flattenDiffRows(FILES, new Set(), pages).map((row) => row.key)).toEqual(
      collapsed.map((row) => row.key)
    );
  });

  test('an empty file list is an empty row list', () => {
    expect(flattenDiffRows([], new Set(['x']), new Map())).toEqual([]);
  });
});

describe('fileHeaderIndices', () => {
  test('names every file header, in order', () => {
    const parsed = parseUnifiedPatch(MODIFIED);
    const pages = new Map([
      ['src/a.ts', state({ hunks: parsed.hunks, loadedLines: 11, totalLines: 11 })],
    ]);
    const rows = flattenDiffRows(FILES, new Set(['src/a.ts']), pages);
    expect(fileHeaderIndices(rows)).toEqual([0, 7, 8]);
  });
});

describe('widestRow', () => {
  test('the longest loaded line in cells, never below the floor', () => {
    const parsed = parseUnifiedPatch(MODIFIED);
    const pages = new Map([
      ['src/a.ts', state({ hunks: parsed.hunks, loadedLines: 11, totalLines: 11 })],
    ]);
    const rows = flattenDiffRows(FILES, new Set(['src/a.ts']), pages);
    expect(widestRow(rows)).toBe('@@ -1,4 +1,5 @@ export function a()'.length);
    expect(widestRow([], 40)).toBe(40);
  });
});

// ---------------------------------------------------------------------------
// Paging and expansion bookkeeping
// ---------------------------------------------------------------------------

function page(data: Record<string, unknown>) {
  return gitDiffPageFromResponse({ data });
}

describe('applyPatchPage', () => {
  test('the first page replaces whatever was there', () => {
    const next = applyPatchPage(
      undefined,
      page({ from: 0, end: 11, total_lines: 24, patch: MODIFIED })
    );
    expect(next.hunks).toHaveLength(1);
    expect(next.loadedLines).toBe(11);
    expect(next.totalLines).toBe(24);
    expect(next.loading).toBe(false);
  });

  test('a following page appends', () => {
    const first = applyPatchPage(
      undefined,
      page({ from: 0, end: 11, total_lines: 24, patch: MODIFIED })
    );
    const next = applyPatchPage(
      first,
      page({ from: 11, end: 24, total_lines: 24, patch: '@@ -20,1 +20,2 @@\n a\n+b\n' })
    );
    expect(next.hunks).toHaveLength(2);
    expect(next.loadedLines).toBe(24);
  });

  test('a re-read of the same range replaces rather than duplicating', () => {
    const first = applyPatchPage(
      undefined,
      page({ from: 0, end: 11, total_lines: 24, patch: MODIFIED })
    );
    const again = applyPatchPage(
      first,
      page({ from: 0, end: 11, total_lines: 24, patch: MODIFIED })
    );
    expect(again.hunks).toHaveLength(1);
  });

  test('a binary page stays binary however it was flagged', () => {
    expect(applyPatchPage(undefined, page({ binary: true, patch: '' })).binary).toBe(true);
  });

  /**
   * The case the gateway found against a real repository: one hunk longer than
   * a page. It is cut raw, so the second page opens with no header at all and
   * the only thing that can number its lines is the carry from the first.
   */
  test('a single hunk split across two pages numbers continuously', () => {
    const head = [
      'diff --git a/src/big.ts b/src/big.ts',
      'index aaaaaaa..bbbbbbb 100644',
      '--- a/src/big.ts',
      '+++ b/src/big.ts',
      '@@ -1,50 +1,50 @@',
    ];
    const body: string[] = [];
    for (let index = 0; index < 50; index += 1) body.push(` line ${index}`);

    const firstPatch = [...head, ...body.slice(0, 10)].join('\n') + '\n';
    const first = applyPatchPage(
      undefined,
      page({ from: 0, end: 15, total_lines: 55, patch: firstPatch })
    );
    expect(first.hunks).toHaveLength(1);
    expect(first.hunks[0].lines).toHaveLength(10);
    expect(first.carry).toEqual({ oldLine: 11, newLine: 11, inHunk: true });

    const secondPatch = body.slice(10).join('\n') + '\n';
    const second = applyPatchPage(
      first,
      page({ from: 15, end: 55, total_lines: 55, patch: secondPatch })
    );
    // One hunk still, not two, and no headerless hunk anywhere.
    expect(second.hunks).toHaveLength(1);
    expect(second.hunks[0].header).toBe('@@ -1,50 +1,50 @@');
    expect(second.hunks[0].lines).toHaveLength(50);
    expect(second.hunks[0].lines.map((line) => line.oldLine)).toEqual(
      Array.from({ length: 50 }, (_unused, index) => index + 1)
    );
    expect(second.hunks[0].lines.map((line) => line.newLine)).toEqual(
      Array.from({ length: 50 }, (_unused, index) => index + 1)
    );

    // And the rows the sheet draws are one hunk header and fifty lines.
    const files = [change({ path: 'src/big.ts' })];
    const rows = flattenDiffRows(files, new Set(['src/big.ts']), new Map([['src/big.ts', second]]));
    expect(rows.filter((row) => row.type === 'hunk')).toHaveLength(1);
    expect(rows.filter((row) => row.type === 'line')).toHaveLength(50);
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
  });

  test('a page that opens mid-hunk and then starts a new one keeps both', () => {
    const first = applyPatchPage(
      undefined,
      page({ from: 0, end: 3, total_lines: 9, patch: '@@ -1,4 +1,4 @@\n a\n b\n' })
    );
    const second = applyPatchPage(
      first,
      page({ from: 3, end: 9, total_lines: 9, patch: ' c\n d\n@@ -40,1 +40,1 @@\n-x\n+y\n' })
    );
    expect(second.hunks).toHaveLength(2);
    expect(second.hunks[0].lines.map((line) => line.text)).toEqual(['a', 'b', 'c', 'd']);
    expect(second.hunks[0].lines[3].oldLine).toBe(4);
    expect(second.hunks[1].lines[0].oldLine).toBe(40);
  });

  test('continuation lines on a first page are metadata, and are dropped', () => {
    const only = applyPatchPage(
      undefined,
      page({ from: 0, end: 2, total_lines: 2, patch: ' a\n b\n' })
    );
    expect(only.hunks).toEqual([]);
  });

  test('a carry that catches nothing leaves no headerless hunk behind', () => {
    const first = applyPatchPage(
      undefined,
      page({ from: 0, end: 3, total_lines: 6, patch: '@@ -1,2 +1,2 @@\n a\n b\n' })
    );
    expect(first.carry.inHunk).toBe(true);
    const second = applyPatchPage(
      first,
      page({ from: 3, end: 6, total_lines: 6, patch: '@@ -9,1 +9,1 @@\n-x\n+y\n' })
    );
    expect(second.hunks).toHaveLength(2);
    expect(second.hunks.every((hunk) => hunk.header !== '')).toBe(true);
  });
});

describe('openFile / closeFile', () => {
  test('opening moves a file to the most recent end', () => {
    expect(openFile(['a', 'b'], 'a')).toEqual(['b', 'a']);
    expect(openFile(['a'], 'c')).toEqual(['a', 'c']);
  });

  test('past the cap the least recently expanded falls off the front', () => {
    let order: string[] = [];
    for (let index = 0; index < MAX_OPEN_FILES + 3; index += 1) {
      order = openFile(order, `file-${index}`);
    }
    expect(order).toHaveLength(MAX_OPEN_FILES);
    expect(order[0]).toBe('file-3');
    expect(order[MAX_OPEN_FILES - 1]).toBe(`file-${MAX_OPEN_FILES + 2}`);
  });

  test('closing removes exactly one file and keeps the order', () => {
    expect(closeFile(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
    expect(closeFile(['a'], 'z')).toEqual(['a']);
  });
});

describe('shouldAutoExpand', () => {
  test('only ever with a single file', () => {
    expect(shouldAutoExpand(FILES)).toBeNull();
    expect(shouldAutoExpand([])).toBeNull();
  });

  test('a small single change opens itself', () => {
    expect(shouldAutoExpand([change({ path: 'src/a.ts', added: 4, removed: 2 })])).toBe('src/a.ts');
  });

  test('a large one does not, however alone it is', () => {
    expect(
      shouldAutoExpand([change({ path: 'src/a.ts', added: AUTO_EXPAND_MAX_LINES, removed: 1 })])
    ).toBeNull();
  });

  test('binary and unmeasured files never open themselves', () => {
    expect(shouldAutoExpand([change({ path: 'a.png', binary: true, added: 1, removed: 1 })])).toBe(
      null
    );
    expect(shouldAutoExpand([change({ path: 'a.ts', added: null, removed: null })])).toBeNull();
  });
});

describe('badgeCount', () => {
  test('counts, and stops counting at ninety-nine', () => {
    expect(badgeCount(0)).toBe('0');
    expect(badgeCount(3)).toBe('3');
    expect(badgeCount(99)).toBe('99');
    expect(badgeCount(100)).toBe('99+');
    expect(badgeCount(-2)).toBe('0');
  });
});
