import { describe, expect, test } from 'bun:test';

import {
  buildChangeTree,
  changeTreeRows,
  defaultCollapsedDirs,
  listKeyOfDiffRow,
  nextDiffContext,
  stickyDiffRowsOf,
  visibleChangeTree,
  type ChangeTreeNode,
  type DiffListItem,
} from '../change-tree';
import { patchStateFromText } from '../agent-diff-rows';
import type { GitFileChange } from '../git-diff';

const f = (path: string) => ({ path });

/** The tree as indented text: `dir/` for a directory, the name for a file. */
function outline<T>(nodes: readonly ChangeTreeNode<T>[], depth = 0): string[] {
  const out: string[] = [];
  for (const node of nodes) {
    const pad = '  '.repeat(depth);
    if (node.kind === 'dir') {
      out.push(`${pad}${node.name}/ (${node.fileCount})`);
      out.push(...outline(node.children, depth + 1));
    } else {
      out.push(`${pad}${node.name}`);
    }
  }
  return out;
}

function change(path: string): GitFileChange {
  return {
    path,
    oldPath: null,
    status: 'modified',
    staged: false,
    unstaged: true,
    binary: false,
    added: 1,
    removed: 1,
  };
}

describe('buildChangeTree', () => {
  test('groups by directory', () => {
    const tree = buildChangeTree([f('src/a.ts'), f('src/b.ts'), f('lib/c.ts'), f('README.md')]);
    expect(outline(tree)).toEqual([
      'lib/ (1)',
      '  c.ts',
      'src/ (2)',
      '  a.ts',
      '  b.ts',
      'README.md',
    ]);
  });

  test('a chain of single-directory directories is one row', () => {
    const tree = buildChangeTree([
      f('packages/platform/src/adapters/one.ts'),
      f('packages/platform/src/adapters/two.ts'),
    ]);
    expect(outline(tree)).toEqual(['packages/platform/src/adapters/ (2)', '  one.ts', '  two.ts']);
    expect(tree[0]).toMatchObject({ path: 'packages/platform/src/adapters' });
  });

  test('the chain stops where a directory also holds a file, or forks', () => {
    const tree = buildChangeTree([
      f('a/b/x.ts'),
      f('a/b/c/d/y.ts'),
      f('a/b/c/d/z.ts'),
      f('a/b/c/e/w.ts'),
    ]);
    expect(outline(tree)).toEqual([
      'a/b/ (4)',
      '  c/ (3)',
      '    d/ (2)',
      '      y.ts',
      '      z.ts',
      '    e/ (1)',
      '      w.ts',
      '  x.ts',
    ]);
  });

  test('directories first, then files, each alphabetical regardless of input order', () => {
    const tree = buildChangeTree([
      f('zeta.ts'),
      f('Beta/x'),
      f('alpha/y'),
      f('Alpha.md'),
      f('b.ts'),
    ]);
    expect(tree.map((node) => `${node.kind}:${node.name}`)).toEqual([
      'dir:alpha',
      'dir:Beta',
      'file:Alpha.md',
      'file:b.ts',
      'file:zeta.ts',
    ]);
  });

  test('keys are the path with a kind prefix, stable across input order', () => {
    const one = buildChangeTree([f('a/b/c.ts'), f('a/d.ts')]);
    const two = buildChangeTree([f('a/d.ts'), f('a/b/c.ts')]);
    const keys = (nodes: readonly ChangeTreeNode<unknown>[]) =>
      visibleChangeTree(nodes, new Set()).map(({ node }) => node.key);
    expect(keys(one)).toEqual(['d:a', 'd:a/b', 'f:a/b/c.ts', 'f:a/d.ts']);
    expect(keys(two)).toEqual(keys(one));
  });

  test('a repeated path is listed once', () => {
    expect(outline(buildChangeTree([f('a.ts'), f('a.ts')]))).toEqual(['a.ts']);
  });
});

describe('visibleChangeTree', () => {
  test('a collapsed directory hides its subtree and keeps depth', () => {
    const tree = buildChangeTree([f('a/b/c.ts'), f('a/x/y.ts'), f('a/z.ts')]);
    expect(
      visibleChangeTree(tree, new Set(['a/b'])).map(({ node, depth }) => `${depth}:${node.name}`)
    ).toEqual(['0:a', '1:b', '1:x', '2:y.ts', '1:z.ts']);
  });
});

describe('defaultCollapsedDirs', () => {
  test('nothing collapses at forty files or fewer', () => {
    const files = Array.from({ length: 40 }, (_, i) => f(`big/${i}.ts`));
    expect(defaultCollapsedDirs(buildChangeTree(files), files.length).size).toBe(0);
  });

  test('above forty, directories with more than eight files collapse', () => {
    const files = [
      ...Array.from({ length: 35 }, (_, i) => f(`big/${i}.ts`)),
      ...Array.from({ length: 8 }, (_, i) => f(`small/${i}.ts`)),
    ];
    expect([...defaultCollapsedDirs(buildChangeTree(files), files.length)]).toEqual(['big']);
  });
});

