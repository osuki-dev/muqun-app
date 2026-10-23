import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { type LegendListRef } from '@legendapp/list/react-native';
import { Dialog, useThemeTokens, useToast, Text } from '@osuki-dev/ui';
import { PressableScale } from '@/components/pressable-scale';
import { plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { BranchIcon, RefreshIcon, TerminalIcon } from '@/icons';

import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import type { ChangeTreeHandlers } from '@/components/change-tree-rows';
import { DiffRowList } from '@/components/diff-rows';
import { usePaneChatColors } from '@/components/pane-chat-blocks';
import { SettingsSegmented } from '@/components/settings-segmented';
import {
  SheetScene,
  SheetSceneNotice,
  SheetSceneQuietControl,
  SHEET_LADDER,
} from '@/components/sheet-scene';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { useMonoFontFamily } from '@/hooks/use-user-fonts';
import { patchStateFromText } from '@/lib/agent-diff-rows';
import type { VcsFilesMode, VcsRepoState } from '@/lib/agent-protocol';
import { agentRequestErrorDetail, isAgentOfflineError } from '@/lib/agent-request-error';
import { diffEmptyState } from '@/lib/agent-workspace-missing';
import {
  buildChangeTree,
  collapseLandsOnHeader,
  defaultCollapsedDirs,
  groupChanges,
  groupedChangeTreeRows,
  nextDiffContext,
  type ChangeTreeSection,
} from '@/lib/change-tree';
import { repoLine, type ChangeListing, type ChangesApi } from '@/lib/changes-api';
import type { ChangesWorktreeContext } from '@/lib/changes-worktree-context';
import {
  applyPatchPage,
  closeFile,
  DIFF_CONTEXT_LINES,
  emptyFilePatchState,
  openFile,
  type GitFileChange,
  type GitFilePatchState,
} from '@/lib/git-diff';
import { fadeIn } from '@/lib/motion';
import { describeGatewayFailure } from '@/lib/network-error';

/**
 * What changed on disk, as a native form sheet route: the one Changes sheet,
 * for an agent session and for a terminal pane alike.
 *
 * Read top to bottom the way a reader supervising an agent from a phone asks
 * the questions: which branch, in the heading's detail line; whether it is
 * dirty and by how much, in the caption; which comparison, as a segmented
 * control when the gateway offers a base; which checkout, as the caller's
 * switcher; then the files, grouped the way `git status` reports them
 * (conflicts, staged, unstaged, untracked) when the listing carries the
 * index, each row opening its patch in place.
 *
 * Where the answers come from is the `api` adapter's business
 * (`changes-api.ts`), and decides only how a patch arrives:
 *
 * - `lazy`: `…/vcs/files` lists the files without a single patch, and a
 *   file's patch is fetched when the file is opened (three lines of context,
 *   more on request) and kept per scope and path. The reader can also discard
 *   one file's uncommitted changes.
 * - `eager`: an agent's `…/vcs/diff` answered every patch at once.
 * - `paged`: a pane's `…/git/status` listed the files and `…/git/diff` pages
 *   one file's patch at a time, with "show more" under the last page.
 *
 * The scope is uncommitted changes, and "compared with {base}" when the
 * listing names a base to compare with.
 */
export interface ChangesSheetProps {
  testID: string;
  title?: string;
  /**
   * Memoised by the caller: a new adapter is a new source. The sheet notices
   * the change, forgets the old listing and reloads, without remounting.
   */
  api: ChangesApi;
  /** A file to open and land on once the uncommitted listing has it. */
  targetPath?: string;
  /** Verified checkout context, not a branch or an inferred workspace label. */
  worktree?: ChangesWorktreeContext;
  /** Pinned under the heading: a checkout switcher and its notices. */
  switcher?: ReactNode;
  /** Asked again whenever the reader refreshes the changes. */
  onRefresh?: () => void;
  /** The host's Git TUI, when the gateway offers it for this pane. */
  lazygit?: { busy: boolean; open: () => void };
}

/** One file's fetched patch, per scope and path (`lazy` listings). */
interface PatchEntry {
  context: number;
  loading: boolean;
  patch: string | null;
  truncated: boolean;
  /** The gateway said `unchanged`: there is nothing between the two sides any more. */
  unchanged: boolean;
  error: string | null;
}

const EMPTY_LISTING: ChangeListing = {
  changes: [],
  source: 'lazy',
  patches: new Map(),
  truncated: false,
};

/**
 * Which branch the repository is on: `⎇ feat/x → fork/x ↑2 ↓1`, `detached at
 * abc1234`, or a branch with no commits yet. The names are drawn in the mono
 * face because they are copied character for character, cut in the middle so
 * both the prefix and the tail of a long name survive. No fill of its own: it
 * sits on the sheet's ground like the caption above it.
 */
const ChangesRepoLine = memo(function ChangesRepoLine({ repo }: { repo: VcsRepoState }) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const mono = useMonoFontFamily();
  const line = repoLine(repo);
  if (!line) return null;
  const color = theme.colors.textMuted;
  const monoStyle = { fontFamily: mono };
  let label: string;
  let content: ReactNode;
  if (line.kind === 'detached') {
    const head = line.head;
    label = t`Detached at ${head}`;
    // The sentence is the locale's, the commit id inside it is the mono run:
    // split at the id rather than nesting a second `Text`, whose own variant
    // would reset the caption's size.
    const sentence = t`detached at ${head}`;
    const at = sentence.indexOf(head);
    const before = at < 0 ? sentence : sentence.slice(0, at).trimEnd();
    const after = at < 0 ? '' : sentence.slice(at + head.length).trimStart();
    content = (
      <>
        {before ? (
          <Text variant="caption" color={color} numberOfLines={1} style={styles.repoFixed}>
            {before}
          </Text>
        ) : null}
        {at < 0 ? null : (
          <Text
            variant="caption"
            color={color}
            numberOfLines={1}
            style={[styles.repoFixed, monoStyle]}>
            {head}
          </Text>
        )}
        {after ? (
          <Text variant="caption" color={color} numberOfLines={1} style={styles.repoFixed}>
            {after}
          </Text>
        ) : null}
      </>
    );
  } else if (line.kind === 'unborn') {
    const branch = line.branch;
    label = branch ? t`Branch ${branch}, no commits yet` : t`No commits yet`;
    content = (
      <>
        {branch ? (
          <Text
            variant="caption"
            color={color}
            numberOfLines={1}
            ellipsizeMode="middle"
            style={[styles.repoName, monoStyle]}>
            {branch}
          </Text>
        ) : null}
        <Text variant="caption" color={color} numberOfLines={1} style={styles.repoFixed}>
          <Trans>no commits yet</Trans>
        </Text>
      </>
    );
  } else {
    const { branch, upstream, ahead, behind } = line;
    const parts = [t`Branch ${branch}`];
    if (upstream) parts.push(t`tracking ${upstream}`);
    if (ahead > 0) parts.push(t`${ahead} ahead`);
    if (behind > 0) parts.push(t`${behind} behind`);
    label = parts.join(', ');
    content = (
      <>
        <Text
          variant="caption"
          color={color}
          numberOfLines={1}
          ellipsizeMode="middle"
          style={[styles.repoName, monoStyle]}>
          {branch}
        </Text>
        {upstream ? (
          <Text
            variant="caption"
            color={color}
            numberOfLines={1}
            ellipsizeMode="middle"
            style={[styles.repoUpstream, monoStyle]}>
            {`→ ${upstream}`}
          </Text>
        ) : null}
        {line.sync ? (
          <Text variant="caption" color={color} numberOfLines={1} style={styles.repoFixed}>
            {line.sync}
          </Text>
        ) : null}
      </>
    );
  }
  return (
    <View testID="changes-branch" accessible accessibilityLabel={label} style={styles.repoLine}>
      <BranchIcon size={12} color={color} />
      {content}
    </View>
  );
});

