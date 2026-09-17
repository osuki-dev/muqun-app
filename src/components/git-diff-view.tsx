import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { type LegendListRef } from '@legendapp/list/react-native';
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { RefreshCw } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';

import { appChrome } from '@/constants/appearance';
import { PressableScale } from '@/components/pressable-scale';
import { SettingsSegmented } from '@/components/settings-segmented';
import { SHEET_LADDER, SheetScene, SheetSceneQuietControl } from '@/components/sheet-scene';
import { DiffRowList } from '@/components/diff-rows';
import { usePaneChatColors } from '@/components/pane-chat-blocks';
import {
  DIFF_CONTEXT_LINES,
  FILE_PATCH_MAX_LINES,
  applyPatchPage,
  closeFile,
  emptyFilePatchState,
  filterFilesBySide,
  flattenDiffRows,
  loadGitFileDiff,
  loadGitStatus,
  openFile,
  shouldAutoExpand,
  stagedParamForSide,
  type GitDiffSide,
  type GitFileChange,
  type GitFilePatchState,
  type GitStatus,
} from '@/lib/gateway-client';
import { describeGatewayFailure } from '@/lib/network-error';

/**
 * What this pane has changed, as rows.
 *
 * The sheet is one flat, recycled list of four kinds of row -- a file, a hunk
 * header, a line, and "show more" -- with the file list on top and a file's
 * patch inserted under it when the reader opens it. Nothing prefetches, nothing
 * polls, and there is no request in the API that could ask for a whole
 * repository's diff, so the worst case here is one large file rather than one
 * large checkout.
 *
 * Three things about it are deliberate and easy to undo by accident:
 *
 * **`recycleItems` is on, and both other lists in this app turn it off.** Their
 * performance story is stable row objects plus `React.memo`, which recycling
 * would undo. A diff row is the opposite case: a fixed-height strip of
 * monospace text with two numbers and a background colour, thousands of them,
 * nothing expensive surviving a recycle. Recycling is what bounds the view pool
 * here, and `getFixedItemSize` means the list never measures a row at all.
 *
 * **One horizontal scroller wraps the whole list, not one per row.** A
 * `ScrollView` per row is a native scroll view with its own gesture recogniser
 * each, created and destroyed by the hundred under recycling, and on Android
 * nested scrollables steal the vertical pan often enough to be felt. One outer
 * scroller is also the *correct* behaviour: columns stay aligned across rows
 * while panning, which per-row scrollers cannot do.
 *
 * **The gutter and every header stay put while the code pans.** They are
 * counter-translated by the scroller's own offset on the UI thread, so the line
 * numbers, the file being read and the hunk header stay readable at any
 * horizontal position. A diff whose file name has panned off the screen is one
 * you cannot tell apart from the next file's.
 *
 * Wrapping is out, for the reason `DiffRow` gives in the transcript: a
 * re-wrapped diff line no longer lines up with the one above it, which is the
 * only thing a diff is read for. The colours are that component's colours,
 * taken from the same hook, so an inline diff in the transcript and this sheet
 * are visibly the same thing.
 *
 * The frame around all of that is `SheetScene`, like every other sheet in the
 * app. This one used to be exempt from the shared heading, because its pinned
 * bar carries three things at once -- the branch, the refresh, and the
 * staged/unstaged segments -- and the exemption read as "an inspector is not a
 * picker". It is: the branch is the caption (the current value, which is what a
 * caption is for), the refresh is the one quiet control on the title's line, and
 * the segments are the scene's own pinned header, in sentence case. Nothing was
 * dropped to fit; there is simply no second way of drawing a sheet left.
 */
