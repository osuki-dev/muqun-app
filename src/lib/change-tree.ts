import {
  flattenDiffRows,
  type GitDiffRow,
  type GitFileChange,
  type GitFilePatchState,
} from './git-diff';

/**
 * The agent's changed files as a directory tree.
 *
 * A flat list of repository paths is unreadable on a phone: every row starts
 * with the same `packages/platform/src/…` and the part that tells two files
 * apart is the part that gets cut. Grouped by directory, each row only has to
 * say its own name, and a directory that holds nothing but another directory
 * is one row (`packages/platform/src/adapters`) rather than four nested ones.
 *
 * Pure, and therefore tested. Keys are the path with a kind prefix -- `d:` for
 * a directory, `f:` for a file -- so they are stable across reloads and a file
 * row keeps the key `flattenDiffRows` gives it.
 */

export interface ChangeTreeDir<T> {
  kind: 'dir';
  key: string;
  /** The full directory path, without a trailing slash. */
  path: string;
  /** What the row says: one segment, or a compressed chain `a/b/c`. */
  name: string;
  children: ChangeTreeNode<T>[];
  /** Every file under this directory, however deep. */
  fileCount: number;
}

export interface ChangeTreeFile<T> {
  kind: 'file';
  key: string;
  path: string;
  /** The last path segment. */
  name: string;
  file: T;
}

export type ChangeTreeNode<T> = ChangeTreeDir<T> | ChangeTreeFile<T>;

interface MutableDir<T> {
  dirs: Map<string, MutableDir<T>>;
  files: ChangeTreeFile<T>[];
}

function segmentsOf(path: string): string[] {
  return path.split('/').filter((segment) => segment.length > 0 && segment !== '.');
}