function ChangesWorktreeLine({ worktree }: { worktree: ChangesWorktreeContext }) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const mono = useMonoFontFamily();
  const { name, directory } = worktree;
  return (
    <View
      testID="changes-worktree"
      accessible
      accessibilityLabel={t`Worktree ${name}, ${directory}`}>
      <Text variant="caption" color={theme.colors.text} numberOfLines={1} ellipsizeMode="middle">
        <Trans>Worktree {name}</Trans>
      </Text>
      <Text
        variant="caption"
        color={theme.colors.textMuted}
        numberOfLines={1}
        ellipsizeMode="middle"
        style={{ fontFamily: mono }}>
        {directory}
      </Text>
    </View>
  );
}

/**
 * One of the things to do from an empty sheet: a small raised chip, so two of
 * them read as a pair of equal offers rather than as a form's one button.
 */
function EmptyAction({
  label,
  onPress,
  busy = false,
  testID,
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  testID?: string;
}) {
  const theme = useThemeTokens();
  const profile = useAppearanceProfile();
  const surfaceBackground = useSurfaceBackground();
  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy, disabled: busy }}
      disabled={busy}
      onPress={onPress}
      style={[
        styles.emptyAction,
        {
          borderRadius: profile.chrome.control,
          backgroundColor: surfaceBackground(theme.colors.surfaceRaised),
        },
      ]}>
      {busy ? (
        <ActivityIndicator size="small" color={theme.colors.primary} />
      ) : (
        <Text variant="caption" weight="semibold" color={theme.colors.text}>
          {label}
        </Text>
      )}
    </PressableScale>
  );
}