export function GitDiffView({
  sessionId,
  paneId,
  label,
  branch,
}: {
  sessionId: string;
  paneId: string;
  /** The server's name, for the subtitle. */
  label: string;
  /** The branch the entry point already knew, so the sheet opens named. */
  branch: string;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const colors = usePaneChatColors();
  const surfaceBackground = useSurfaceBackground();

  const [status, setStatus] = useState<GitStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /**
   * A refresh that found something different, held back until it is asked for.
   *
   * New output must not move the reader's viewport or replace the snapshot
   * until they choose to refresh it. So a refresh that disagrees with what is
   * on screen becomes a pill saying how many files there are now, and nothing
   * under it moves until the pill is tapped.
   */
  const [pending, setPending] = useState<GitStatus | null>(null);
  const [side, setSide] = useState<GitDiffSide>('all');

  /** Which files are open, oldest first: see `openFile` for the eviction rule. */
  const [expandedOrder, setExpandedOrder] = useState<string[]>([]);
  const [pages, setPages] = useState<ReadonlyMap<string, GitFilePatchState>>(() => new Map());

  const statusRequest = useRef<AbortController | null>(null);
  const listRef = useRef<LegendListRef>(null);
  /**
   * The file header to land on once the rows change, keyed like the row.
   *
   * Collapsing a file the reader is four thousand lines into removes every
   * row under the viewport; nothing above it moved, so the offset stays where
   * it was, which is now past the end of the content and shows a blank sheet
   * that will not scroll back. Landing on the header the reader just tapped is
   * the one place that is both still there and what they asked to see.
   */
  const landOnRef = useRef<string | null>(null);
  const patchRequests = useRef(new Map<string, AbortController>());

  useEffect(
    () => () => {
      statusRequest.current?.abort();
      for (const controller of patchRequests.current.values()) controller.abort();
      patchRequests.current.clear();
    },
    []
  );

  const dropPatches = useCallback((paths: readonly string[]) => {
    if (paths.length === 0) return;
    for (const path of paths) {
      patchRequests.current.get(path)?.abort();
      patchRequests.current.delete(path);
    }
    setPages((previous) => {
      const next = new Map(previous);
      for (const path of paths) next.delete(path);
      return next;
    });
  }, []);

  const applyStatus = useCallback((next: GitStatus) => {
    setStatus(next);
    setPending(null);
    setError(null);
    // Every patch in hand is now of unknown age, so it is dropped and
    // refetched rather than left under a file list that has moved on. Which
    // files were open survives: that is the reader's choice, not the
    // gateway's -- minus any that no longer exist.
    for (const controller of patchRequests.current.values()) controller.abort();
    patchRequests.current.clear();
    setPages(new Map());
    const only = shouldAutoExpand(next.files);
    setExpandedOrder((order) =>
      only ? [only] : order.filter((path) => next.files.some((file) => file.path === path))
    );
  }, []);

  const load = useCallback(
    (mode: 'initial' | 'refresh') => {
      statusRequest.current?.abort();
      const controller = new AbortController();
      statusRequest.current = controller;
      setLoading(true);
      void loadGitStatus(sessionId, paneId, controller.signal)
        .then((next) => {
          if (controller.signal.aborted) return;
          setLoading(false);
          if (mode === 'initial' || !status) {
            applyStatus(next);
            return;
          }
          setError(null);
          // The refresh path: offered, never applied. A refresh that found the
          // same change set has nothing to offer, and a pill that changes
          // nothing when tapped is worse than no pill.
          setPending(sameChangeSet(status, next) ? null : next);
        })
        .catch((failure) => {
          if (controller.signal.aborted) return;
          setLoading(false);
          setError(describeGatewayFailure(failure, t`Could not read the changes.`).message);
        });
    },
    [applyStatus, paneId, sessionId, status, t]
  );

  /**
   * One listing, when the sheet opens.
   *
   * Guarded by a ref rather than by an empty dependency list, because `load`
   * changes identity whenever the status in hand does and this must not become
   * a request per answer.
   */
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    load('initial');
  }, [load]);

  const fetchPage = useCallback(
    (path: string, from: number) => {
      const file = status?.files.find((entry) => entry.path === path) ?? null;
      patchRequests.current.get(path)?.abort();
      const controller = new AbortController();
      patchRequests.current.set(path, controller);

      setPages((previous) => {
        const next = new Map(previous);
        next.set(path, {
          ...(previous.get(path) ?? emptyFilePatchState()),
          loading: true,
          error: null,
        });
        return next;
      });

      void loadGitFileDiff(
        sessionId,
        paneId,
        path,
        {
          from,
          lines: FILE_PATCH_MAX_LINES,
          context: DIFF_CONTEXT_LINES,
          staged: stagedParamForSide(side),
          // Both ends of a rename, or git renders the move as a brand-new file
          // and the reader is shown a thousand added lines for a move.
          oldPath: file?.oldPath ?? null,
        },
        controller.signal
      )
        .then((page) => {
          if (controller.signal.aborted) return;
          patchRequests.current.delete(path);
          setPages((previous) => {
            const next = new Map(previous);
            // The raw patch is parsed here and dropped here: only rows survive.
            next.set(path, applyPatchPage(from > 0 ? previous.get(path) : undefined, page));
            return next;
          });
        })
        .catch((failure) => {
          if (controller.signal.aborted) return;
          patchRequests.current.delete(path);
          const message = describeGatewayFailure(failure, t`Could not read this file.`).message;
          setPages((previous) => {
            const next = new Map(previous);
            const current = previous.get(path) ?? emptyFilePatchState();
            next.set(path, { ...current, loading: false, error: message });
            return next;
          });
        });
    },
    [paneId, sessionId, side, status, t]
  );

  /**
   * A file that is open and has no page yet gets one.
   *
   * Expressed as an effect rather than at the two call sites that open a file,
   * so that expanding by tap and the single-file auto-expand take the same
   * path. `fetchPage` writes a loading entry synchronously, which is what stops
   * this from asking twice.
   */
  useEffect(() => {
    for (const path of expandedOrder) {
      if (!pages.has(path)) fetchPage(path, 0);
    }
  }, [expandedOrder, fetchPage, pages]);

  const toggleFile = useCallback(
    (path: string) => {
      if (expandedOrder.includes(path)) {
        // A collapsed file drops its rows. `MAX_OPEN_FILES` bounds what is
        // held open; a collapsed file that kept its patch would sit outside
        // that bound and never be released.
        landOnRef.current = `f:${path}`;
        setExpandedOrder(closeFile(expandedOrder, path));
        dropPatches([path]);
        return;
      }
      const next = openFile(expandedOrder, path);
      setExpandedOrder(next);
      // Past the cap, the least recently expanded file goes with it.
      const nextSet = new Set(next);
      dropPatches(expandedOrder.filter((entry) => !nextSet.has(entry)));
    },
    [dropPatches, expandedOrder]
  );

  const showMore = useCallback(
    (path: string) => {
      const state = pages.get(path);
      if (!state || state.loading) return;
      fetchPage(path, state.loadedLines);
    },
    [fetchPage, pages]
  );

  const files: readonly GitFileChange[] = useMemo(
    () => filterFilesBySide(status?.files ?? EMPTY_FILES, side),
    [side, status]
  );

  /**
   * Switching sides drops every open patch: a file's staged half and its
   * unstaged half are different text, and a page of one under the header of
   * the other is exactly the kind of lie a diff must never tell. The list
   * starts collapsed again, which is also the honest reading position.
   */
  const changeSide = useCallback(
    (next: string) => {
      if (next !== 'all' && next !== 'staged' && next !== 'unstaged') return;
      if (next === side) return;
      for (const controller of patchRequests.current.values()) controller.abort();
      patchRequests.current.clear();
      setPages(new Map());
      setExpandedOrder([]);
      setSide(next);
    },
    [side]
  );
  const expanded = useMemo(() => new Set(expandedOrder), [expandedOrder]);
  const rows = useMemo(() => flattenDiffRows(files, expanded, pages), [expanded, files, pages]);
  useEffect(() => {
    const key = landOnRef.current;
    if (!key) return;
    landOnRef.current = null;
    const index = rows.findIndex((row) => row.key === key);
    if (index >= 0) listRef.current?.scrollToIndex({ index, animated: false });
  }, [rows]);

  // The measured geometry, the horizontal panning, the pinned gutter and the
  // sticky file headers all live in `diff-rows.tsx` now, because the agent's
  // diff sheet draws exactly the same body from a different source.
  const gutterFill = theme.colors.surface;
  const headerFill = theme.colors.surfaceRaised;

  const notARepository = Boolean(status && status.repo === null);
  const subtitle = [branch || status?.repo?.branch || '', label].filter(Boolean).join(' · ');

  // The two subviews a native form sheet lays out around a scroll view are the
  // ground and the column below; the heading, the segments and the patch are
  // inside that column, which is what `SheetScene` builds. The list stays the
  // one scroll view among the column's children -- react-native-screens finds
  // it by class and gives it the sheet's height less the pinned block's.
  return (
    <SheetScene
      testID="git-diff-view"
      title={t`Changes`}
      // The branch, and the server it is on. A caption is the current value, and
      // the value a reader checks before reading a diff is which branch it is.
      caption={subtitle}
      headingTrailing={
        <SheetSceneQuietControl
          testID="git-diff-refresh"
          accessibilityLabel={t`Refresh changes`}
          busy={loading}
          onPress={() => load('refresh')}>
          <RefreshCw size={17} color={theme.colors.textMuted} />
        </SheetSceneQuietControl>
      }
      header={
        <>
          {(status?.files.length ?? 0) > 0 ? (
            <SettingsSegmented
              options={[
                { value: 'all', label: t`All` },
                { value: 'staged', label: t`Staged` },
                { value: 'unstaged', label: t`Unstaged` },
              ]}
              value={side}
              onChange={changeSide}
              testID="git-diff-side"
            />
          ) : null}

          {pending ? (
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={t`Show the newer list of changes`}
              onPress={() => applyStatus(pending)}
              style={[
                styles.pill,
                { backgroundColor: surfaceBackground(theme.colors.primarySubtle) },
              ]}>
              <Text variant="caption" color={theme.colors.primary}>
                <Plural value={pending.files.length} one="# file changed" other="# files changed" />
              </Text>
              <RefreshCw size={13} color={theme.colors.primary} />
            </PressableScale>
          ) : null}

          {status?.truncated ? (
            <Text variant="caption" color={theme.colors.warning}>
              <Trans>Too many changes to list. This is the start of them, not all of them.</Trans>
            </Text>
          ) : null}
        </>
      }>
      {/*
        The scroll view is the sheet's second subview and stays one whatever is
        on screen: swap it for a plain `View` while loading and there is no
        scroll view to find, and the sheet sizes itself to its contents instead
        -- which is why the empty, loading and error states are drawn *inside*
        `DiffRowList`.
      */}
      <DiffRowList
        rows={rows}
        colors={colors}
        gutterFill={gutterFill}
        headerFill={headerFill}
        surfaceFill={surfaceBackground(theme.colors.surface)}
        showSide={side === 'all'}
        onToggleFile={toggleFile}
        onShowMore={showMore}
        listRef={listRef}
        fallback={
          loading ? (
            <ActivityIndicator size="small" color={theme.colors.textMuted} />
          ) : error ? (
            <>
              <Text variant="bodySmall" color={theme.colors.textMuted} style={styles.stateText}>
                {error}
              </Text>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={t`Try again`}
                onPress={() => load('initial')}
                style={[
                  styles.retry,
                  { backgroundColor: surfaceBackground(theme.colors.surfaceRaised) },
                ]}>
                <Text variant="caption" color={theme.colors.primary}>
                  <Trans>Try again</Trans>
                </Text>
              </PressableScale>
            </>
          ) : notARepository ? (
            <Text variant="bodySmall" color={theme.colors.textMuted} style={styles.stateText}>
              <Trans>
                This pane is not working inside a git repository, so there is nothing to compare.
              </Trans>
            </Text>
          ) : (
            <Text variant="bodySmall" color={theme.colors.textMuted} style={styles.stateText}>
              <Trans>No changes. The working tree matches HEAD.</Trans>
            </Text>
          )
        }
      />
    </SheetScene>
  );
}

const EMPTY_FILES: readonly GitFileChange[] = [];

/**
 * Whether two listings say the same thing.
 *
 * Paths, kinds and counts, in order. Used only to decide whether a refresh has
 * anything to offer; the answer is never shown.
 */
function sameChangeSet(previous: GitStatus, next: GitStatus): boolean {
  if (previous.files.length !== next.files.length) return false;
  if (previous.truncated !== next.truncated) return false;
  for (let index = 0; index < previous.files.length; index += 1) {
    const before = previous.files[index];
    const after = next.files[index];
    if (
      before.path !== after.path ||
      before.status !== after.status ||
      before.added !== after.added ||
      before.removed !== after.removed
    ) {
      return false;
    }
  }
  return true;
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: SHEET_LADDER.gap,
    minHeight: 30,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderCurve: 'continuous',
  },
  stateText: {
    textAlign: 'center',
  },
  retry: {
    minHeight: 32,
    paddingHorizontal: 14,
    borderRadius: appChrome.radius.control,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