/** Case-insensitive first so `README` sits beside `readme`, then exact so the order is total. */
function compareNames(a: string, b: string): number {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  if (la !== lb) return la < lb ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function freeze<T>(dir: MutableDir<T>, prefix: string): ChangeTreeNode<T>[] {
  const dirs: ChangeTreeDir<T>[] = [];
  for (const [segment, child] of dir.dirs) {
    let name = segment;
    let path = prefix ? `${prefix}/${segment}` : segment;
    let node = child;
    // A directory whose only content is one directory is one row.
    while (node.files.length === 0 && node.dirs.size === 1) {
      const [nextSegment, next] = node.dirs.entries().next().value as [string, MutableDir<T>];
      name = `${name}/${nextSegment}`;
      path = `${path}/${nextSegment}`;
      node = next;
    }
    const children = freeze(node, path);
    let fileCount = 0;
    for (const entry of children) fileCount += entry.kind === 'dir' ? entry.fileCount : 1;
    dirs.push({ kind: 'dir', key: `d:${path}`, path, name, children, fileCount });
  }
  dirs.sort((a, b) => compareNames(a.name, b.name));
  const files = [...dir.files].sort((a, b) => compareNames(a.name, b.name));
  return [...dirs, ...files];
}

/**
 * Groups files by directory: directories first, then files, each alphabetical.
 *
 * A path that appears twice keeps its first entry, so keys stay unique.
 */
export function buildChangeTree<T extends { path: string }>(
  files: readonly T[]
): ChangeTreeNode<T>[] {
  const root: MutableDir<T> = { dirs: new Map(), files: [] };
  const seen = new Set<string>();
  for (const file of files) {
    if (seen.has(file.path)) continue;
    seen.add(file.path);
    const segments = segmentsOf(file.path);
    if (segments.length === 0) continue;
    let dir = root;
    for (const segment of segments.slice(0, -1)) {
      let next = dir.dirs.get(segment);
      if (!next) {
        next = { dirs: new Map(), files: [] };
        dir.dirs.set(segment, next);
      }
      dir = next;
    }
    dir.files.push({
      kind: 'file',
      key: `f:${file.path}`,
      path: file.path,
      name: segments[segments.length - 1],
      file,
    });
  }
  return freeze(root, '');
}

/** Above this many files, the busiest directories start collapsed. */
export const CHANGE_TREE_COLLAPSE_ABOVE = 40;
/** A directory holding more than this many files is one of the busiest. */
export const CHANGE_TREE_BUSY_DIR = 8;

/**
 * Which directories start collapsed: none, unless the change is large, and
 * then the ones with more than eight files in them.
 */
export function defaultCollapsedDirs<T>(
  nodes: readonly ChangeTreeNode<T>[],
  totalFiles: number
): Set<string> {
  const collapsed = new Set<string>();
  if (totalFiles <= CHANGE_TREE_COLLAPSE_ABOVE) return collapsed;
  const visit = (list: readonly ChangeTreeNode<T>[]) => {
    for (const node of list) {
      if (node.kind !== 'dir') continue;
      if (node.fileCount > CHANGE_TREE_BUSY_DIR) collapsed.add(node.path);
      visit(node.children);
    }
  };
  visit(nodes);
  return collapsed;
}

export interface VisibleChangeTreeEntry<T> {
  node: ChangeTreeNode<T>;
  depth: number;
}

/** The nodes on screen, in order, with their depth; a collapsed directory hides its subtree. */
export function visibleChangeTree<T>(
  nodes: readonly ChangeTreeNode<T>[],
  collapsed: ReadonlySet<string>
): VisibleChangeTreeEntry<T>[] {
  const out: VisibleChangeTreeEntry<T>[] = [];
  const visit = (list: readonly ChangeTreeNode<T>[], depth: number) => {
    for (const node of list) {
      out.push({ node, depth });
      if (node.kind === 'dir' && !collapsed.has(node.path)) visit(node.children, depth + 1);
    }
  };
  visit(nodes, 0);
  return out;
}

// ---------------------------------------------------------------------------
// Row geometry
// ---------------------------------------------------------------------------

/**
 * A directory row's height. Fixed: a name never wraps, it is cut in the
 * middle on one line, so the list never measures a tree row.
 */
export const CHANGE_TREE_DIR_ROW_HEIGHT = 40;
/** A file row's height: its name on one line, and one line of note under it. */
export const CHANGE_TREE_FILE_ROW_HEIGHT = 48;
/** The row's own inset, before any indent. */
export const CHANGE_TREE_ROW_INSET = 16;
/** One level of the tree. */
export const CHANGE_TREE_INDENT = 16;
/**
 * The deepest a row is indented. A phone's width is what a name needs, and a
 * path six folders deep would otherwise spend a third of it on indent; deeper
 * levels share the third indent. Single-child chains are already one row.
 */
export const CHANGE_TREE_MAX_INDENT_LEVELS = 3;

/** Where a row at `depth` starts its content. */
export function changeTreeIndentOf(depth: number): number {
  const levels = Math.min(Math.max(0, depth), CHANGE_TREE_MAX_INDENT_LEVELS);
  return CHANGE_TREE_ROW_INSET + levels * CHANGE_TREE_INDENT;
}

// ---------------------------------------------------------------------------
// List rows
// ---------------------------------------------------------------------------

/** A directory row. The row is the toggle. */
export interface ChangeTreeDirRow {
  type: 'dir';
  key: string;
  path: string;
  name: string;
  depth: number;
  collapsed: boolean;
  fileCount: number;
}

/** A file row in the tree: its name, its status and counts, and the toggle for its patch. */
export interface ChangeTreeFileRow {
  type: 'treeFile';
  key: string;
  path: string;
  name: string;
  depth: number;
  file: GitFileChange;
  expanded: boolean;
  loading: boolean;
  note: 'binary' | 'empty' | 'error' | null;
  error: string | null;
  /** The gateway cut this file's patch. */
  truncated: boolean;
  /** The gateway said this file no longer differs (`unchanged`). */
  unchanged: boolean;
}

/** "Show more context", under an open file's last line. */
export interface ChangeTreeContextRow {
  type: 'context';
  key: string;
  path: string;
  loading: boolean;
}

/** The actions for one file, opened under it by a long press or its ⋯. */
export interface ChangeTreeActionsRow {
  type: 'actions';
  key: string;
  path: string;
}

export type ChangeTreeRow =
  | ChangeTreeDirRow
  | ChangeTreeFileRow
  | ChangeTreeContextRow
  | ChangeTreeActionsRow;

/** Every row the shared diff list can draw. */
export type DiffListItem = GitDiffRow | ChangeTreeRow;

export interface ChangeTreeRowsInput {
  tree: readonly ChangeTreeNode<GitFileChange>[];
  collapsed: ReadonlySet<string>;
  expanded: ReadonlySet<string>;
  pages: ReadonlyMap<string, GitFilePatchState>;
  /** Open files that can be asked for more context, and whether that is in flight. */
  moreContext?: ReadonlyMap<string, boolean>;
  /** Files whose patch the gateway cut. */
  truncated?: ReadonlySet<string>;
  /** Files the gateway answered `unchanged` for. */
  unchanged?: ReadonlySet<string>;
  /** The file whose actions are open, if any. */
  menuPath?: string | null;
}

const NO_PATHS: ReadonlySet<string> = new Set();
const NO_CONTEXT: ReadonlyMap<string, boolean> = new Map();

/**
 * The tree as the rows the diff list draws: directory rows, file rows, and an
 * open file's hunks and lines straight under it.
 *
 * The hunks come from `flattenDiffRows`, one file at a time, so the tree and
 * the terminal's flat sheet cannot drift into two parsings of a patch.
 */
export function changeTreeRows({
  tree,
  collapsed,
  expanded,
  pages,
  moreContext = NO_CONTEXT,
  truncated = NO_PATHS,
  unchanged = NO_PATHS,
  menuPath = null,
}: ChangeTreeRowsInput): DiffListItem[] {
  const rows: DiffListItem[] = [];
  for (const { node, depth } of visibleChangeTree(tree, collapsed)) {
    if (node.kind === 'dir') {
      rows.push({
        type: 'dir',
        key: node.key,
        path: node.path,
        name: node.name,
        depth,
        collapsed: collapsed.has(node.path),
        fileCount: node.fileCount,
      });
      continue;
    }
    const [head, ...body] = flattenDiffRows([node.file], expanded, pages);
    if (head?.type !== 'file') continue;
    rows.push({
      type: 'treeFile',
      key: head.key,
      path: head.path,
      name: node.name,
      depth,
      file: head.file,
      expanded: head.expanded,
      loading: head.loading,
      note: head.note,
      error: head.error,
      truncated: truncated.has(node.path),
      unchanged: unchanged.has(node.path),
    });
    if (menuPath === node.path) {
      rows.push({ type: 'actions', key: `a:${node.path}`, path: node.path });
    }
    rows.push(...body);
    const contextLoading = moreContext.get(node.path);
    if (head.expanded && contextLoading !== undefined && body.length > 0) {
      rows.push({
        type: 'context',
        key: `c:${node.path}`,
        path: node.path,
        loading: contextLoading,
      });
    }
  }
  return rows;
}

/**
 * The rows the diff list measures rather than being told a size: the flat
 * sheet's file header (see `fixedBodySizeOfDiffRow`) and a file's actions
 * menu. Every tree row is exact.
 */
export function isMeasuredDiffRow(row: DiffListItem): boolean {
  return row.type === 'file' || row.type === 'actions';
}

/** The context the next "Show more context" asks for, or `null` when there is no next step. */
export function nextDiffContext(current: number): number | null {
  if (current < 10) return 10;
  if (current < 25) return 25;
  return null;
}

/**
 * Whether collapsing a file should scroll the list back to its header.
 *
 * Only when the header has scrolled out above the viewport: the rows being
 * removed are then the ones on screen, and the offset would be left inside
 * text that is gone. A header still on screen stays exactly where the reader
 * tapped it -- landing on it would pull it to the top of the sheet.
 */
export function collapseLandsOnHeader(headerTop: number | undefined, scrollTop: number): boolean {
  return headerTop !== undefined && headerTop < scrollTop;
}