function patchKey(scope: VcsFilesMode, path: string): string {
  return `${scope}\n${path}`;
}

/** Every directory a path sits in: `a/b/c.ts` → `a`, `a/b`. */
function ancestorsOf(path: string): string[] {
  const parts = path.split('/');
  const out: string[] = [];
  for (let index = 1; index < parts.length; index += 1) out.push(parts.slice(0, index).join('/'));
  return out;
}

export const ChangesSheet = memo(function ChangesSheet({
  testID,
  title,
  api,
  targetPath,
  worktree,
  switcher,
  onRefresh,
  lazygit,
}: ChangesSheetProps) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const surfaceBackground = useSurfaceBackground();
  const colors = usePaneChatColors();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listing, setListing] = useState<ChangeListing>(EMPTY_LISTING);
  const [scope, setScope] = useState<VcsFilesMode>('working');
  /** Bumped by the refresh control: the same scope, asked again. */
  const [reload, setReload] = useState(0);
  /** The ref "compared with" names; kept across scopes once the gateway has said it. */
  const [base, setBase] = useState<string | undefined>(undefined);
  /** Where the repository stands; kept across scopes and reloads until a listing says otherwise. */
  const [repo, setRepo] = useState<VcsRepoState | undefined>(undefined);
  /** Which files are open, oldest first: see `openFile` for the eviction rule. */
  const [expandedOrder, setExpandedOrder] = useState<readonly string[]>([]);
  const [collapsedDirs, setCollapsedDirs] = useState<ReadonlySet<string>>(() => new Set());
  const [patches, setPatches] = useState<Readonly<Record<string, PatchEntry>>>({});
  const [pages, setPages] = useState<ReadonlyMap<string, GitFilePatchState>>(() => new Map());
  const [menuPath, setMenuPath] = useState<string | null>(null);
  const [discardTarget, setDiscardTarget] = useState<GitFileChange | null>(null);
  const listRef = useRef<LegendListRef | null>(null);
  const pendingTargetPath = useRef(targetPath);
  const pendingTargetKey = useRef<string | null>(null);
  /** A refresh keeps the reader's open files and folders; a new scope does not. */
  const refreshing = useRef(false);
  /** The adapter the listing in hand came from; a different one is a different source. */
  const listedApi = useRef<ChangesApi | null>(null);
  /** Bumped whenever the patches in hand stop being current, so a late answer is dropped. */
  const patchGeneration = useRef(0);
  const pageRequests = useRef(new Map<string, AbortController>());

  useEffect(
    () => () => {
      for (const controller of pageRequests.current.values()) controller.abort();
      pageRequests.current.clear();
    },
    []
  );

  const patchLoadFailed = t`Could not load this file's changes.`;
  /** One file's patch at `context`, keeping what is on screen until the answer lands. */
  const fetchPatch = useCallback(
    (forScope: VcsFilesMode, path: string, context: number) => {
      const key = patchKey(forScope, path);
      const generation = patchGeneration.current;
      setPatches((prev) => ({
        ...prev,
        [key]: {
          context: prev[key]?.context ?? context,
          loading: true,
          patch: prev[key]?.patch ?? null,
          truncated: prev[key]?.truncated ?? false,
          unchanged: prev[key]?.unchanged ?? false,
          error: null,
        },
      }));
      api
        .file({ mode: forScope, path, context })
        .then((answer) => {
          if (generation !== patchGeneration.current) return;
          setPatches((prev) => ({
            ...prev,
            [key]: {
              context,
              loading: false,
              patch: answer.patch,
              truncated: answer.truncated,
              unchanged: answer.unchanged,
              error: null,
            },
          }));
        })
        .catch(() => {
          if (generation !== patchGeneration.current) return;
          setPatches((prev) => ({
            ...prev,
            [key]: {
              context: prev[key]?.context ?? context,
              loading: false,
              patch: prev[key]?.patch ?? null,
              truncated: prev[key]?.truncated ?? false,
              unchanged: prev[key]?.unchanged ?? false,
              error: patchLoadFailed,
            },
          }));
        });
    },
    [api, patchLoadFailed]
  );

  const pageLoadFailed = t`Could not read this file.`;
  /** One page of one file's patch (`paged` listings), appended to what is in hand. */
  const fetchPage = useCallback(
    (file: GitFileChange, from: number) => {
      if (!api.page) return;
      const path = file.path;
      pageRequests.current.get(path)?.abort();
      const controller = new AbortController();
      pageRequests.current.set(path, controller);
      setPages((previous) => {
        const next = new Map(previous);
        next.set(path, {
          ...(previous.get(path) ?? emptyFilePatchState()),
          loading: true,
          error: null,
        });
        return next;
      });
      api
        .page(file, from, controller.signal)
        .then((page) => {
          if (controller.signal.aborted) return;
          pageRequests.current.delete(path);
          setPages((previous) => {
            const next = new Map(previous);
            // The raw patch is parsed here and dropped here: only rows survive.
            next.set(path, applyPatchPage(from > 0 ? previous.get(path) : undefined, page));
            return next;
          });
        })
        .catch((failure) => {
          if (controller.signal.aborted) return;
          pageRequests.current.delete(path);
          const message = describeGatewayFailure(failure, pageLoadFailed).message;
          setPages((previous) => {
            const next = new Map(previous);
            const current = previous.get(path) ?? emptyFilePatchState();
            next.set(path, { ...current, loading: false, error: message });
            return next;
          });
        });
    },
    [api, pageLoadFailed]
  );

  const dropPages = useCallback((paths: readonly string[]) => {
    if (paths.length === 0) return;
    for (const path of paths) {
      pageRequests.current.get(path)?.abort();
      pageRequests.current.delete(path);
    }
    setPages((previous) => {
      const next = new Map(previous);
      for (const path of paths) next.delete(path);
      return next;
    });
  }, []);

  const listingFailed = t`Could not read the changes.`;
  // Fetched once per opening, once per scope, once per refresh, and once per
  // adapter: a route mounts when it opens, and a checkout switch hands the
  // sheet a new adapter in place.
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const keepPlace = refreshing.current;
    refreshing.current = false;
    if (listedApi.current !== api) {
      // Another source: the rows in hand are another checkout's, and so are
      // the base and the files the reader had open.
      listedApi.current = api;
      setListing(EMPTY_LISTING);
      setExpandedOrder([]);
      setMenuPath(null);
      setError(null);
      setBase(undefined);
    }
    setLoading(true);
    api
      .listing(scope, controller.signal)
      .then((next) => {
        if (!active) return;
        setError(null);
        if (next.reason === 'no_default_branch') {
          // Nothing to compare with after all: the option goes, and the sheet
          // goes back to what it can show.
          setBase(undefined);
          setScope('working');
          return;
        }
        setListing(next);
        if (next.base) setBase(next.base);
        setRepo(next.repo);
        // Every patch in hand is now of unknown age: dropped, and refetched
        // for the files that stay open.
        patchGeneration.current += 1;
        setPatches({});
        for (const request of pageRequests.current.values()) request.abort();
        pageRequests.current.clear();
        setPages(new Map());
        if (keepPlace) {
          // Which files were open is the reader's choice, not the gateway's --
          // minus any that no longer exist.
          const paths = new Set(next.changes.map((change) => change.path));
          setExpandedOrder((order) => order.filter((path) => paths.has(path)));
          return;
        }
        const requestedPath = scope === 'working' ? pendingTargetPath.current : undefined;
        const matchedPath = requestedPath
          ? next.changes.find((file) => file.path === requestedPath)?.path
          : undefined;
        // A single changed file is opened without being asked; with more than
        // one on screen, opening one of them is a choice the sheet must not make
        // unless the route names the file the reader just came from.
        const openedPath =
          matchedPath ?? (next.changes.length === 1 ? next.changes[0].path : undefined);
        setExpandedOrder(openedPath ? [openedPath] : []);
        const collapsed = defaultCollapsedDirs(buildChangeTree(next.changes), next.changes.length);
        if (openedPath) for (const dir of ancestorsOf(openedPath)) collapsed.delete(dir);
        setCollapsedDirs(collapsed);
        if (matchedPath) {
          pendingTargetPath.current = undefined;
          pendingTargetKey.current = `f:${matchedPath}`;
        }
      })
      .catch((failure) => {
        if (!active) return;
        console.warn('Failed to load VCS changes:', failure);
        setError(describeGatewayFailure(failure, listingFailed).message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [api, scope, reload, listingFailed]);

  const refresh = useCallback(() => {
    setMenuPath(null);
    refreshing.current = true;
    setReload((count) => count + 1);
    onRefresh?.();
  }, [onRefresh]);
  const retry = useCallback(() => setReload((count) => count + 1), []);

  const changeScope = useCallback(
    (next: VcsFilesMode) => {
      if (next === scope) return;
      // A different comparison is different text; the list starts collapsed
      // again, which is also the honest reading position.
      setExpandedOrder([]);
      setMenuPath(null);
      setListing(EMPTY_LISTING);
      setScope(next);
    },
    [scope]
  );

  const changesByPath = useMemo(
    () => new Map(listing.changes.map((change) => [change.path, change])),
    [listing.changes]
  );

  /**
   * An open file with no patch in hand gets one: opened by a tap, by the
   * single-file rule, by the route, or kept open across a refresh. Each fetch
   * writes a loading entry first, which is what stops this from asking twice.
   */
  useEffect(() => {
    for (const path of expandedOrder) {
      const change = changesByPath.get(path);
      if (!change) continue;
      if (listing.source === 'lazy') {
        if (!change.binary && !patches[patchKey(scope, path)]) {
          fetchPatch(scope, path, DIFF_CONTEXT_LINES);
        }
      } else if (listing.source === 'paged' && !pages.has(path)) {
        fetchPage(change, 0);
      }
    }
  }, [changesByPath, expandedOrder, fetchPage, fetchPatch, listing.source, pages, patches, scope]);

  /**
   * The file header to land on once the rows change, keyed like the row.
   *
   * Collapsing a file the reader is deep into removes every row under the
   * viewport, and the offset is left past the end of the content: a blank
   * sheet. The header just tapped is both still there and what they asked to
   * see. Only then, though: a header still on screen stays where it was
   * tapped, held there by the list's own position keeping. Landing on it
   * anyway pulls it to the top of the sheet, which reads as the list jumping.
   */
  const landOnRef = useRef<string | null>(null);
  const toggleFile = useCallback(
    (path: string) => {
      setMenuPath(null);
      if (expandedOrder.includes(path)) {
        const key = `f:${path}`;
        const state = listRef.current?.getState();
        if (state && collapseLandsOnHeader(state.positionByKey(key), state.scroll)) {
          landOnRef.current = key;
        }
        setExpandedOrder(closeFile(expandedOrder, path));
        if (listing.source === 'paged') dropPages([path]);
        // A failed fetch is asked again the next time the file opens.
        const entryKey = patchKey(scope, path);
        if (patches[entryKey]?.error && patches[entryKey]?.patch === null) {
          setPatches((prev) => {
            const next = { ...prev };
            delete next[entryKey];
            return next;
          });
        }
        return;
      }
      const next = openFile(expandedOrder, path);
      setExpandedOrder(next);
      // Past the cap, the least recently opened file goes with its page.
      if (listing.source === 'paged') {
        const kept = new Set(next);
        dropPages(expandedOrder.filter((entry) => !kept.has(entry)));
      }
    },
    [dropPages, expandedOrder, listing.source, patches, scope]
  );

  const toggleDir = useCallback((path: string) => {
    setCollapsedDirs((current) => {
      const next = new Set(current);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  }, []);

  const moreContext = useCallback(
    (path: string) => {
      const entry = patches[patchKey(scope, path)];
      const next = entry ? nextDiffContext(entry.context) : null;
      if (next !== null) fetchPatch(scope, path, next);
    },
    [fetchPatch, patches, scope]
  );

  /** The next page of a `paged` file's patch. */
  const showMore = useCallback(
    (path: string) => {
      const state = pages.get(path);
      const change = changesByPath.get(path);
      if (!state || state.loading || !change) return;
      fetchPage(change, state.loadedLines);
    },
    [changesByPath, fetchPage, pages]
  );

  // Discarding is offered for uncommitted changes only, and only by a gateway
  // that lists files itself: a comparison with the base is history, and the
  // routes every gateway has carry no discard to go with them.
  // A cut listing is refused (`409 listing_truncated`): the gateway cannot
  // vouch for a path it did not list in full, so the action is not offered.
  const canDiscard =
    Boolean(api.discard) && listing.source === 'lazy' && scope === 'working' && !listing.truncated;
  const { showToast } = useToast();
  const openFileActions = useCallback((path: string) => {
    setMenuPath((current) => (current === path ? null : path));
  }, []);
  const askDiscard = useCallback(
    (path: string) => {
      setMenuPath(null);
      setDiscardTarget(changesByPath.get(path) ?? null);
    },
    [changesByPath]
  );
  const cancelDiscard = useCallback(() => setDiscardTarget(null), []);
  const discardFailed = (name: string) => t`Could not discard ${name}`;
  const gatewayUnreachable = t`The computer could not be reached.`;
  const discardFallback = t`Nothing was changed.`;
  const confirmDiscard = () => {
    const target = discardTarget;
    setDiscardTarget(null);
    if (!target || !api.discard) return;
    api
      .discard(target.path)
      .then(() => {
        setListing((current) => ({
          ...current,
          changes: current.changes.filter((change) => change.path !== target.path),
        }));
        setExpandedOrder((order) => closeFile(order, target.path));
        setPatches((prev) => {
          const next = { ...prev };
          delete next[patchKey('working', target.path)];
          delete next[patchKey('branch', target.path)];
          return next;
        });
      })
      .catch((err) => {
        // `409 listing_truncated`, `403 repository_is_home`,
        // `403 path_outside_repository`, `404 unknown_path`: one title, and
        // the gateway's own sentence under it.
        const detail = agentRequestErrorDetail(err);
        showToast({
          variant: 'danger',
          title: discardFailed(target.path.split('/').pop() ?? target.path),
          message: isAgentOfflineError(err)
            ? gatewayUnreachable
            : (detail.message ?? detail.code ?? discardFallback),
        });
      });
  };

  const treeHandlers = useMemo<ChangeTreeHandlers>(
    () => ({
      onToggleDir: toggleDir,
      onMoreContext: moreContext,
      onFileActions: canDiscard ? openFileActions : undefined,
      onDiscard: askDiscard,
    }),
    [askDiscard, canDiscard, moreContext, openFileActions, toggleDir]
  );

  const expanded = useMemo(() => new Set(expandedOrder), [expandedOrder]);
  /**
   * The files by status group, one tree each. Only `…/git/status` says where
   * a change sits in the index; the `vcs/files` routes answer one flag for
   * every file, so their listing has one tracked group and no headings.
   */
  const sections = useMemo<ChangeTreeSection[]>(
    () =>
      groupChanges(listing.changes, listing.source === 'paged').map((group) => ({
        group,
        tree: buildChangeTree(group.files),
      })),
    [listing.changes, listing.source]
  );
  const {
    pages: openPages,
    contextOffers,
    truncatedPaths,
    unchangedPaths,
  } = useMemo(() => {
    const pageMap = new Map<string, GitFilePatchState>();
    const offers = new Map<string, boolean>();
    const cut = new Set<string>();
    const same = new Set<string>();
    for (const path of expandedOrder) {
      const change = changesByPath.get(path);
      if (!change) continue;
      if (listing.source === 'eager') {
        pageMap.set(path, patchStateFromText(listing.patches.get(path) ?? ''));
        continue;
      }
      if (listing.source === 'paged') {
        const page = pages.get(path);
        if (page) pageMap.set(path, page);
        continue;
      }
      if (change.binary) {
        pageMap.set(path, { ...emptyFilePatchState(), loading: false });
        continue;
      }
      const entry = patches[patchKey(scope, path)];
      if (!entry || entry.patch === null) {
        pageMap.set(path, {
          ...emptyFilePatchState(),
          loading: !entry || entry.loading,
          error: entry?.error ?? null,
        });
        continue;
      }
      pageMap.set(path, patchStateFromText(entry.patch));
      if (entry.truncated) cut.add(path);
      if (entry.unchanged) same.add(path);
      if (nextDiffContext(entry.context) !== null) offers.set(path, entry.loading);
    }
    return { pages: pageMap, contextOffers: offers, truncatedPaths: cut, unchangedPaths: same };
  }, [changesByPath, expandedOrder, listing.patches, listing.source, pages, patches, scope]);

  const rows = useMemo(
    () =>
      groupedChangeTreeRows(sections, {
        collapsed: collapsedDirs,
        expanded,
        pages: openPages,
        moreContext: contextOffers,
        truncated: truncatedPaths,
        unchanged: unchangedPaths,
        menuPath: canDiscard ? menuPath : null,
      }),
    [
      canDiscard,
      collapsedDirs,
      contextOffers,
      expanded,
      menuPath,
      openPages,
      sections,
      truncatedPaths,
      unchangedPaths,
    ]
  );
  useEffect(() => {
    const key = pendingTargetKey.current ?? landOnRef.current;
    if (!key) return;
    const index = rows.findIndex((row) => row.key === key);
    landOnRef.current = null;
    if (index < 0) return;
    pendingTargetKey.current = null;
    listRef.current?.scrollToIndex({ index, animated: false });
  }, [rows]);

  const totals = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    for (const change of listing.changes) {
      additions += change.added ?? 0;
      deletions += change.removed ?? 0;
    }
    return { additions, deletions };
  }, [listing.changes]);
  const fileCount = listing.changes.length;

  /**
   * What to say when there is nothing to show. A folder that is gone and a
   * folder that is not a repository are not "nothing uncommitted": they are
   * unanswerable, and saying otherwise is this app inventing a fact about the
   * host. Neither is an error toast -- nothing failed, and there is nothing
   * for the reader to retry.
   */
  const empty = diffEmptyState({
    loading,
    fileCount,
    reason:
      listing.reason === 'not_a_repository' || listing.reason === 'workspace_missing'
        ? listing.reason
        : undefined,
  });
  const paneGone = listing.reason === 'unknown_pane';
  // The caption is the answer to "is it dirty": the counts when it is, and
  // the reason when it is not. It keeps what the last listing said while the
  // next one loads, so a reload never swaps the line for a blank or a third
  // wording; only the very first load has nothing to keep and says so.
  const summary =
    fileCount > 0
      ? t`${plural(listing.changes.length, { one: '# file', other: '# files' })} · +${totals.additions} −${totals.deletions}`
      : listing.reason === 'not_a_repository'
        ? t`Not a git repository`
        : listing.reason === 'workspace_missing'
          ? t`Project folder is missing`
          : paneGone
            ? t`This terminal pane is gone.`
            : scope === 'branch' && base
              ? t`Same as ${base}`
              : t`Nothing uncommitted`;
  const [lastCaption, setLastCaption] = useState<string | null>(null);
  useEffect(() => {
    if (!loading) setLastCaption(summary);
  }, [loading, summary]);
  const caption = loading ? (lastCaption ?? t`Loading changes…`) : summary;

  const emptyTitle =
    empty === 'clean' && paneGone
      ? t`This terminal pane is gone.`
      : empty === 'workspace-missing'
        ? t`Project folder is missing`
        : empty === 'not-a-repository'
          ? t`Not a git repository`
          : scope === 'branch' && base
            ? t`No changes compared with ${base}.`
            : t`Nothing uncommitted in this project.`;
  const emptyCaption =
    empty === 'workspace-missing'
      ? (listing.missing?.directory ?? null)
      : empty === 'clean' && !paneGone && !(scope === 'branch' && base)
        ? t`The working tree matches the last commit.`
        : null;

  const workingLabel = t`Uncommitted changes`;
  const branchLabel = base ? t`Compared with ${base}` : '';

  const discardName = discardTarget?.path.split('/').pop() ?? '';
  const discardUntracked = discardTarget?.status === 'untracked';

  // The body is one state at a time -- rows, loading, an error, or an empty
  // sheet -- and each one fades in where the last one was.
  const bodyKey = rows.length > 0 ? 'rows' : error ? 'error' : empty;

  return (
    <SheetScene
      testID={testID}
      title={title ?? t`Changes`}
      // The caption line is always there, so the list under it never jumps.
      caption={caption}
      detail={
        worktree || repo ? (
          <View style={{ gap: 4 }}>
            {worktree ? <ChangesWorktreeLine worktree={worktree} /> : null}
            {repo ? <ChangesRepoLine repo={repo} /> : null}
          </View>
        ) : undefined
      }
      headingTrailing={
        <View style={styles.trailing}>
          {lazygit ? (
            <SheetSceneQuietControl
              testID="changes-lazygit"
              accessibilityLabel={t`Open in Lazygit`}
              busy={lazygit.busy}
              onPress={lazygit.open}>
              <TerminalIcon size={17} color={theme.colors.textMuted} />
            </SheetSceneQuietControl>
          ) : null}
          <SheetSceneQuietControl
            testID="changes-refresh"
            accessibilityLabel={t`Refresh changes`}
            busy={loading}
            onPress={refresh}>
            <RefreshIcon size={17} color={theme.colors.textMuted} />
          </SheetSceneQuietControl>
        </View>
      }
      header={
        <>
          {base ? (
            // The comparison is a choice between two named things, so it is
            // drawn as one: a segmented control, not a menu hanging off the
            // heading. Only when there is a base to compare with.
            <Animated.View entering={fadeIn('short')}>
              <SettingsSegmented
                testID="agent-changes-scope"
                options={[
                  { label: workingLabel, value: 'working' },
                  { label: branchLabel, value: 'branch' },
                ]}
                value={scope}
                onChange={(next) => changeScope(next === 'branch' ? 'branch' : 'working')}
              />
            </Animated.View>
          ) : null}
          {switcher}
          {error && fileCount > 0 ? (
            // The old rows are still good; what failed is asking again.
            <SheetSceneNotice
              testID="changes-refresh-notice"
              message={error}
              actionLabel={t`Try again`}
              onAction={retry}
              busy={loading}
            />
          ) : null}
          {listing.truncated ? (
            <Text variant="caption" color={theme.colors.warning}>
              <Trans>Too many changes to list. This is the start of them, not all of them.</Trans>
            </Text>
          ) : null}
          {/* In the pinned block, not beside the list: the scene's frame lays
              out exactly two subviews around its scroller. */}
          {discardTarget ? (
            <Dialog
              visible
              testID="agent-changes-discard-dialog"
              onClose={cancelDiscard}
              tone="danger"
              title={
                discardUntracked ? t`Delete ${discardName}?` : t`Discard changes to ${discardName}?`
              }
              message={t`This cannot be undone.`}
              actionLayout="row"
              actions={[
                { id: 'cancel', label: t`Cancel`, onPress: cancelDiscard },
                {
                  id: 'discard',
                  label: discardUntracked ? t`Delete` : t`Discard`,
                  tone: 'destructive',
                  onPress: confirmDiscard,
                },
              ]}
            />
          ) : null}
        </>
      }>
      {/*
        Edge to edge: the tree indents itself, and a file's patch is the one
        thing on this sheet that needs every point of a phone's width. The
        scroll view stays one whatever is on screen -- the empty, loading and
        error states are drawn inside `DiffRowList` -- or the native form sheet
        finds no scroll view and sizes itself to its contents.
      */}
      <Animated.View key={bodyKey} entering={fadeIn('short')} style={styles.body}>
        <DiffRowList
          rows={rows}
          colors={colors}
          // The gutter stays opaque, not through the artwork-opacity slider:
          // it is pinned over code panning sideways under it, and a
          // see-through column shows that code behind the line numbers.
          // Opacity audit: legibility -- the gutter sits over moving code and
          // must hide it whatever the slider says.
          gutterFill={theme.colors.surface}
          headerFill={surfaceBackground(theme.colors.surface)}
          surfaceFill="transparent"
          // One list of changes against `HEAD`; the groups say where a change sits.
          showSide={false}
          onToggleFile={toggleFile}
          onShowMore={showMore}
          listRef={listRef}
          tree={treeHandlers}
          fallback={
            empty === 'loading' ? (
              <ActivityIndicator size="small" color={theme.colors.textMuted} />
            ) : error ? (
              <>
                <Text
                  testID="changes-error"
                  variant="bodySmall"
                  color={theme.colors.textMuted}
                  style={styles.emptyText}>
                  {error}
                </Text>
                <View style={styles.emptyActions}>
                  <EmptyAction testID="changes-retry" label={t`Try again`} onPress={retry} />
                </View>
              </>
            ) : (
              <>
                <Text
                  testID="agent-vcs-diff-empty"
                  variant="bodySmall"
                  color={theme.colors.text}
                  style={styles.emptyText}>
                  {emptyTitle}
                </Text>
                {emptyCaption ? (
                  <Text
                    variant="caption"
                    color={theme.colors.textMuted}
                    numberOfLines={2}
                    style={styles.emptyText}>
                    {emptyCaption}
                  </Text>
                ) : null}
                {paneGone ? null : (
                  <View style={styles.emptyActions}>
                    <EmptyAction
                      testID="changes-empty-refresh"
                      label={t`Refresh`}
                      onPress={refresh}
                    />
                    {lazygit && empty === 'clean' ? (
                      <EmptyAction
                        testID="changes-empty-lazygit"
                        label={t`Open in Lazygit`}
                        busy={lazygit.busy}
                        onPress={lazygit.open}
                      />
                    ) : null}
                  </View>
                )}
              </>
            )
          }
        />
      </Animated.View>
    </SheetScene>
  );
});

const styles = StyleSheet.create({
  body: { flex: 1, minHeight: 0 },
  emptyText: { textAlign: 'center', paddingHorizontal: SHEET_LADDER.gutter },
  emptyActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: SHEET_LADDER.gap,
    marginTop: SHEET_LADDER.tight,
  },
  emptyAction: {
    minHeight: 36,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderCurve: 'continuous',
  },
  trailing: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  repoLine: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
  repoName: { flexShrink: 1, minWidth: 0 },
  repoUpstream: { flexShrink: 2, minWidth: 0 },
  repoFixed: { flexShrink: 0 },
});
