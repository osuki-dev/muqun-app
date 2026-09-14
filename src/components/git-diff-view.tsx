import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { type LegendListRef, type LegendListRenderItemProps } from '@legendapp/list/react-native';
import { AnimatedLegendList } from '@legendapp/list/reanimated';
import { useLingui as useLinguiRuntime } from '@lingui/react';
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { ChevronDown, ChevronRight, RefreshCw, X } from 'lucide-react-native';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  Platform,
} from 'react-native';
import Animated, {
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';

import { GlassChrome } from '@/components/glass-chrome';
import { PressableScale } from '@/components/pressable-scale';
import { SheetFrame, useSheetGroundPlate } from '@/components/sheet-ground';
import { SettingsSegmented } from '@/components/settings-segmented';
import { usePaneChatColors, type PaneChatColors } from '@/components/pane-chat-blocks';
import { gitFileStatusWord } from '@/i18n/labels';
import {
  DIFF_CONTEXT_LINES,
  FILE_PATCH_MAX_LINES,
  applyPatchPage,
  closeFile,
  emptyFilePatchState,
  fileHeaderIndices,
  filterFilesBySide,
  flattenDiffRows,
  loadGitFileDiff,
  loadGitStatus,
  openFile,
  shouldAutoExpand,
  sideOfFile,
  stagedParamForSide,
  widestRow,
  type GitDiffRow,
  type GitDiffSide,
  type GitDiffRowType,
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
 */
export function GitDiffView({
  sessionId,
  paneId,
  label,
  branch,
  onClose,
}: {
  sessionId: string;
  paneId: string;
  /** The server's name, for the subtitle. */
  label: string;
  /** The branch the entry point already knew, so the sheet opens named. */
  branch: string;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const colors = usePaneChatColors();
  const surfaceBackground = useSurfaceBackground();
  // The plate a label takes when the pack draws a wallpaper behind the sheet.
  // Explicit, because this is the component that renders the frame and so sits
  // above its own tint provider; everything inside the sheet calls this bare.
  const plate = useSheetGroundPlate('surface');

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
      dropPatches(expandedOrder.filter((entry) => !next.includes(entry)));
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
  const stickyIndices = useMemo(() => fileHeaderIndices(rows), [rows]);
  useEffect(() => {
    const key = landOnRef.current;
    if (!key) return;
    landOnRef.current = null;
    const index = rows.findIndex((row) => row.key === key);
    if (index >= 0) listRef.current?.scrollToIndex({ index, animated: false });
  }, [rows]);

  // ---------------------------------------------------------------------
  // Width
  // ---------------------------------------------------------------------

  /**
   * How wide one character is, in points.
   *
   * Measured rather than assumed: a hidden `<Text>` of a known length is laid
   * out once in exactly the row's style, and its width over that length is the
   * advance. That is what makes this right for whatever the platform resolves
   * `monospace` to, on either OS, at whatever text size the reader has chosen.
   * The constant is only what the frame or two before that layout uses; 0.6 em
   * is the ratio every common monospace face is within a few percent of, so the
   * first paint is never wildly wrong and the correction is never visible.
   */
  const [advance, setAdvance] = useState(LINE_FONT_SIZE * 0.6);
  const onRulerLayout = useCallback((event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    if (width > 0) setAdvance(width / RULER.length);
  }, []);

  const [viewportWidth, setViewportWidth] = useState(0);
  const onViewportLayout = useCallback((event: LayoutChangeEvent) => {
    setViewportWidth(event.nativeEvent.layout.width);
  }, []);

  /**
   * The content is as wide as the longest line in hand, and never narrower than
   * the viewport. Counted over the rows rather than measured per row: the
   * answer is one number for the whole list and it only grows as pages arrive.
   */
  const contentWidth = useMemo(
    () =>
      Math.max(
        viewportWidth,
        // Two cells of slack. The advance is measured rather than exact, and a
        // content width a hair under the true one puts an ellipsis on the
        // single longest line in the file -- which is reliably the line the
        // reader scrolled right to see.
        GUTTER_WIDTH + (widestRow(rows) + 2) * advance + LINE_PADDING * 2
      ),
    [advance, rows, viewportWidth]
  );

  /**
   * The scroller's offset, on the UI thread.
   *
   * Everything that must stay put -- the gutter, the file header, the hunk
   * header, the "show more" row -- is translated by exactly this, so it lands
   * back at the viewport's left edge on the same frame the code moves under it.
   * A `useState` here would do the same thing one frame late and at sixty
   * re-renders a second.
   */
  const scrollX = useSharedValue(0);
  const onHorizontalScroll = useAnimatedScrollHandler((event) => {
    scrollX.value = event.contentOffset.x;
  });

  const gutterFill = surfaceBackground(theme.colors.surface);
  const headerFill = surfaceBackground(theme.colors.surfaceRaised);
  const pinnedWidth = Math.max(viewportWidth, 1);

  const renderRow = useCallback(
    ({ item }: LegendListRenderItemProps<GitDiffRow>) => (
      <DiffListRow
        row={item}
        width={contentWidth}
        pinnedWidth={pinnedWidth}
        colors={colors}
        gutterFill={gutterFill}
        headerFill={headerFill}
        scrollX={scrollX}
        onToggle={toggleFile}
        onShowMore={showMore}
        showSide={side === 'all'}
      />
    ),
    [colors, contentWidth, gutterFill, headerFill, pinnedWidth, scrollX, showMore, side, toggleFile]
  );

  const notARepository = Boolean(status && status.repo === null);
  const subtitle = [branch || status?.repo?.branch || '', label].filter(Boolean).join(' · ');

  // The two subviews a native form sheet lays out around a scroll view are the
  // ground and the column below; the header and the patch are inside that
  // column, which is the shape the theme catalogue uses. `collapsable={false}`
  // on both so neither is flattened away -- that would leave the scroller at
  // index 0, where react-native-screens gives it the whole sheet's height and
  // draws it under the header.
  return (
    <SheetFrame>
      <View collapsable={false} style={styles.column}>
        {/* No fill of its own any more. It had one because the route is
            transparent so the native sheet keeps its corners, and a bare header
            let the terminal show through behind the title and the segmented
            control -- which is exactly what the ground now stops, for every
            sheet at once. Dropping it is what lets the pack's wallpaper reach
            the top of this sheet the way it reaches the top of the others. */}
        <View collapsable={false} style={styles.headerBlock}>
          {/* Android only: iOS has the system grabber. The panels and files
            sheets both draw this, and a third that did not would read as a
            different app. */}
          {process.env.EXPO_OS === 'android' ? <View style={styles.sheetHandle} /> : null}
          <View style={styles.header}>
            {/* The two lines a sheet announces itself with, drawn straight onto
              the ground, so over a wallpaper they take the plate the settings
              page gives a section label. */}
            <View style={[styles.flexOne, plate]}>
              <Text variant="bodySmall" style={styles.headerTitle}>
                <Trans>Changes</Trans>
              </Text>
              <Text variant="caption" color={theme.colors.textMuted} numberOfLines={1}>
                {subtitle}
              </Text>
            </View>
            <GlassChrome face="sheet" style={styles.iconButton}>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={t`Refresh changes`}
                onPress={() => load('refresh')}
                style={styles.iconButtonHit}>
                {loading ? (
                  <ActivityIndicator size="small" color={theme.colors.primary} />
                ) : (
                  <RefreshCw size={17} color={theme.colors.textMuted} />
                )}
              </PressableScale>
            </GlassChrome>
            <GlassChrome face="sheet" style={styles.iconButton}>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={t`Close changes`}
                onPress={onClose}
                style={styles.iconButtonHit}>
                <X size={18} color={theme.colors.text} />
              </PressableScale>
            </GlassChrome>
          </View>

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

          {/* The ruler. Absolutely positioned and invisible, so it costs one
            layout pass and no space at all. See `advance`. */}
          <Text
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            numberOfLines={1}
            onLayout={onRulerLayout}
            style={[styles.lineText, styles.ruler]}>
            {RULER}
          </Text>
        </View>

        {/*
        The scroll view is the sheet's second subview and stays one whatever is
        on screen: react-native-screens finds it by class among the wrapper's
        direct children and gives it the sheet's height less the header's. Swap
        it for a plain `View` while loading and there is no scroll view to find,
        and the sheet sizes itself to its contents instead.
      */}
        <Animated.ScrollView
          horizontal
          showsHorizontalScrollIndicator={rows.length > 0}
          onScroll={onHorizontalScroll}
          scrollEventThrottle={16}
          onLayout={onViewportLayout}
          style={[styles.scroller, { backgroundColor: surfaceBackground(theme.colors.surface) }]}
          contentContainerStyle={styles.scrollerContent}>
          {rows.length > 0 ? (
            <AnimatedLegendList
              ref={listRef}
              data={rows}
              keyExtractor={keyOfRow}
              renderItem={renderRow}
              // The whole point of a monospaced one-line row: an exact height per
              // kind, so the list never re-measures and never jumps.
              getFixedItemSize={sizeOfRow}
              // So the pool never hands a file card's view to a code line.
              getItemType={typeOfRow}
              estimatedItemSize={LINE_ROW_HEIGHT}
              // See the note at the top of this file: this is the one list in the
              // app that wants recycling.
              recycleItems
              // Expanding a file inserts rows; the reader's viewport must not
              // move because of it.
              maintainVisibleContentPosition={MAINTAIN_POSITION}
              // The file being read is always named, however deep into its patch
              // the reader has scrolled. Sticky headers need the list's Reanimated
              // integration: the core list drives its scroll view with React
              // Native's `Animated.event`, an object, and handing that to a
              // Reanimated `ScrollView` through `renderScrollComponent` crashed the
              // first fling with "Object is not a function".
              stickyHeaderIndices={stickyIndices}
              style={{ width: contentWidth }}
              contentContainerStyle={styles.listContent}
            />
          ) : (
            <View style={[styles.state, { width: pinnedWidth }]}>
              {loading ? (
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
                    This pane is not working inside a git repository, so there is nothing to
                    compare.
                  </Trans>
                </Text>
              ) : (
                <Text variant="bodySmall" color={theme.colors.textMuted} style={styles.stateText}>
                  <Trans>No changes. The working tree matches HEAD.</Trans>
                </Text>
              )}
            </View>
          )}
        </Animated.ScrollView>
      </View>
    </SheetFrame>
  );
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/**
 * The counter-translation that holds a row's fixed part at the viewport's left
 * edge while the code under it pans.
 *
 * A hook of its own so its exact return type can be named: an animated style
 * handle is generic in the style it produces, and `Animated.View` only accepts
 * the one it was actually given.
 */
function usePinnedStyle(scrollX: SharedValue<number>) {
  return useAnimatedStyle(() => ({ transform: [{ translateX: scrollX.value }] }));
}

type PinnedStyle = ReturnType<typeof usePinnedStyle>;

const DiffListRow = memo(function DiffListRow({
  row,
  width,
  pinnedWidth,
  colors,
  gutterFill,
  headerFill,
  scrollX,
  onToggle,
  onShowMore,
  showSide,
}: {
  row: GitDiffRow;
  /** The laid-out width of every row: the panning content. */
  width: number;
  /** The visible width: how much of a row its pinned part may occupy. */
  pinnedWidth: number;
  colors: PaneChatColors;
  gutterFill: string;
  headerFill: string;
  scrollX: SharedValue<number>;
  onToggle: (path: string) => void;
  onShowMore: (path: string) => void;
  /** In the `all` view a file says which side it is on; in a half it need not. */
  showSide: boolean;
}) {
  // One per mounted row rather than one object shared by all of them: a
  // recycled list mounts about forty rows and keeps them, so the hook is paid
  // for once and torn down by React rather than by hand.
  const pinned = usePinnedStyle(scrollX);

  if (row.type === 'file') {
    return (
      <FileRow
        row={row}
        width={width}
        pinnedWidth={pinnedWidth}
        colors={colors}
        fill={headerFill}
        pinned={pinned}
        onToggle={onToggle}
        showSide={showSide}
      />
    );
  }
  if (row.type === 'hunk') {
    return (
      <View style={[styles.hunkRow, { width, backgroundColor: gutterFill }]}>
        <Animated.View style={[styles.pinned, pinned, { width: pinnedWidth }]}>
          <Text variant="caption" color={colors.subtle} numberOfLines={1} style={styles.hunkText}>
            {row.header}
          </Text>
        </Animated.View>
      </View>
    );
  }
  if (row.type === 'more') {
    return (
      <ShowMoreRow
        row={row}
        width={width}
        pinnedWidth={pinnedWidth}
        colors={colors}
        pinned={pinned}
        onPress={onShowMore}
      />
    );
  }
  return (
    <LineRow row={row} width={width} colors={colors} gutterFill={gutterFill} pinned={pinned} />
  );
});

const LineRow = memo(function LineRow({
  row,
  width,
  colors,
  gutterFill,
  pinned,
}: {
  row: Extract<GitDiffRow, { type: 'line' }>;
  width: number;
  colors: PaneChatColors;
  gutterFill: string;
  pinned: PinnedStyle;
}) {
  const added = row.kind === 'added';
  const removed = row.kind === 'removed';
  const tint = added ? colors.addedBackground : removed ? colors.removedBackground : 'transparent';
  return (
    <View style={[styles.lineRow, { width, backgroundColor: tint }]}>
      {/* The code first and the gutter over it, so panned text slides *under*
          an opaque column rather than out beside it. */}
      <Text
        selectable
        numberOfLines={1}
        style={[
          styles.lineText,
          styles.lineBody,
          { color: added ? colors.added : removed ? colors.removed : colors.muted },
        ]}>
        {row.text || ' '}
      </Text>
      <Animated.View style={[styles.gutter, pinned, { backgroundColor: gutterFill }]}>
        <Text color={colors.subtle} style={styles.gutterNumber}>
          {row.oldLine ?? ''}
        </Text>
        <Text color={colors.subtle} style={styles.gutterNumber}>
          {row.newLine ?? ''}
        </Text>
        <Text
          color={added ? colors.added : removed ? colors.removed : colors.subtle}
          style={styles.gutterMarker}>
          {added ? '+' : removed ? '−' : ' '}
        </Text>
      </Animated.View>
    </View>
  );
});

const FileRow = memo(function FileRow({
  row,
  width,
  pinnedWidth,
  colors,
  fill,
  pinned,
  onToggle,
  showSide,
}: {
  row: Extract<GitDiffRow, { type: 'file' }>;
  width: number;
  pinnedWidth: number;
  colors: PaneChatColors;
  fill: string;
  pinned: PinnedStyle;
  onToggle: (path: string) => void;
  showSide: boolean;
}) {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const Chevron = row.expanded ? ChevronDown : ChevronRight;
  const fileSide = sideOfFile(row.file);
  // Letters, not words: a phone's file row has room for "+1000 −1000" and one
  // more glyph, and S and U are read the same way in every catalog. The words
  // are on the accessibility label, which is where a screen reader looks.
  const sideMark = fileSide === 'both' ? 'S U' : fileSide === 'staged' ? 'S' : 'U';
  const sideLabel =
    fileSide === 'both' ? t`Staged and unstaged` : fileSide === 'staged' ? t`Staged` : t`Unstaged`;
  const word = _(gitFileStatusWord[row.file.status] ?? gitFileStatusWord.unknown);

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityState={{ expanded: row.expanded }}
      accessibilityLabel={row.expanded ? t`Hide ${row.path}` : t`Show ${row.path}`}
      feedback="selection"
      pressedScale={0.995}
      onPress={() => onToggle(row.path)}
      // A collapsed file is a line in a list and sits on the sheet's own
      // surface with a hairline under it; the raised fill is for the expanded
      // file only, where the header is also the sticky one and has to read as
      // a band over the code below it. Painting every file row raised turned
      // a six-file list into one beige block that stopped mid-sheet.
      style={[
        styles.fileRow,
        {
          width,
          backgroundColor: row.expanded ? fill : 'transparent',
          borderBottomColor: colors.border,
        },
      ]}>
      <Animated.View style={[styles.pinned, styles.fileBody, pinned, { width: pinnedWidth }]}>
        <Chevron size={15} color={colors.subtle} />
        <View style={styles.flexOne}>
          {/* The tail of a path identifies it on a phone, so the head is what
              gets cut. */}
          <Text variant="bodySmall" numberOfLines={1} ellipsizeMode="head">
            {row.path}
          </Text>
          <View style={styles.fileMeta}>
            <Text variant="caption" color={colors.subtle}>
              {word}
            </Text>
            {row.file.added ? (
              <Text variant="caption" color={colors.added}>
                +{row.file.added}
              </Text>
            ) : null}
            {row.file.removed ? (
              <Text variant="caption" color={colors.removed}>
                −{row.file.removed}
              </Text>
            ) : null}
            {showSide ? (
              <Text
                variant="caption"
                color={colors.subtle}
                accessibilityLabel={sideLabel}
                style={styles.sideMark}>
                {sideMark}
              </Text>
            ) : null}
            {row.note === 'binary' ? (
              <Text variant="caption" color={colors.subtle}>
                <Trans>Binary file</Trans>
              </Text>
            ) : null}
            {row.note === 'empty' ? (
              <Text variant="caption" color={colors.subtle}>
                <Trans>No textual change</Trans>
              </Text>
            ) : null}
            {row.note === 'error' && row.error ? (
              <Text variant="caption" color={colors.status.error} numberOfLines={1}>
                {row.error}
              </Text>
            ) : null}
          </View>
        </View>
        {row.loading ? <ActivityIndicator size="small" color={colors.subtle} /> : null}
      </Animated.View>
    </PressableScale>
  );
});

const ShowMoreRow = memo(function ShowMoreRow({
  row,
  width,
  pinnedWidth,
  colors,
  pinned,
  onPress,
}: {
  row: Extract<GitDiffRow, { type: 'more' }>;
  width: number;
  pinnedWidth: number;
  colors: PaneChatColors;
  pinned: PinnedStyle;
  onPress: (path: string) => void;
}) {
  const { t } = useLingui();
  return (
    // An explicit tap, never `onEndReached`. A diff that grows under the reader
    // is the viewport-moving behaviour the house rules forbid, and the reader
    // asking for the rest of a six-thousand-line file is a decision, not a
    // side effect of having scrolled.
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={t`Show more`}
      accessibilityState={{ busy: row.loading }}
      disabled={row.loading}
      onPress={() => onPress(row.path)}
      style={[styles.moreRow, { width }]}>
      <Animated.View style={[styles.pinned, styles.moreBody, pinned, { width: pinnedWidth }]}>
        <View style={[styles.moreChip, { borderColor: colors.border }]}>
          {row.loading ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : (
            <Text variant="caption" color={colors.accent}>
              <Trans>Show more</Trans>
            </Text>
          )}
          <Text variant="caption" color={colors.subtle}>
            <Plural value={row.remaining} one="# more line" other="# more lines" />
          </Text>
        </View>
      </Animated.View>
    </PressableScale>
  );
});

// ---------------------------------------------------------------------------
// Constants and small helpers
// ---------------------------------------------------------------------------

const EMPTY_FILES: readonly GitFileChange[] = [];

/**
 * Fifty `M`s in the row's own style: the one string measured to learn how wide
 * a character is. `M` rather than a space, because a face that turned out not
 * to be monospaced would give a subtly wrong answer for a space and an
 * obviously wrong one for an `M`.
 */
const RULER = 'M'.repeat(50);

const LINE_FONT_SIZE = 11.5;
const LINE_ROW_HEIGHT = 18;
// `monospace` is a real family on Android and not on iOS, where it falls back
// to the proportional system font -- and then no two columns line up, which is
// the one thing a diff exists to do. Menlo is what the rest of the app uses
// there (`server-terminal-workspace.tsx`, `ssh-host-form.tsx`).
const MONO_FONT = Platform.OS === 'ios' ? 'Menlo' : 'monospace';
const HUNK_ROW_HEIGHT = 26;
const FILE_ROW_HEIGHT = 52;
const MORE_ROW_HEIGHT = 44;
/** Two five-digit columns and a marker, with room to breathe. */
const GUTTER_WIDTH = 78;
const LINE_PADDING = 10;

const ROW_HEIGHT: Record<GitDiffRowType, number> = {
  file: FILE_ROW_HEIGHT,
  hunk: HUNK_ROW_HEIGHT,
  line: LINE_ROW_HEIGHT,
  more: MORE_ROW_HEIGHT,
};

/** Matching `pane-chat-view`: the reader's place across a change of data. */
const MAINTAIN_POSITION = { data: true, size: true } as const;

function keyOfRow(row: GitDiffRow): string {
  return row.key;
}

function typeOfRow(row: GitDiffRow): GitDiffRowType {
  return row.type;
}

function sizeOfRow(row: GitDiffRow): number {
  return ROW_HEIGHT[row.type];
}

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
  column: { flex: 1 },
  headerBlock: {
    paddingTop: 10,
    paddingBottom: 8,
    paddingHorizontal: 16,
    gap: 8,
  },
  sheetHandle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    backgroundColor: 'rgba(127, 127, 127, 0.36)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerTitle: {
    fontSize: 20,
    lineHeight: 25,
    includeFontPadding: false,
  },
  // Shape only; the fill comes from `GlassChrome`, as it does in the files and
  // panels sheets.
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderCurve: 'continuous',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButtonHit: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flexOne: {
    flex: 1,
    minWidth: 0,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 8,
    minHeight: 30,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderCurve: 'continuous',
  },
  scroller: {
    flex: 1,
  },
  scrollerContent: {
    flexGrow: 1,
  },
  listContent: {
    flexGrow: 1,
    paddingBottom: 32,
  },
  state: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 32,
    paddingVertical: 48,
  },
  stateText: {
    textAlign: 'center',
  },
  retry: {
    minHeight: 32,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Every row is laid out at the full content width so its background spans the
  // panned area; only what sits inside `pinned` is held at the viewport.
  pinned: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  fileRow: {
    height: FILE_ROW_HEIGHT,
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  fileBody: {
    gap: 10,
    paddingHorizontal: LINE_PADDING + 4,
  },
  fileMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    overflow: 'hidden',
  },
  sideMark: {
    fontFamily: MONO_FONT,
    letterSpacing: 1,
  },
  hunkRow: {
    height: HUNK_ROW_HEIGHT,
    justifyContent: 'center',
  },
  hunkText: {
    paddingHorizontal: LINE_PADDING,
    fontFamily: MONO_FONT,
    fontSize: 10.5,
  },
  lineRow: {
    height: LINE_ROW_HEIGHT,
    justifyContent: 'center',
  },
  lineText: {
    fontFamily: MONO_FONT,
    fontSize: LINE_FONT_SIZE,
    lineHeight: LINE_ROW_HEIGHT,
    includeFontPadding: false,
  },
  lineBody: {
    paddingLeft: GUTTER_WIDTH + LINE_PADDING,
    paddingRight: LINE_PADDING,
  },
  gutter: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: GUTTER_WIDTH,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 6,
    gap: 2,
  },
  gutterNumber: {
    width: 30,
    fontSize: 9.5,
    lineHeight: LINE_ROW_HEIGHT,
    textAlign: 'right',
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  gutterMarker: {
    width: 8,
    fontSize: 10,
    lineHeight: LINE_ROW_HEIGHT,
    textAlign: 'center',
    includeFontPadding: false,
    fontFamily: MONO_FONT,
  },
  moreRow: {
    height: MORE_ROW_HEIGHT,
    justifyContent: 'center',
  },
  moreBody: {
    paddingHorizontal: LINE_PADDING,
  },
  moreChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 30,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
  },
  ruler: {
    position: 'absolute',
    top: -1000,
    left: 0,
    opacity: 0,
  },
});