describe('changeTreeRows', () => {
  const tree = buildChangeTree([change('src/a.ts'), change('src/b.ts')]);
  const patch = '@@ -1 +1 @@\n-x\n+y';

  test('directory and file rows, with depth and the file name only', () => {
    const rows = changeTreeRows({
      tree,
      collapsed: new Set(),
      expanded: new Set(),
      pages: new Map(),
    });
    expect(rows.map((row) => [row.type, row.key, 'depth' in row ? row.depth : null])).toEqual([
      ['dir', 'd:src', 0],
      ['treeFile', 'f:src/a.ts', 1],
      ['treeFile', 'f:src/b.ts', 1],
    ]);
    expect(rows[1]).toMatchObject({ name: 'a.ts', expanded: false });
  });

  test('an open file has its hunks under it, then the context row', () => {
    const rows = changeTreeRows({
      tree,
      collapsed: new Set(),
      expanded: new Set(['src/a.ts']),
      pages: new Map([['src/a.ts', patchStateFromText(patch)]]),
      moreContext: new Map([['src/a.ts', false]]),
      menuPath: 'src/b.ts',
    });
    expect(rows.map((row) => row.type)).toEqual([
      'dir',
      'treeFile',
      'hunk',
      'line',
      'line',
      'context',
      'treeFile',
      'actions',
    ]);
  });

  test('an open file still loading shows the spinner and no context row', () => {
    const rows = changeTreeRows({
      tree,
      collapsed: new Set(),
      expanded: new Set(['src/a.ts']),
      pages: new Map(),
      moreContext: new Map([['src/a.ts', false]]),
    });
    expect(rows[1]).toMatchObject({ type: 'treeFile', loading: true });
    expect(rows.some((row) => row.type === 'context')).toBe(false);
  });

  test('a collapsed directory hides its files', () => {
    const rows = changeTreeRows({
      tree,
      collapsed: new Set(['src']),
      expanded: new Set(['src/a.ts']),
      pages: new Map(),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: 'dir', collapsed: true, fileCount: 2 });
  });
});

describe('nextDiffContext', () => {
  test('3 → 10 → 25 → done', () => {
    expect(nextDiffContext(3)).toBe(10);
    expect(nextDiffContext(10)).toBe(25);
    expect(nextDiffContext(25)).toBeNull();
  });
});

describe('changeTreeRows unchanged', () => {
  test('a file the gateway called unchanged says so', () => {
    const tree = buildChangeTree([change('a.ts')]);
    const rows = changeTreeRows({
      tree,
      collapsed: new Set(),
      expanded: new Set(['a.ts']),
      pages: new Map([['a.ts', patchStateFromText('')]]),
      unchanged: new Set(['a.ts']),
    });
    expect(rows[0]).toMatchObject({ type: 'treeFile', unchanged: true, note: 'empty' });
  });
});

describe('stickyDiffRowsOf', () => {
  const file = { path: 'a.txt', status: 'modified', added: 1, removed: 0 } as GitFileChange;
  const treeFile = (key: string, expanded: boolean): DiffListItem => ({
    type: 'treeFile',
    key,
    path: key,
    name: key,
    depth: 0,
    file,
    expanded,
    loading: false,
    note: null,
    error: null,
    truncated: false,
    unchanged: false,
  });
  const line = (key: string): DiffListItem => ({
    type: 'line',
    key,
    path: 'a',
    kind: 'added',
    text: 'x',
    oldLine: null,
    newLine: 1,
    noNewline: false,
  });

  test('pins nothing while no patch is open', () => {
    const rows = [treeFile('f:a', false), treeFile('f:b', false)];
    expect(stickyDiffRowsOf(rows).indices).toEqual([]);
  });

  test('pins only the open files in the tree', () => {
    const rows = [
      treeFile('f:a', false),
      treeFile('f:b', true),
      line('l:1'),
      treeFile('f:c', false),
    ];
    const sticky = stickyDiffRowsOf(rows);
    expect(sticky.indices).toEqual([1]);
    expect([...sticky.keys]).toEqual(['f:b']);
  });

  test('a header that becomes sticky is known to the list by a new key', () => {
    const open = treeFile('f:b', true);
    const sticky = stickyDiffRowsOf([open, line('l:1')]);
    expect(listKeyOfDiffRow(open, sticky.keys)).not.toBe(open.key);
    expect(listKeyOfDiffRow(line('l:1'), sticky.keys)).toBe('l:1');
    expect(listKeyOfDiffRow(open, stickyDiffRowsOf([open]).keys)).toBe(open.key);
  });
});
