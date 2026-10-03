import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { type LegendListRef } from '@legendapp/list/react-native';
import { Dialog, useThemeTokens, useToast } from '@osuki-dev/ui';
import { Text } from '@/components/text';
import { plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { Check, ChevronDown, ChevronUp } from 'lucide-react-native';

import { AgentActionMenu } from '@/components/agent-action-menu';
import type { ChangeTreeHandlers } from '@/components/change-tree-rows';
import { DiffRowList } from '@/components/diff-rows';
import { usePaneChatColors } from '@/components/pane-chat-blocks';
import { PressableScale } from '@/components/pressable-scale';
import { SheetScene, SHEET_LADDER } from '@/components/sheet-scene';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import {
  fileChangeFromDiffItem,
  fileChangeFromSummary,
  patchStateFromText,
} from '@/lib/agent-diff-rows';
import {
  buildChangeTree,
  changeTreeRows,
  defaultCollapsedDirs,
  nextDiffContext,
} from '@/lib/change-tree';
import {
  closeFile,
  DIFF_CONTEXT_LINES,
  emptyFilePatchState,
  openFile,
  type GitFileChange,
  type GitFilePatchState,
} from '@/lib/gateway-client';
import { agentRequestErrorDetail, isAgentOfflineError } from '@/lib/agent-request-error';
import { diffEmptyState } from '@/lib/agent-workspace-missing';
import {
  discardAgentVcsFile,
  getAgentVcsDiff,
  getAgentVcsFile,
  getAgentVcsFiles,
  type AgentVcsDiff,
  type AgentVcsFiles,
  type VcsFilesMode,
  type WorkspaceMissing,
} from '@/lib/agent-session';

/**
 * What the agent changed on disk, as a native form sheet route.
 *
 * The files are a directory tree across the sheet's full width: a directory
 * row per folder (a chain of single-folder folders is one row), a file row
 * that says its own name, its status and its counts, and a file's patch drawn
 * under it by the shared diff list when the reader opens it -- the same rows,
 * gutter and horizontal pan as the terminal's changes sheet.
 *
 * Two ways to get there, chosen by the gateway's `agent_vcs_files`:
 *
 * - With it, `…/vcs/files` lists the files without a single patch, and a
 *   file's patch is fetched when the file is opened (`…/vcs/file`, three lines
 *   of context, more on request) and kept per scope and path. The reader can
 *   also discard one file's uncommitted changes.
 * - Without it -- or when that route gives no usable answer -- `…/vcs/diff`
 *   answers every patch at once, as it always has, drawn as the same tree.
 *
 * The scope is uncommitted changes, and "compared with {base}" when the
 * gateway names a base to compare with.
 */
export interface AgentVcsDiffSheetProps {
  sessionId: string;
  asid: string;
  targetPath?: string;
  /** The gateway advertised `agent_vcs_files`. */
  filesApi: boolean;
  onClose: () => void;
}

/** The file list, from whichever route answered. */
interface ChangeListing {
  changes: GitFileChange[];
  /** Patches already in hand, from `…/vcs/diff`; empty when they are fetched per file. */
  patches: ReadonlyMap<string, string>;
  /** The list came from `…/vcs/files`: patches are fetched per file. */
  lazy: boolean;
  truncated: boolean;
  reason?: AgentVcsDiff['reason'] | AgentVcsFiles['reason'];
  missing?: WorkspaceMissing;
}

/** One file's fetched patch, per scope and path. */
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
  patches: new Map(),
  lazy: false,
  truncated: false,
};

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

async function loadListing(
  sessionId: string,
  asid: string,
  scope: VcsFilesMode,
  filesApi: boolean
): Promise<{ listing: ChangeListing; base?: string }> {
  if (filesApi) {
    const answer = await getAgentVcsFiles(sessionId, asid, scope);
    if (answer) {
      return {
        listing: {
          changes: answer.files.map(fileChangeFromSummary),
          patches: new Map(),
          lazy: true,
          truncated: answer.truncated,
          reason: answer.reason,
          missing: answer.missing,
        },
        base: answer.base,
      };
    }
  }
  const legacy = await getAgentVcsDiff(sessionId, asid, scope);
  return {
    listing: {
      changes: legacy.files.map(fileChangeFromDiffItem),
      patches: new Map(legacy.files.map((file) => [file.path, file.patch])),
      lazy: false,
      truncated: false,
      reason: legacy.reason,
      missing: legacy.missing,
    },
  };
}

export const AgentVcsDiffSheet = memo(function AgentVcsDiffSheet({
  sessionId,
  asid,
  targetPath,
  filesApi,
  onClose: _onClose,
}: AgentVcsDiffSheetProps) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const colors = usePaneChatColors();
  const surfaceBackground = useSurfaceBackground();

  const [loading, setLoading] = useState(false);
  const [listing, setListing] = useState<ChangeListing>(EMPTY_LISTING);
  const [scope, setScope] = useState<VcsFilesMode>('working');
  /** The ref "compared with" names; kept across scopes once the gateway has said it. */
  const [base, setBase] = useState<string | undefined>(undefined);
  const [scopeMenuOpen, setScopeMenuOpen] = useState(false);
  /** Which files are open, oldest first: the same eviction rule as the terminal's sheet. */
  const [expandedOrder, setExpandedOrder] = useState<readonly string[]>([]);
  const [collapsedDirs, setCollapsedDirs] = useState<ReadonlySet<string>>(() => new Set());
  const [patches, setPatches] = useState<Readonly<Record<string, PatchEntry>>>({});
  const [menuPath, setMenuPath] = useState<string | null>(null);
  const [discardTarget, setDiscardTarget] = useState<GitFileChange | null>(null);
  const listRef = useRef<LegendListRef | null>(null);
  const pendingTargetPath = useRef(targetPath);
  const pendingTargetKey = useRef<string | null>(null);

  const patchLoadFailed = t`Could not load this file's changes.`;
  /** One file's patch at `context`, keeping what is on screen until the answer lands. */
  const fetchPatch = useCallback(
    (forScope: VcsFilesMode, path: string, context: number) => {
      const key = patchKey(forScope, path);
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
      getAgentVcsFile(sessionId, asid, { mode: forScope, path, context })
        .then((answer) => {
          setPatches((prev) => ({
            ...prev,
            [key]: {
              context,
              loading: false,
              patch: answer.patch,
              truncated: answer.truncated,
              unchanged: answer.status === 'unchanged',
              error: null,
            },
          }));
        })
        .catch(() => {
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
    [asid, patchLoadFailed, sessionId]
  );

  // Fetched once per opening and once per scope: a route mounts when it opens.
  useEffect(() => {
    if (!asid) return;
    let active = true;
    setLoading(true);
    loadListing(sessionId, asid, scope, filesApi)
      .then(({ listing: next, base: nextBase }) => {
        if (!active) return;
        if (next.reason === 'no_default_branch') {
          // Nothing to compare with after all: the option goes, and the sheet
          // goes back to what it can show.
          setBase(undefined);
          setScope('working');
          return;
        }
        setListing(next);
        if (nextBase) setBase(nextBase);
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
        if (openedPath && next.lazy) {
          const change = next.changes.find((file) => file.path === openedPath);
          if (change && !change.binary) fetchPatch(scope, openedPath, DIFF_CONTEXT_LINES);
        }
        if (matchedPath) {
          pendingTargetPath.current = undefined;
          pendingTargetKey.current = `f:${matchedPath}`;
        }
      })
      .catch((err) => {
        console.warn('Failed to load VCS changes:', err);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [sessionId, asid, scope, filesApi, fetchPatch]);

  const changeScope = useCallback(
    (next: VcsFilesMode) => {
      setScopeMenuOpen(false);
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

  const toggleFile = useCallback(
    (path: string) => {
      setMenuPath(null);
      const opening = !expandedOrder.includes(path);
      setExpandedOrder((order) =>
        order.includes(path) ? closeFile(order, path) : openFile(order, path)
      );
      if (!opening || !listing.lazy || changesByPath.get(path)?.binary) return;
      const entry = patches[patchKey(scope, path)];
      if (!entry || (entry.error && entry.patch === null)) {
        fetchPatch(scope, path, DIFF_CONTEXT_LINES);
      }
    },
    [changesByPath, expandedOrder, fetchPatch, listing.lazy, patches, scope]
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

  // Discarding is offered for uncommitted changes only, and only by a gateway
  // that lists files itself: a comparison with the base is history, and
  // `…/vcs/diff` has no discard to go with it.
  // A cut listing is refused (`409 listing_truncated`): the gateway cannot
  // vouch for a path it did not list in full, so the action is not offered.
  const canDiscard = listing.lazy && scope === 'working' && !listing.truncated;
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
  const gatewayUnreachable = t`The gateway could not be reached.`;
  const discardFallback = t`Nothing was changed.`;
  const confirmDiscard = () => {
    const target = discardTarget;
    setDiscardTarget(null);
    if (!target) return;
    discardAgentVcsFile(sessionId, asid, target.path)
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

  const noShowMore = useCallback(() => {}, []);

  const expanded = useMemo(() => new Set(expandedOrder), [expandedOrder]);
  const tree = useMemo(() => buildChangeTree(listing.changes), [listing.changes]);
  const { pages, contextOffers, truncatedPaths, unchangedPaths } = useMemo(() => {
    const pageMap = new Map<string, GitFilePatchState>();
    const offers = new Map<string, boolean>();
    const cut = new Set<string>();
    const same = new Set<string>();
    for (const path of expandedOrder) {
      const change = changesByPath.get(path);
      if (!change) continue;
      if (!listing.lazy) {
        pageMap.set(path, patchStateFromText(listing.patches.get(path) ?? ''));
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
  }, [changesByPath, expandedOrder, listing.lazy, listing.patches, patches, scope]);

  const rows = useMemo(
    () =>
      changeTreeRows({
        tree,
        collapsed: collapsedDirs,
        expanded,
        pages,
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
      pages,
      tree,
      truncatedPaths,
      unchangedPaths,
    ]
  );
  useEffect(() => {
    const key = pendingTargetKey.current;
    if (!key) return;
    const index = rows.findIndex((row) => row.key === key);
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
    reason: listing.reason === 'no_default_branch' ? undefined : listing.reason,
  });
  // The caption keeps what the last scope said while the next one loads, so a
  // reload never swaps the line for a blank or a third wording.
  const summary =
    fileCount > 0
      ? t`${plural(listing.changes.length, { one: '# file', other: '# files' })} · +${totals.additions} −${totals.deletions}`
      : t`No changes`;
  const [lastCaption, setLastCaption] = useState<string | null>(null);
  useEffect(() => {
    if (!loading) setLastCaption(summary);
  }, [loading, summary]);
  const emptyText =
    empty === 'workspace-missing'
      ? t`Project folder is missing: ${listing.missing?.directory ?? ''}`
      : empty === 'not-a-repository'
        ? t`Not a git repository`
        : scope === 'branch' && base
          ? t`No changes compared with ${base}.`
          : t`Nothing uncommitted in this project.`;

  const workingLabel = t`Uncommitted changes`;
  const branchLabel = base ? t`Compared with ${base}` : '';
  const scopeLabel = scope === 'branch' && base ? branchLabel : workingLabel;
  const ScopeChevron = scopeMenuOpen ? ChevronUp : ChevronDown;

  const discardName = discardTarget?.path.split('/').pop() ?? '';
  const discardUntracked = discardTarget?.status === 'untracked';

  return (
    <SheetScene
      testID="agent-vcs-diff-sheet"
      title={t`Changes`}
      // The caption line is always there, so the list under it never jumps.
      caption={loading && lastCaption ? lastCaption : summary}
      headingTrailing={
        <PressableScale
          testID="agent-changes-scope"
          accessibilityRole="button"
          accessibilityLabel={t`Choose which changes to show`}
          accessibilityState={{ expanded: scopeMenuOpen, disabled: !base }}
          disabled={!base}
          onPress={() => setScopeMenuOpen((open) => !open)}
          style={styles.scope}>
          <Text variant="caption" color={theme.colors.textMuted} numberOfLines={1}>
            {scopeLabel}
          </Text>
          {base ? <ScopeChevron size={14} color={theme.colors.textMuted} /> : null}
        </PressableScale>
      }
      header={
        <>
          {scopeMenuOpen && base ? (
            <AgentActionMenu
              testID="agent-changes-scope-menu"
              surface="ground"
              items={[
                {
                  id: 'working',
                  label: workingLabel,
                  Icon: scope === 'working' ? Check : undefined,
                  onPress: () => changeScope('working'),
                  testID: 'agent-changes-scope-working',
                },
                {
                  id: 'branch',
                  label: branchLabel,
                  Icon: scope === 'branch' ? Check : undefined,
                  onPress: () => changeScope('branch'),
                  testID: 'agent-changes-scope-branch',
                },
              ]}
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
        thing on this sheet that needs every point of a phone's width.
      */}
      <View style={styles.body}>
        <DiffRowList
          rows={rows}
          colors={colors}
          gutterFill={surfaceBackground(theme.colors.surface)}
          headerFill={surfaceBackground(theme.colors.surface)}
          surfaceFill="transparent"
          // There is no index to attribute an agent's edits to, so there is no
          // staged/unstaged mark to show either.
          showSide={false}
          onToggleFile={toggleFile}
          onShowMore={noShowMore}
          listRef={listRef}
          tree={treeHandlers}
          fallback={
            empty === 'loading' ? (
              <ActivityIndicator size="small" color={theme.colors.textMuted} />
            ) : (
              <Text
                testID="agent-vcs-diff-empty"
                variant="bodySmall"
                color={theme.colors.textMuted}
                style={styles.emptyText}>
                {emptyText}
              </Text>
            )
          }
        />
      </View>
    </SheetScene>
  );
});

const styles = StyleSheet.create({
  body: { flex: 1, minHeight: 0 },
  emptyText: { textAlign: 'center', paddingHorizontal: SHEET_LADDER.gutter },
  scope: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    maxWidth: 200,
    minHeight: 32,
    paddingLeft: 8,
  },
});
